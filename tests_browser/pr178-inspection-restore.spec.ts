import { expect, test, type Locator, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";

type InspectionInput = {
  drawingId: string; locationId: string; requirementIds: string[]; evidenceIds: string[];
  workName: string; selfComplete: boolean; hold: boolean; precheck: Record<string, boolean>;
};
let apiOrigin = "";
let apiProcess: ChildProcess | undefined;
let fixtureDir = "";

if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ["--no-sandbox"] } });
}

test.beforeAll(async () => {
  const server = createServer();
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate fixture port");
  const port = address.port;
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  apiOrigin = `http://127.0.0.1:${port}`;
  fixtureDir = mkdtempSync(join(tmpdir(), "doul-inspection-restore-"));
  apiProcess = spawn(process.env.DOUL_TEST_PYTHON || "python3", [
    "-m", "services.api", "--demo", "--database", join(fixtureDir, "demo.sqlite3"), "--port", String(port),
  ], { cwd: process.cwd(), env: {
    ...process.env,
    DOUL_API_ALLOWED_ORIGINS: process.env.DOUL_TEST_BROWSER_ORIGIN || "http://127.0.0.1:5181",
    PYTHONPATH: [process.cwd(), process.env.PYTHONPATH].filter(Boolean).join(delimiter),
  }, stdio: "ignore" });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) throw new Error(`Fixture exited (${apiProcess.exitCode})`);
    try { if ((await fetch(`${apiOrigin}/health`)).ok) return; } catch { /* API is starting. */ }
    await new Promise(done => setTimeout(done, 150));
  }
  throw new Error("Fixture did not become healthy");
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

