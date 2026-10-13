import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { commands, fields, states } from "../apps/web/src/labels";

type Session = {
  projectId: string;
  accessToken: string;
  actor: { partyId: string; roleAssignmentId: string; actorGroup: string };
};
type WorkRecord = {
  id: string;
  version: number;
  status: string;
  title?: string;
  workName?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};
type AuditEvent = { id: string; objectRef: { objectId: string }; eventType?: string };

let apiOrigin = "";
let apiProcess: ChildProcess | undefined;
let fixtureDir = "";

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a test API port");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return port;
}

test.beforeAll(async () => {
  const port = await availablePort();
  apiOrigin = `http://127.0.0.1:${port}`;
  fixtureDir = mkdtempSync(join(tmpdir(), "doul-command-modal-stale-"));
  const python = process.env.DOUL_TEST_PYTHON || "python3";
  apiProcess = spawn(python, [
    "-m", "services.api", "--demo", "--database", join(fixtureDir, "demo.sqlite3"), "--port", String(port),
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DOUL_API_ALLOWED_ORIGINS: process.env.DOUL_TEST_BROWSER_ORIGIN || "http://127.0.0.1:5181",
      PYTHONPATH: [process.cwd(), process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    },
    stdio: "ignore",
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) throw new Error(`Disposable API exited (${apiProcess.exitCode})`);
    try {
      if ((await fetch(`${apiOrigin}/health`)).ok) return;
    } catch { /* Wait for the owned API process to bind its ephemeral port. */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
  }
  throw new Error("Disposable API did not become healthy");
}, 30_000);

test.afterAll(async () => {
  if (apiProcess && apiProcess.exitCode === null) {
    const child = apiProcess;
    child.kill("SIGTERM");
    await new Promise<void>(done => {
      const timeout = setTimeout(() => { child.kill("SIGKILL"); done(); }, 3_000);
      child.once("exit", () => { clearTimeout(timeout); done(); });
    });
  }
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  // Browser requests use the actual ASGI API and its isolated SQLite fixture.
  await page.route("**/api/**", async route => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname.replace(/^\/api/, "");
    const response = await route.fetch({ url: `${apiOrigin}${path}${requestUrl.search}` });
    await route.fulfill({ response });
  });
});

async function login(request: APIRequestContext, actorGroup: string): Promise<Session> {
  const response = await request.post(`${apiOrigin}/dev/sessions`, { data: { actorGroup } });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

function headers(session: Session) {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    "X-Role-Assignment-Id": session.actor.roleAssignmentId,
    "Idempotency-Key": randomUUID(),
  };
}

