import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";

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
type CommandResponse = { status: number; body: string; auditId: string; record: Record<string, unknown> };

let apiOrigin = "";
let apiProcess: ChildProcess | undefined;
let fixtureDir = "";
let teardownProbeStarted = false;
let teardownProbeStatus: number | undefined;
const pendingProxyTasks = new Set<Promise<void>>();
function trackProxy(task: Promise<void>): Promise<void> {
  pendingProxyTasks.add(task);
  return task.finally(() => pendingProxyTasks.delete(task));
}

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
  test.setTimeout(30_000);
  teardownProbeStarted = false;
  teardownProbeStatus = undefined;
  const port = await availablePort();
  apiOrigin = `http://127.0.0.1:${port}`;
  fixtureDir = mkdtempSync(join(tmpdir(), "doul-inbox-retry-"));
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
});

test.afterEach(async ({ page }) => {
  // A successful command starts background refreshes. Drain handlers before
  // stopping their real API, then close the page so no new reads can start.
  try {
    while (pendingProxyTasks.size) await Promise.all([...pendingProxyTasks]);
    await page.unrouteAll({ behavior: "wait" });
    if (teardownProbeStarted) expect(teardownProbeStatus).toBe(200);
    await page.close();
  } finally {
    if (apiProcess && apiProcess.exitCode === null) {
      const child = apiProcess;
      child.kill("SIGTERM");
      await new Promise<void>(done => {
        const timeout = setTimeout(() => { child.kill("SIGKILL"); done(); }, 3_000);
        child.once("exit", () => { clearTimeout(timeout); done(); });
      });
    }
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test.beforeEach(async ({ page }) => {
  // Browser requests use the actual ASGI API and its isolated SQLite fixture.
  await page.route("**/api/**", route => trackProxy((async () => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname.replace(/^\/api/, "");
    const response = await route.fetch({ url: `${apiOrigin}${path}${requestUrl.search}` });
    await route.fulfill({ response });
  })()));
});

test("work inbox retries an uncertain command with the same idempotency key and server result", async ({ page, request }) => {
  const target = /\/api\/projects\/([^/]+)\/inspections\/([^/]+)\/start$/;
  const posts: Array<{ key: string | undefined; body: string | null }> = [];
  const responses: CommandResponse[] = [];
  const authHeaders: Array<Record<string, string>> = [];
  let projectId = "";
  let recordId = "";

  await page.route(target, async route => {
    const req = route.request();
    const match = req.url().match(target);
    if (!match) throw new Error(`Unexpected command URL: ${req.url()}`);
    projectId = match[1];
    recordId = match[2];
    const requestHeaders = await req.allHeaders();
    authHeaders.push(requestHeaders);
    posts.push({ key: requestHeaders["idempotency-key"], body: req.postData() });

    // Let the real API receive and commit the first command, then discard only
    // its response to the browser to reproduce an uncertain transport outcome.
    const path = new URL(req.url()).pathname.replace(/^\/api/, "");
    const response = await route.fetch({ url: `${apiOrigin}${path}` });
    const body = await response.text();
    const parsed = JSON.parse(body) as { auditEvent: { id: string }; record: Record<string, unknown> };
    const captured = { status: response.status(), body, auditId: parsed.auditEvent.id, record: parsed.record };
    responses.push(captured);
    if (posts.length === 1) {
      await route.abort("connectionreset");
      return;
    }
    await route.fulfill({ status: response.status(), headers: response.headers(), body });
  });

  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "작업함", exact: true }).click();
  const inbox = page.getByTestId("work-inbox-actions");
  await expect(inbox).toBeVisible();
  await expect(inbox.getByRole("status")).toHaveCount(0, { timeout: 15000 });
  const inspectionCard = inbox.locator(".work-inbox-card").filter({ has: page.locator(".badge", { hasText: /^검측$/ }) }).filter({ has: page.locator(".work-inbox-candidate", { hasText: "시작전이" }) }).first();
  const candidate = inspectionCard.locator(".work-inbox-candidate").filter({ hasText: "시작전이" });
  await expect(candidate).toBeEnabled();
  await candidate.click();
  const modal = page.getByRole("dialog");
  const submit = modal.getByRole("button", { name: "확인 후 실행" });
  await expect(submit).toBeVisible();
  await submit.click();

  await expect(page.getByRole("alert").filter({ hasText: "연결을 확인한 뒤 다시 시도" })).toBeVisible();
  await expect(modal).toBeVisible();
  await submit.click();

  await expect(modal).toHaveCount(0);
  expect(posts).toHaveLength(2);
  expect(posts[0].key).toBeTruthy();
  expect(posts[1].key).toBe(posts[0].key);
  expect(posts[1].body).toBe(posts[0].body);
  expect(responses).toHaveLength(2);
  const [firstResponse, replayResponse] = responses;
  expect(firstResponse).toBeDefined();
  expect(replayResponse).toBeDefined();
  expect(replayResponse?.status).toBe(200);
  expect(replayResponse?.body).toBe(firstResponse?.body);
  expect(replayResponse?.auditId).toBe(firstResponse?.auditId);
  expect(replayResponse?.record).toEqual(firstResponse?.record);
  expect(replayResponse?.record.status).toBe("in_progress");

  const headers = authHeaders[0];
  if (!headers) throw new Error("Missing browser authorization headers");
  const workspace = await request.get(`${apiOrigin}/projects/${projectId}/workspace`, {
    headers: {
      authorization: headers.authorization,
      "x-roleassignment-id": headers["x-roleassignment-id"],
    },
  });
  expect(workspace.ok()).toBeTruthy();
  const state = await workspace.json() as { items: Array<{ record: { id: string; status: string } }>; audit: Array<{ id: string; objectRef: { objectId: string } }> };
  expect(state.items.find(item => item.record.id === recordId)?.record.status).toBe("in_progress");
  expect(state.audit.filter(event => event.objectRef.objectId === recordId && event.id === firstResponse?.auditId)).toHaveLength(1);

  // Leave one authenticated refresh deliberately in flight when this test ends.
  // Teardown must let the read finish against the live API before killing it.
  let signalEntered!: () => void;
  const entered = new Promise<void>(resolveEntered => { signalEntered = resolveEntered; });
  await page.route("**/workspace?teardownProbe=1", route => trackProxy((async () => {
    teardownProbeStarted = true;
    signalEntered();
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
    const response = await route.fetch({ url: `${apiOrigin}/projects/${projectId}/workspace`, maxRetries: 0 });
    teardownProbeStatus = response.status();
    await route.fulfill({ response });
  })()));
  await page.evaluate(({ projectId, headers }) => {
    void fetch(`/api/projects/${projectId}/workspace?teardownProbe=1`, { headers }).catch(() => {});
  }, { projectId, headers: { authorization: headers.authorization, "x-roleassignment-id": headers["x-roleassignment-id"] } });
  await entered;
});
