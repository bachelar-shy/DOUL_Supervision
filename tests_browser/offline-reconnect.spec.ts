import { expect, test, type APIRequestContext } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

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

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

let apiOrigin = "";
let apiProcess: ChildProcess | undefined;
let fixtureDir = "";
let browserCommands = 0;

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

test.beforeEach(async () => {
  const port = await availablePort();
  apiOrigin = `http://127.0.0.1:${port}`;
  fixtureDir = mkdtempSync(join(tmpdir(), "doul-offline-conflict-"));
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

test.afterEach(async () => {
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
    if (route.request().method() === "POST" && !requestUrl.pathname.endsWith("/dev/sessions")) browserCommands++;
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


test("offline intent survives reconnect and refuses a competing server version until human resolution", async ({ page, request }) => {
  const writer = await login(request, "SUP");
  const initial = await workspace(request, writer);
  const record = initial.items.find(item => item.machine === "inspection" && item.record.status === "scheduled")?.record;
  expect(record).toBeTruthy();
  if (!record) throw new Error("Missing scheduled inspection fixture");
  const loaded = page.waitForResponse(response => response.url().endsWith("/workspace") && response.ok());
  await page.goto("/#/today");
  await loaded;
  const summary = page.locator('[data-ui-component="offline-status-toggle"]');
  await summary.click();
  const panel = page.getByRole("region", { name: "연결 끊김 시 업무 임시저장" });
  const option = panel.locator(`option[value="inspection:${record.id}:start"]`);
  await expect(option, `fixture ${record.id} 기록 제${record.version}차; choices: ${JSON.stringify(await panel.locator("option").allTextContents())}`).toHaveCount(1);
  await panel.getByRole("combobox").selectOption(await option.getAttribute("value") || "");
  browserCommands = 0;
  await page.context().setOffline(true);
  await panel.getByRole("button", { name: "입력 작성" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "기기에 보관" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(panel).toContainText(`기록 제${record.version}차`);
  expect(browserCommands).toBe(0);
  const saved = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith("doul:offline-command:"));
    return key ? { key, value: JSON.parse(localStorage.getItem(key)!) } : null;
  });
  expect(saved?.value.expectedVersion).toBe(record.version);
  expect(saved?.value.itemId).toBe(record.id);
  expect(saved?.value.command).toBe("start");
  const written = await request.post(`${apiOrigin}/projects/${writer.projectId}/inspections/${record.id}/start`, {
    headers: headers(writer),
    data: { roleAssignmentId: writer.actor.roleAssignmentId, expectedVersion: record.version, payload: {}, evidenceIds: [] },
  });
  expect(written.status(), await written.text()).toBe(200);
  const changed = await written.json();
  expect(changed.record.version).toBe(record.version + 1);
  await page.context().setOffline(false);
  const reloaded = page.waitForResponse(response => response.url().endsWith("/workspace") && response.ok());
  await page.reload();
  await reloaded;
  await summary.click();
  await expect(panel).toContainText(`보관 작성 차수: 기록 제${record.version}차`);
  await expect(panel.getByRole("alert").filter({ hasText: "작성 차수 또는 가능한 업무이 변경" })).toBeVisible();
  await expect(panel).toContainText(`현재 업무 시스템 작성 차수: 기록 제${changed.record.version}차`);
  await expect(panel.getByRole("button", { name: "현재 가능한 업무를 업무 시스템에 제출" })).toHaveCount(0);
  expect(browserCommands).toBe(0);
  await panel.getByRole("button", { name: "기기 초안 취소" }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), saved!.key)).toBeNull();
  const final = await workspace(request, writer);
  expect(final.items.find(item => item.record.id === record.id)?.record.version).toBe(changed.record.version);
  expect(final.audit.filter(event => event.objectRef.objectId === record.id && event.id === changed.auditEvent.id)).toHaveLength(1);
});


test("current offline intent is sent only by explicit submission after reconnect", async ({ page, request }) => {
  const reader = await login(request, "SUP");
  const initial = await workspace(request, reader);
  const record = initial.items.find(item => item.machine === "inspection" && item.record.status === "scheduled")?.record;
  if (!record) throw new Error("Missing scheduled inspection fixture");
  const loaded = page.waitForResponse(response => response.url().endsWith("/workspace") && response.ok());
  await page.goto("/#/today"); await loaded;
  await page.locator('[data-ui-component="offline-status-toggle"]').click();
  const panel = page.getByRole("region", { name: "연결 끊김 시 업무 임시저장" });
  await panel.getByRole("combobox").selectOption(`inspection:${record.id}:start`);
  browserCommands = 0;
  await page.context().setOffline(true);
  await panel.getByRole("button", { name: "입력 작성" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "기기에 보관" }).click();
  expect(browserCommands).toBe(0);
  await page.context().setOffline(false);
  await expect(panel.getByRole("status")).toContainText("저장 당시 작성 차수가 현재");
  expect(browserCommands).toBe(0);
  const sent = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/inspections/${record.id}/start`));
  await panel.getByRole("button", { name: "현재 가능한 업무를 업무 시스템에 제출" }).click();
  const response = await sent;
  expect(response.status(), await response.text()).toBe(200);
  expect(response.request().postDataJSON().expectedVersion).toBe(record.version);
  const result = await response.json();
  await expect(panel.getByRole("combobox")).toBeVisible();
  expect(browserCommands).toBe(1);
  expect(result.record.status).toBe("in_progress");
  const final = await workspace(request, reader);
  expect(final.items.find(item => item.record.id === record.id)?.record.version).toBe(result.record.version);
  expect(final.audit.filter(event => event.objectRef.objectId === record.id && event.id === result.auditEvent.id)).toHaveLength(1);
});