async function workspace(request: APIRequestContext, session: Session) {
  const response = await request.get(`${apiOrigin}/projects/${session.projectId}/workspace`, {
    headers: { Authorization: `Bearer ${session.accessToken}`, "X-Role-Assignment-Id": session.actor.roleAssignmentId },
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<{
    context: { scope: Record<string, unknown>; evidenceId: string };
    items: Array<{ machine: string; record: WorkRecord }>;
    audit: AuditEvent[];
  }>;
}

async function createRecord(request: APIRequestContext, session: Session, collection: string, payload: object) {
  const response = await request.post(`${apiOrigin}/projects/${session.projectId}/${collection}`, {
    headers: headers(session),
    data: { roleAssignmentId: session.actor.roleAssignmentId, clientObjectId: randomUUID(), payload },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json() as { record: WorkRecord }).record;
}

async function command(request: APIRequestContext, session: Session, collection: string, record: WorkRecord, name: string, payload: object = {}) {
  const response = await request.post(`${apiOrigin}/projects/${session.projectId}/${collection}/${record.id}/${name.replaceAll("_", "-")}`, {
    headers: headers(session),
    data: { roleAssignmentId: session.actor.roleAssignmentId, expectedVersion: record.version, payload, evidenceIds: [] },
  });
  const body = await response.json() as { record?: WorkRecord; auditEvent?: AuditEvent; code?: string };
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body.record).toBeTruthy();
  expect(body.auditEvent).toBeTruthy();
  return { record: body.record!, auditEvent: body.auditEvent! };
}

async function openRoleRoute(page: Page, route: string, role: string) {
  const initialLoad = page.waitForResponse(response => response.request().method() === "GET" && response.url().endsWith("/workspace") && response.ok());
  await page.goto("/#/today");
  await initialLoad;
  const picker = page.getByRole("combobox", { name: "시험 사용자 역할 선택" });
  if (await picker.inputValue() !== role) {
    const loaded = page.waitForResponse(response => response.request().method() === "GET" && response.url().endsWith("/workspace") && response.ok());
    await picker.selectOption(role);
    await loaded;
  }
  await expect(picker).toHaveValue(role);
  await page.goto(`/#/${route}`);
  await expect(page.locator("main h1")).toBeVisible();
}

async function submitStaleCommand(
  page: Page,
  writer: Session,
  directWrite: () => Promise<{ record: WorkRecord; auditEvent: AuditEvent }>,
  expectedCommandUrl: RegExp,
  configureDialog?: (dialog: Locator) => Promise<void>,
) {
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  if (configureDialog) await configureDialog(modal);
  const concurrentResult = await directWrite();
  expect(concurrentResult.record.version).toBeGreaterThan(0);
  const browserConflict = page.waitForResponse(response =>
    response.request().method() === "POST" && expectedCommandUrl.test(new URL(response.url()).pathname));
  await modal.getByRole("button", { name: "확인 후 실행", exact: true }).click();
  const response = await browserConflict;
  const body = await response.json() as { code?: string; currentVersion?: number };
  expect(response.status(), JSON.stringify(body)).toBe(409);
  expect(body.code).toBe("VERSION_CONFLICT");
  expect(body.currentVersion).toBe(concurrentResult.record.version);
  expect(response.request().headers().authorization).not.toBe(`Bearer ${writer.accessToken}`);
  expect(response.request().postDataJSON().roleAssignmentId).toBe(writer.actor.roleAssignmentId);
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("alert")).toBeVisible();
  return { modal, current: concurrentResult.record, eventId: concurrentResult.auditEvent.id };
}

async function refreshAndCheck(page: Page, request: APIRequestContext, session: Session, record: WorkRecord, eventId: string) {
  const refresh = page.waitForResponse(response => response.request().method() === "GET" && response.url().endsWith("/workspace") && response.ok());
  // Refetch on window focus instead of the removed permanent header control.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refresh;
  const detail = page.locator(".detail-pane");
  await expect(detail).toContainText(`기록 제${record.version}차`);
  await expect(detail).toContainText(states[record.status] ?? record.status);
  const response = await request.get(`${apiOrigin}/projects/${session.projectId}/workspace`, {
    headers: { Authorization: `Bearer ${session.accessToken}`, "X-Role-Assignment-Id": session.actor.roleAssignmentId },
  });
  expect(response.status()).toBe(200);
  const current = await response.json() as { items: Array<{ record: WorkRecord }>; audit: AuditEvent[] };
  expect(current.items.find(item => item.record.id === record.id)?.record.version).toBe(record.version);
  expect(current.audit.filter(event => event.id === eventId && event.objectRef.objectId === record.id)).toHaveLength(1);
}

test("quality Inspection stale command is rejected and the common modal can refresh to the second-session version", async ({ page, request }) => {
  const concurrent = await login(request, "SUP");
  const initial = await workspace(request, concurrent);
  const candidate = initial.items.find(item => item.machine === "inspection" && item.record.status === "scheduled");
  expect(candidate, "demo should provide a scheduled inspection in current scope").toBeTruthy();
  const title = String(candidate!.record.title ?? candidate!.record.workName ?? candidate!.record.data?.workName ?? "");
  expect(title).toBeTruthy();

  await openRoleRoute(page, "inspections", "SUP");
  const record = page.getByRole("button", { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
  await expect(record).toBeVisible({ timeout: 15000 });
  await record.click();
  await page.getByRole("button", { name: commands.start, exact: true }).click();
  const attempt = await submitStaleCommand(page, concurrent,
    () => command(request, concurrent, "inspections", candidate!.record, "start"),
    new RegExp(`/inspections/${candidate!.record.id}/start$`));
  await attempt.modal.getByRole("button", { name: "취소", exact: true }).click();
  await refreshAndCheck(page, request, concurrent, attempt.current, attempt.eventId);
});

test("safety Stop acknowledgment conflict stays explicit until refresh shows the second-session state", async ({ page, request }) => {
  const con = await login(request, "CON");
  const sup = await login(request, "SUP");
  const context = (await workspace(request, con)).context;
  const suffix = randomUUID().slice(0, 8);
  const permit = await createRecord(request, con, "safety-permits", {
    ...context.scope,
    title: `stale conflict permit ${suffix}`,
    data: {},
  });
  const now = new Date().toISOString();
  const stop = await createRecord(request, sup, "safety-stop-orders", {
    ...context.scope,
    title: `stale conflict stop ${suffix}`,
    evidenceIds: [context.evidenceId],
    data: {
      stopOrderNo: `STOP-${suffix}`,
      stopScopeType: "permit",
      stopReason: "Observed uncontrolled access",
      hazardDescription: "Temporary edge protection was incomplete",
      observedAt: now,
      effectiveAt: now,
      affectedPermitRefs: [{ objectType: "WorkItem", objectId: permit.id, version: permit.version }],
    },
  });

  await openRoleRoute(page, "safety", "CON");
  await page.getByRole("tab").nth(1).click();
  await page.locator('[data-ui-component="safety-workspace"] .record-list').getByRole("button").filter({ hasText: stop.title! }).click();
  await page.getByRole("button", { name: commands.acknowledge_stop, exact: true }).click();
  const attempt = await submitStaleCommand(page, con,
    () => command(request, con, "safety-stop-orders", stop, "acknowledge_stop"),
    new RegExp(`/safety-stop-orders/${stop.id}/acknowledge-stop$`));
  await attempt.modal.getByRole("button", { name: "취소", exact: true }).click();
  await refreshAndCheck(page, request, con, attempt.current, attempt.eventId);
});

test("payment claim stale command is rejected and refresh exposes the second-session withdrawal", async ({ page, request }) => {
  const con = await login(request, "CON");
  const context = (await workspace(request, con)).context;
  const claimNo = `stale IPC ${randomUUID().slice(0, 8)}`;
  const claim = await createRecord(request, con, "payment-claims", {
    ...context.scope,
    subtype: "PaymentClaim",
    title: claimNo,
    data: { paymentClaimNo: claimNo },
  });

  await openRoleRoute(page, "payment", "CON");
  await page.getByRole("tab", { name: "기성 신청", exact: true }).click();
  await page.locator(".payment-record-row").filter({ hasText: claimNo }).click();
  await page.getByRole("button", { name: new RegExp(commands.withdraw_payment_claim) }).click();
  const attempt = await submitStaleCommand(page, con,
    () => command(request, con, "payment-claims", claim, "withdraw_payment_claim", { reason: "Withdrawn by the second session" }),
    new RegExp(`/payment-claims/${claim.id}/withdraw-payment-claim$`),
    async modal => { await modal.getByLabel(fields.reason, { exact: true }).fill("Stale UI submission"); });
  await attempt.modal.getByRole("button", { name: "취소", exact: true }).click();
  await refreshAndCheck(page, request, con, attempt.current, attempt.eventId);
});