test.afterEach(async ({page})=>{
  // Finish forwarded fixture requests before Playwright closes the page/context.
  await page.unrouteAll({behavior:"wait"});
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${apiOrigin}${url.pathname.replace(/^\/api/, "")}${url.search}` });
    await route.fulfill({ response });
  });
});

async function openContractor(page: Page) {
  const workspace = page.waitForResponse(response => response.url().endsWith("/workspace") && response.ok());
  if (page.url().startsWith("http")) await page.reload();
  else await page.goto("/#/today");
  await workspace;
  const loaded = page.waitForResponse(response => response.url().endsWith("/workspace") && response.ok());
  await page.getByLabel("시험 사용자 역할 선택").selectOption("CON");
  await loaded;
  await page.goto("/#/inspections");
  const form = page.getByRole("form", { name: "자체검측 작성" });
  await expect(form.getByLabel("검측 기준 도면")).toBeEnabled();
  return form;
}

async function storedInput(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(value => value.startsWith("doul:session-form-draft:v1:inspection:"));
    if (!key) throw new Error("Inspection draft was not saved");
    return { key, payload: JSON.parse(sessionStorage.getItem(key)!).payload as InspectionInput };
  });
}

async function fillInspection(page: Page) {
  const form = await openContractor(page);
  const drawing = form.getByLabel("검측 기준 도면");
  await drawing.selectOption((await drawing.locator("option").nth(1).getAttribute("value"))!);
  const location = form.getByLabel("검측 위치");
  await expect(location).toBeEnabled();
  await location.selectOption((await location.locator("option").nth(1).getAttribute("value"))!);
  const requirement = form.getByRole("group", { name: "검측 기준", exact: true }).getByRole("checkbox").first();
  const evidence = form.getByRole("group", { name: "현장 증빙", exact: true }).getByRole("checkbox").first();
  await expect(requirement).toBeEnabled();
  await requirement.check();
  await evidence.check();
  await form.getByLabel("공종·작업명").fill("복원 후 확인할 자체검측");
  for (const label of ["자체검측 완료", "도면 확인", "자재 확인", "시험 확인", "선행 공정 확인", "변경사항 확인", "다음 공정 전 확인이 필요한 중지점"]) {
    await form.getByLabel(label, { exact: true }).check();
  }
  await expect(form.getByRole("button", { name: "자체검측 초안 저장", exact: true })).toBeEnabled();
  return storedInput(page);
}

async function expectRestored(form: Locator, input: InspectionInput) {
  await expect(form.getByLabel("검측 기준 도면")).toHaveValue(input.drawingId);
  await expect(form.getByLabel("검측 위치")).toHaveValue(input.locationId);
  await expect(form.getByLabel("공종·작업명")).toHaveValue(input.workName);
  await expect(form.getByRole("group", { name: "검측 기준", exact: true }).getByRole("checkbox").first()).toBeChecked();
  await expect(form.getByRole("group", { name: "현장 증빙", exact: true }).getByRole("checkbox").first()).toBeChecked();
  for (const label of ["자체검측 완료", "도면 확인", "자재 확인", "시험 확인", "선행 공정 확인", "변경사항 확인", "다음 공정 전 확인이 필요한 중지점"]) {
    await expect(form.getByLabel(label, { exact: true })).toBeChecked();
  }
  await expect(form.getByRole("button", { name: "자체검측 초안 저장", exact: true })).toBeEnabled();
}

test("complete inspection input survives reload and uses current scoped references only on explicit save", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && request.url().includes("/inspection-authoring/drafts")) requests.push(request.url()); });
  const original = await fillInspection(page);
  const scoped: Array<{ domainRef: { version: number } }> = [];
  page.on("response", async response => {
    const url = new URL(response.url());
    if (url.pathname.endsWith("/inspection-authoring/options") && url.search && response.ok()) {
      const options = await response.json();
      scoped.push(...options.requirements);
    }
  });
  const form = await openContractor(page);
  await expectRestored(form, original.payload);
  expect((await storedInput(page)).payload).toEqual(original.payload);
  expect(requests).toEqual([]);
  const responsePromise = page.waitForResponse(response => response.url().endsWith("/inspection-authoring/drafts") && response.request().method() === "POST");
  await form.getByRole("button", { name: "자체검측 초안 저장", exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  const { record } = await response.json();
  expect(record.requirementRefs.map((ref: { objectId: string }) => ref.objectId)).toEqual(original.payload.requirementIds);
  expect(record.requirementRefs[0].version).toBe(scoped[0].domainRef.version);
  expect(record.evidenceIds).toEqual(original.payload.evidenceIds);
  expect(record.status).toBe("draft");
  expect(record.nextWorkAllowed).toBe(false);
  await expect(page.getByRole("heading", { name: original.payload.workName, exact: true })).toBeVisible();
});

test("successful scoped options prune unavailable references without dropping valid saved selections", async ({ page }) => {
  const original = await fillInspection(page);
  await page.evaluate(({ key }) => {
    const entry = JSON.parse(sessionStorage.getItem(key)!);
    entry.payload.requirementIds.push("removed-requirement");
    entry.payload.evidenceIds.push("removed-evidence");
    sessionStorage.setItem(key, JSON.stringify(entry));
  }, original);
  await expectRestored(await openContractor(page), original.payload);
  await expect.poll(async () => (await storedInput(page)).payload).toEqual(original.payload);
});

test("temporary source failure preserves the full draft and disables save until a successful retry", async ({ page }) => {
  const original = await fillInspection(page);
  let fail = true;
  await page.route("**/inspection-authoring/options?*", async route => {
    if (fail) await route.abort("failed");
    else await route.fallback();
  });
  const form = await openContractor(page);
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(form.getByRole("button", { name: "자체검측 초안 저장", exact: true })).toBeDisabled();
  expect((await storedInput(page)).payload).toEqual(original.payload);
  fail = false;
  // Reload the page to retry scope sources after a transient network failure.
  // Keep the persisted draft intact until the refreshed options are available.
  const refreshedForm = await openContractor(page);
  await expectRestored(refreshedForm, original.payload);
  expect((await storedInput(page)).payload).toEqual(original.payload);
});

test("late scoped response after a role switch cannot alter the saved contractor draft", async ({ page }) => {
  const original = await fillInspection(page);
  let signalEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(done => { signalEntered = done; });
  const released = new Promise<void>(done => { release = done; });
  let delayed = false;
  await page.route("**/inspection-authoring/options?*", async route => {
    if (delayed) { await route.fallback(); return; }
    delayed = true;
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${apiOrigin}${url.pathname.replace(/^\/api/, "")}${url.search}` });
    signalEntered();
    await released;
    // Simulate sources becoming unavailable in this older response.
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, requirements: [], evidence: [] } });
  });
  let loaded = page.waitForResponse(response => response.url().endsWith("/workspace") && response.ok());
  await page.reload();
  await loaded;
  const picker = page.getByLabel("시험 사용자 역할 선택");
  await picker.selectOption("CON");
  await page.goto("/#/inspections");
  await entered;
  loaded = page.waitForResponse(response => response.url().endsWith("/workspace") && response.ok());
  await picker.selectOption("SUP");
  await loaded;
  release();
  expect((await storedInput(page)).payload).toEqual(original.payload);
  loaded = page.waitForResponse(response => response.url().endsWith("/workspace") && response.ok());
  await picker.selectOption("CON");
  await loaded;
  await page.goto("/#/inspections");
  await expectRestored(page.getByRole("form", { name: "자체검측 작성" }), original.payload);
  expect((await storedInput(page)).payload).toEqual(original.payload);
});

test("a failed sessionStorage write is disclosed during inspection authoring", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key: string, value: string) {
      if (key.startsWith("doul:session-form-draft:v1:"))
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  const form = await openContractor(page);
  await form.getByRole("textbox", { name: "공종·작업명" }).fill("입력 유지하되 임시저장 불가 경고");
  await expect(form.getByRole("alert")).toContainText("임시저장하지 못했습니다");
  await expect(form.getByRole("textbox", { name: "공종·작업명" }))
    .toHaveValue("입력 유지하되 임시저장 불가 경고");
  await expect(form.getByRole("status")).toHaveCount(0);
});
