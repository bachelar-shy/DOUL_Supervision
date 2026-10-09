import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Session = {
  projectId: string;
  accessToken: string;
  actor: { partyId: string; roleAssignmentId: string; actorGroup: string };
};

let apiPort = Number(process.env.DOUL_INSPECTION_FIXTURE_PORT ?? 0);
let apiOrigin = "";
let apiProcess: ChildProcess | undefined;
let fixtureDir: string | undefined;
if (process.env.CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.CHROMIUM_PATH } });

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve an API port");
  const port = address.port;
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return port;
}

function headers(session: Session, write = false) {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    "X-Role-Assignment-Id": session.actor.roleAssignmentId,
    ...(write ? { "Idempotency-Key": randomUUID() } : {}),
  };
}

async function api<T>(request: APIRequestContext, session: Session, path: string, body?: unknown, expected = 200): Promise<T> {
  const response = body === undefined
    ? await request.get(`${apiOrigin}/projects/${session.projectId}${path}`, { headers: headers(session) })
    : await request.post(`${apiOrigin}/projects/${session.projectId}${path}`, { headers: headers(session, true), data: body });
  const text = await response.text();
  expect(response.status(), `${path}: ${text}`).toBe(expected);
  return JSON.parse(text) as T;
}

async function login(request: APIRequestContext, actorGroup: string): Promise<Session> {
  const response = await request.post(`${apiOrigin}/dev/sessions`, { data: { actorGroup } });
  const text = await response.text();
  expect(response.status(), text).toBe(200);
  return JSON.parse(text) as Session;
}

async function proxyApiToFixture(page: Page) {
  await page.route("**/*", async (route) => {
    const target = new URL(route.request().url());
    if (!target.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    target.pathname = target.pathname.replace(/^\/api(?=\/)/, "");
    target.hostname = "127.0.0.1";
    target.port = String(apiPort);
    const response = await route.fetch({ url: target.toString() });
    await route.fulfill({ response });
  });
}

test.beforeAll(async () => {
  if (!apiPort) apiPort = await availablePort();
  apiOrigin = `http://127.0.0.1:${apiPort}`;
  fixtureDir = mkdtempSync(join(tmpdir(), "doul-inspection-result-"));
  const python = process.env.DOUL_QUALITY_PYTHON ?? process.env.DOUL_TEST_PYTHON ?? resolve(".venv/bin/python");
  apiProcess = spawn(python, [
    "-m", "tests_browser.support.quality_api_fixture",
    "--host", "127.0.0.1", "--port", String(apiPort),
    "--database", join(fixtureDir, "inspection.sqlite3"),
  ], { cwd: process.cwd(), stdio: "ignore" });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) throw new Error(`Inspection API fixture exited: ${apiProcess.exitCode}`);
    try {
      if ((await fetch(`${apiOrigin}/health`)).ok) return;
    } catch { /* Wait for the isolated API fixture to start. */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error("Inspection API fixture did not become ready");
});

test.afterAll(async () => {
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill("SIGTERM");
    await new Promise<void>((done) => {
      const timeout = setTimeout(() => { apiProcess?.kill("SIGKILL"); done(); }, 3_000);
      apiProcess?.once("exit", () => { clearTimeout(timeout); done(); });
    });
  }
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

test("inspection results stay explicit, typed, localized, and unapproved until a separate judgment", async ({ page, request }) => {
  await proxyApiToFixture(page);
  const supervisor = await login(request, "SUP");
  const workspace = await api<{
    context: { evidenceId: string };
    items: Array<{ machine: string; record: Record<string, unknown> }>;
  }>(request, supervisor, "/workspace");
  const inspectionItem = workspace.items.find((item) => item.machine === "inspection"
    && item.record.status === "scheduled"
    && (!Array.isArray(item.record.checkResults) || item.record.checkResults.length === 0));
  expect(inspectionItem, "fixture should provide an unjudged scheduled inspection without seeded result rows").toBeTruthy();
  const inspection = inspectionItem!.record as {
    id: string; version: number; status: string; workName: string;
    requirementRefs: Array<{ objectType: string; objectId: string; version: number }>;
    checkResults?: unknown[]; resultStatus?: string; nextWorkAllowed: boolean;
  };
  expect(inspection.requirementRefs).toHaveLength(1);
  const requirementRef = inspection.requirementRefs[0];
  const evidenceId = workspace.context.evidenceId;
  const initial = await api<typeof inspection>(request, supervisor, `/inspections/${inspection.id}`);
  expect(initial.status).toBe("scheduled");
  expect(initial.checkResults ?? []).toEqual([]);
  expect(initial.resultStatus).toBeUndefined();
  expect(initial.nextWorkAllowed).toBe(false);

  await page.goto("/#/inspections");
  await page.getByLabel("개발 역할 선택").selectOption("SUP");
  await page.goto("/#/inspections");
  const inspectionRow = page.getByRole("button", { name: new RegExp(inspection.workName) });
  await expect(inspectionRow).toBeVisible();
  await inspectionRow.click();
  const actionGate = page.locator('[data-ui-component="action-gate"]');
  await actionGate.getByRole("button", { name: /^시작(?: 열기)?$/ }).click();
  const startResponsePromise = page.waitForResponse((response) => response.url().includes(`/inspections/${inspection.id}/start`)
    && response.request().method() === "POST");
  await page.getByRole("dialog").getByRole("button", { name: "확인 후 실행", exact: true }).click();
  expect((await startResponsePromise).status()).toBe(200);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const started = await api<typeof inspection>(request, supervisor, `/inspections/${inspection.id}`);
  expect(started.status).toBe("in_progress");
  expect(started.version).toBeGreaterThan(initial.version);
  expect(started.checkResults ?? []).toEqual([]);

  await actionGate.getByRole("button", { name: /^결과 제출(?: 열기| 입력 필요)?$/ }).click();
  const modal = page.getByRole("dialog");
  const widget = modal.locator('[data-ui-component="inspection-check-result-fields"]');
  await expect(widget).toBeVisible();
  const resultRow = widget.locator("fieldset");
  await expect(resultRow).toHaveCount(1);
  const itemIdField = resultRow.locator("input").nth(0);
  const requirementField = resultRow.locator("select").nth(0);
  const measuredField = resultRow.locator("input").nth(1);
  const unitField = resultRow.locator("input").nth(2);
  const resultField = resultRow.locator("select").nth(1);
  const rowEvidenceField = resultRow.locator("select[multiple]");
  await expect(itemIdField).toHaveValue("dimension");
  await expect(itemIdField).toHaveAttribute("readonly", "");
  await expect(requirementField).toHaveValue(`${requirementRef.objectType}:${requirementRef.objectId}:${requirementRef.version}`);
  const exactRequirementText = `Requirement · ${requirementRef.objectId} · v${requirementRef.version}`;
  await expect(resultRow.getByText(exactRequirementText, { exact: true })).toBeVisible();
  await expect(measuredField).toHaveValue("");
  await expect(unitField).toHaveValue("");
  await expect(resultField).toHaveValue("");
  expect(await rowEvidenceField.evaluate((select) => (select as HTMLSelectElement).selectedOptions.length)).toBe(0);

  // Empty results reach the actual server and fail atomically. The evidence
  // envelope is present so the failure is specifically the empty result set.
  await modal.getByLabel("명령 증빙 ID").fill(evidenceId);
  const emptySubmitPromise = page.waitForResponse((response) => response.url().includes(`/inspections/${inspection.id}/submit-results`)
    && response.request().method() === "POST");
  await modal.getByRole("button", { name: "확인 후 실행", exact: true }).click();
  const emptySubmit = await emptySubmitPromise;
  expect(emptySubmit.status()).toBe(409);
  expect((await emptySubmit.json()).code).toBe("MEASUREMENT_RESULTS_COMPLETE");
  await expect(modal).toBeVisible();
  const afterRejectedEmpty = await api<typeof inspection>(request, supervisor, `/inspections/${inspection.id}`);
  expect(afterRejectedEmpty).toMatchObject({ id: initial.id, version: started.version, status: "in_progress", nextWorkAllowed: false });
  expect(afterRejectedEmpty.checkResults ?? []).toEqual([]);
  expect(afterRejectedEmpty.resultStatus).toBeUndefined();

  const precision = "120.000000000000000001";
  await measuredField.focus();
  let typed = "";
  for (const character of precision.slice(0, 8)) {
    await page.keyboard.type(character);
    typed += character;
    await expect(measuredField).toBeFocused();
    await expect(measuredField).toHaveValue(typed);
  }
  const languagePicker = page.locator(".top-actions select").first();
  await languagePicker.selectOption("vi");
  await expect(measuredField).toHaveValue(typed);
  await expect(resultRow.getByText(exactRequirementText, { exact: true })).toBeVisible();
  await measuredField.focus();
  for (const character of precision.slice(8, 15)) {
    await page.keyboard.type(character);
    typed += character;
    await expect(measuredField).toBeFocused();
    await expect(measuredField).toHaveValue(typed);
  }
  await languagePicker.selectOption("en");
  await expect(measuredField).toHaveValue(typed);
  await expect(resultRow.getByText(exactRequirementText, { exact: true })).toBeVisible();
  await measuredField.focus();
  for (const character of precision.slice(15)) {
    await page.keyboard.type(character);
    typed += character;
    await expect(measuredField).toBeFocused();
    await expect(measuredField).toHaveValue(typed);
  }
  expect(typed).toBe(precision);
  await languagePicker.selectOption("ko");
  await expect(measuredField).toHaveValue(precision);
  await expect(resultRow.getByText(exactRequirementText, { exact: true })).toBeVisible();

  await unitField.fill("mm");
  await resultField.selectOption("pass");
  await rowEvidenceField.selectOption(evidenceId);
  expect(await rowEvidenceField.evaluate((select) => Array.from((select as HTMLSelectElement).selectedOptions, (option) => option.value))).toEqual([evidenceId]);
  const submitResponsePromise = page.waitForResponse((response) => response.url().includes(`/inspections/${inspection.id}/submit-results`)
    && response.request().method() === "POST");
  await modal.getByRole("button", { name: "확인 후 실행", exact: true }).click();
  const submitResponse = await submitResponsePromise;
  expect(submitResponse.status(), await submitResponse.text()).toBe(200);
  await expect(modal).toHaveCount(0);

  const submitted = await api<typeof inspection & { checkResults: Array<Record<string, unknown>> }>(request, supervisor, `/inspections/${inspection.id}`);
  expect(submitted.status).toBe("result_pending");
  expect(submitted.resultStatus).not.toBe("pass");
  expect(submitted.nextWorkAllowed).toBe(false);
  expect(submitted.checkResults).toEqual([{
    itemId: "dimension",
    requirementRef,
    measuredValue: precision,
    unit: "mm",
    result: "pass",
    evidenceIds: [evidenceId],
  }]);
});
