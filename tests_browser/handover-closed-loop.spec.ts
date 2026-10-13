import { selectCommandEvidence } from "./command-evidence-helper";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { localDateTime } from "./support/local-datetime";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { createInterface } from "node:readline";

type Ref = { objectType: string; objectId: string; version: number };
type Fixture = {
  projectId: string; scope: Record<string, string>; requirementRef: Ref; drawingRef: Ref;
  evidenceId: string; retestEvidenceId: string; commissioningProfileRef: Ref;
  inspectionRef: Ref; procedureRef: Ref; issueRef: Ref; actionRef: Ref;
  reservationIssueRef: Ref; reservationActionRef: Ref;
  handoverProfileRef: Ref; assets: Ref[]; actors: Record<string, string>;
  warrantyPeriodRef: Ref; documents: Record<string, Ref>;
  responsibleOrganizationId: string;
  tomorrow: string; warrantyStartAt: string;
  disclosure: string;
};

const python = process.env.DOUL_TEST_PYTHON || "python3";

if (process.env.HO_TEST_CHROMIUM) test.use({ launchOptions: { executablePath: process.env.HO_TEST_CHROMIUM } });

async function stopApi(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
  ]);
  if (graceful) return;
  child.kill("SIGKILL");
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
}

function testOrigin(): string {
  const baseURL = test.info().project.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Playwright baseURL is required for the HTTP fixture");
  return new URL(baseURL).origin;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate fixture port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startApi(origin: string): Promise<{ child: ChildProcess; base: string; fixture: Fixture }> {
  const port = await freePort();
  const child = spawn(python, ["tests_browser/support/handover_api_fixture.py", "--port", String(port)], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DOUL_API_ALLOWED_ORIGINS: origin },
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const lines = createInterface({ input: child.stdout! });
  const ready = new Promise<Fixture>((resolve, reject) => {
    const fail = (error: Error) => { clearTimeout(timeout); reject(error); };
    const timeout = setTimeout(() => fail(new Error(`Fixture startup timed out: ${stderr}`)), 15000);
    child.once("error", (error) => fail(error));
    child.once("exit", (code) => fail(new Error(`Fixture exited ${code}: ${stderr}`)));
    lines.on("line", (line) => {
      try {
        const value = JSON.parse(line) as Partial<Fixture>;
        if (value.projectId && value.commissioningProfileRef) {
          clearTimeout(timeout);
          resolve(value as Fixture);
        }
      } catch { /* API request logs precede the fixture metadata. */ }
    });
  });
  let fixture: Fixture;
  try {
    fixture = await ready;
  } catch (error) {
    await stopApi(child);
    throw error;
  }
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return { child, base, fixture };
    } catch { /* Wait for uvicorn to bind. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stopApi(child);
  throw new Error(`Fixture server did not become healthy: ${stderr}`);
}

function fetchFixture(route: Route, base: string, origin: string) {
  const request = route.request();
  return route.fetch({
    url: request.url().replace(/http:\/\/127\.0\.0\.1:\d+\/api/, base),
    headers: { ...request.headers(), origin },
    // Playwright retries only ECONNRESET here. Retry idempotent reads; never
    // replay a command whose server-side outcome may be unknown.
    maxRetries: request.method() === "GET" ? 1 : 0,
  });
}

async function useRole(page: Page, role: "CON" | "SUP" | "OWN") {
  const rolePicker = page.locator(".top-actions .role-picker select").nth(1);
  // A role change signs in and reloads the authorized workspace asynchronously.
  // Do not race its initial 'Today' redirect with the next menu click.
  const changingRole = (await rolePicker.inputValue()) !== role;
  const ready = changingRole
    ? page.waitForResponse(response =>
      /\/projects\/[^/]+\/workspace(?:\?|$)/.test(response.url())
      && response.request().method() === "GET" && response.ok(), { timeout: 20000 })
    : null;
  await rolePicker.selectOption(role);
  await expect(rolePicker).toHaveValue(role);
  if (ready) await ready;
  await expect(page.locator(".loading-panel")).toHaveCount(0, { timeout: 20000 });
  await page.getByRole("navigation").getByRole("button", { name: /commissioning.*handover.*warranty/i }).click();
  await expect(page).toHaveURL(/#\/completion$/, { timeout: 10000 });
  await expect(page.locator("[data-ui-component='completion-handover-workspace']")).toBeVisible({ timeout: 15000 });
}

type CommandInput = string | boolean | Ref | Ref[] | Record<string, unknown> | Array<Record<string, unknown>>;

const commandFieldLabels: Record<string, RegExp> = {
  closureRef: /closure evidence reference|종결 근거 참조|tham chiếu bằng chứng đóng hồ sơ/i,
  precommissioningChecklist: /precommission|checklist|시운전|점검/i,
  testResultRef: /testResultRef|시험 결과 증빙 참조|시험 증빙/i,
  outcome: /outcome|^시험 결과$/i,
  acceptanceCriteriaMet: /acceptanceCriteria|인수 기준 충족 여부|합격 기준/i,
  failureReason: /failureReason|부적합 사유|실패 사유/i,
  reworkReason: /rework reason|재작업 사유|lý do (?:yêu cầu )?làm lại/i,
  correctionActionRefs: /correctionAction|시정.?조치/i,
  currentIssueRefs: /currentIssueRefs|current open issue references|현재 미결 지적사항 참조|vấn đề hiện tại/i,
  issueRef: /issueRef|issue reference|지적사항 참조|tham chiếu vấn đề/i,
  retestBasisRefs: /retestBasis|재시험 근거/i,
  punchIssueRefs: /punchIssue|punch issue|미비사항|잔여 지적사항/i,
  ownerDecisionRef: /owner decision reference|발주처 결정/i,
  closureRef: /closure reference|종결 근거 참조/i,
  reinspectionRef: /reinspection reference|재검측 참조/i,
  acceptedScope: /acceptedScope|인수 범위/i,
  effectiveAt: /effectiveAt|적용 시각/i,
  warrantyTrigger: /warrantyTrigger|보증 개시 여부/i,
  actionRefs: /actionRefs|조치 참조/i,
  responseDueAt: /responseDueAt|조치 응답 기한/i,
  remedySummary: /remedySummary|보수 요약/i,
  decisionReason: /decisionReason|결정 사유/i,
  selectedOption: /selectedOption|선택 옵션/i,
  evidenceIds: /evidence ids|처리 근거 증빙번호/i,
};

async function exactReferenceOption(select: Locator, ref: Ref): Promise<string> {
  const options = await select.locator("option").evaluateAll(nodes => nodes.map(node => ({
    value: (node as HTMLOptionElement).value,
    label: (node as HTMLOptionElement).textContent || "",
  })));
  const matches = options.filter(option => {
    try {
      const parsed = JSON.parse(option.value) as Partial<Ref>;
      return parsed.objectType === ref.objectType && parsed.objectId === ref.objectId && parsed.version === ref.version;
    } catch {
      const [objectType, objectId, version] = option.value.split(":");
      return objectType === ref.objectType && objectId === ref.objectId && Number(version) === ref.version;
    }
  });
  expect(matches, `exact ${ref.objectType} ${ref.objectId} 기록 제${ref.version}차 option; options: ${options.map(option => option.label).join(" | ")}`).toHaveLength(1);
  return matches[0].value;
}
const workbenchFieldLabels: Record<string, RegExp> = {
  responsiblePartyId: /responsible party|담당자/i,
  responsibleOrganizationId: /responsible organization|company 번호|담당 회사 번호/i,
  dueAt: /due at|기한|처리기한/i,
  actionIds: /action 번호s|연결 조치 번호/i,
  closureEvidenceIds: /closureEvidenceIds|closure evidence|종결 증빙/i,
  correction: /correction|시정.?조치 내용/i,
  rootCause: /root cause|원인/i,
  preventiveAction: /preventive action|재발방지 대책/i,
  failureReason: /failureReason|failure reason|부적합 사유|실패 사유/i,
  "검측 항목·측정 결과": /검측 항목|check results/i,
  "접수 시각": /접수 시각|received at/i,
  "검측 예정시각": /검측 예정|scheduled at/i,
};

async function runCompletionCommand(
  page: Page,
  command: RegExp,
  fields: Record<string, CommandInput> = {},
  evidenceIds: string[] = [],
  expectedFailureCode?: string,
) {
  const workspace = page.locator("[data-ui-component='completion-handover-workspace']");
  const button = workspace.locator(".completion-commands").getByRole("button", { name: command });
  const visible = await workspace.locator(".completion-commands button").allTextContents();
  await expect(button, `server must expose an available ${command} command; visible: ${visible.join(" | ")}`).toBeEnabled();
  await button.click();
  const dialog = page.getByRole("dialog");
  if (/refresh.*issue references/i.test(command.source)) {
    const selection = dialog.getByLabel(commandFieldLabels.currentIssueRefs);
    await expect(selection).toBeVisible();
    expect(await selection.locator("option:checked").count(), "current issue refs must start unselected").toBe(0);
  }
  if (/refresh.*remedy references/i.test(command.source)) {
    const issueSelection = dialog.getByLabel(commandFieldLabels.issueRef);
    const actionSelection = dialog.getByLabel(commandFieldLabels.actionRefs);
    await expect(issueSelection).toBeVisible();
    await expect(actionSelection).toBeVisible();
    expect(await issueSelection.inputValue(), "current issue must start with an empty selection").toBe("");
    expect(await actionSelection.locator("option:checked").count(), "current Actions must start unselected").toBe(0);
  }
  if (/close warranty claim/i.test(command.source)) {
    const closureSelect = dialog.getByLabel(commandFieldLabels.closureRef);
    const closureRef = fields.closureRef as Ref;
    await expect(closureSelect).toBeVisible();
    expect(await closureSelect.inputValue(), "closure Issue must start unselected").toBe("");
    const options = await closureSelect.locator("option").evaluateAll((nodes) => nodes
      .map((node) => (node as HTMLOptionElement).value)
      .filter(Boolean)
      .map((value) => JSON.parse(value) as Ref));
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      objectType: "Issue", objectId: closureRef.objectId, version: closureRef.version,
    });
  }
  for (const [field, value] of Object.entries(fields)) {
    const label = commandFieldLabels[field] || new RegExp(field, "i");
    const control = dialog.getByLabel(label)
      .or(dialog.getByRole("textbox", { name: label }))
      .or(dialog.getByRole("combobox", { name: label }));
    await expect(control, `command field ${field} should be exposed with its current localized label`).toHaveCount(1, { timeout: 5000 });
    if (value && typeof value === "object" && !Array.isArray(value) && "objectType" in value && typeof value.objectId === "string") {
      const isSelect = await control.evaluateAll((nodes) => nodes.some((node) => node instanceof HTMLSelectElement));
      if (isSelect) {
        await control.selectOption(await exactReferenceOption(control, value as Ref));
      } else {
        await control.fill(JSON.stringify(value));
      }
    } else if (Array.isArray(value) && value.length && value.every((item) => item && typeof item === "object" && "objectType" in item)) {
      const select = control;
      const isSelect = await select.evaluateAll((nodes) => nodes.some((node) => node instanceof HTMLSelectElement));
      if (isSelect) {
        const optionValues: string[] = [];
        for (const ref of value as Ref[]) {
          optionValues.push(await exactReferenceOption(select, ref));
        }
        await select.selectOption(optionValues);
      } else {
        // Some command fields are still JSON controls. Use only exact refs
        // captured from the server fixture and leave all validation to API gates.
        await select.fill(JSON.stringify(value));
      }
    } else if (typeof value === "boolean") {
      await control.selectOption(String(value));
    } else if (Array.isArray(value) || (value && typeof value === "object")) {
      await control.fill(JSON.stringify(value));
    } else if (await control.evaluateAll((nodes) => nodes.some((node) => node instanceof HTMLSelectElement))) {
      await control.selectOption(String(value));
    } else {
      await control.fill(String(value));
    }
  }
  if (evidenceIds.length) {
    const evidenceInput = dialog.locator(".command-evidence-picker");
    await expect(evidenceInput, "command evidence IDs are an explicit per-transition input").toHaveCount(1, { timeout: 5000 });
    await selectCommandEvidence(dialog,evidenceIds);
  }
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/api/projects/") && !response.url().endsWith("/workspace"));
  const refreshedWorkspace = expectedFailureCode
    ? undefined
    : page.waitForResponse((response) => response.request().method() === "GET" && response.url().includes("/workspace"));
  await dialog.getByRole("button", { name: /execute|확인 후 실행/i }).click();
  const response = await responsePromise;
  const body = await response.json();
  if (expectedFailureCode) {
    expect(response.status(), JSON.stringify(body)).toBe(409);
    expect(body.code).toBe(expectedFailureCode);
    return body;
  }
  expect(response.status(), JSON.stringify(body)).toBe(200);
  await expect(dialog).toHaveCount(0);
  await refreshedWorkspace!;
  return body.record;
}

async function runWorkbenchCommand(page: Page, route: "issues" | "inspections" | "actions", recordTitle: string, command: RegExp,
  fields: Record<string, string | string[]> = {}, evidenceIds: string[] = []) {
  const workbench = page.locator(`[data-workbench-route='${route}']`);
  const row = workbench.locator(".record-list button").filter({ hasText: recordTitle });
  await expect(row, `authorized workspace row ${recordTitle}`).toHaveCount(1);
  await row.click();
  const gate = workbench.locator('[data-ui-component="action-gate"]');
  const action = gate.getByRole("button", { name: command });
  await expect(action, `server exposes ${command} for ${recordTitle}`).toBeEnabled();
  await action.click();
  const dialog = page.getByRole("dialog");
  for (const [field, value] of Object.entries(fields)) {
    if (field === "checkResults" || field === "검측 항목·측정 결과") {
      if (typeof value !== "string") throw new Error("Inspection check test inputs must be explicit JSON rows");
      const checks = JSON.parse(value) as Array<Record<string, any>>;
      const editor = dialog.locator('[data-ui-component="inspection-check-result-fields"]');
      await expect(editor, "inspection result entry is a typed UI with current contract references").toBeVisible();
      for (const check of checks) {
        let row = editor.locator("fieldset").filter({ has: page.locator(`input[value=${JSON.stringify(check.itemId)}]`) });
        if (await row.count() === 0) {
          await editor.getByRole("button", { name: /add inspection result|추가 검측 결과/i }).click();
          row = editor.locator("fieldset").last();
          await row.getByLabel(/inspection item 번호|검측 항목 번호/i).fill(check.itemId);
          row = editor.locator("fieldset").filter({ has: page.locator(`input[value=${JSON.stringify(check.itemId)}]`) });
        }
        await row.getByRole("combobox").first().selectOption(`${check.requirementRef.objectType}:${check.requirementRef.objectId}:${check.requirementRef.version}`);
        await row.getByLabel(/measured value|측정값/i).fill(String(check.measuredValue));
        await row.getByLabel(/^unit$|^단위$/i).fill(check.unit);
        await row.getByRole("combobox").nth(1).selectOption(check.result);
        await row.getByRole("listbox").selectOption(check.evidenceIds);
        await row.getByLabel(/note \(optional\)|비고 \(선택\)/i).fill(check.note || "");
      }
      continue;
    }
    const label = workbenchFieldLabels[field] || new RegExp(field, "i");
    const control = dialog.getByLabel(label)
      .or(dialog.getByRole("textbox", { name: label }))
      .or(dialog.getByRole("combobox", { name: label }));
    await expect(control, `field ${field} is part of the server command contract`).toHaveCount(1);
    if (Array.isArray(value)) await control.fill(JSON.stringify(value));
    else if (await control.evaluateAll((nodes) => nodes.some((node) => node instanceof HTMLSelectElement))) await control.selectOption(value);
    else await control.fill(value);
  }
  if (evidenceIds.length) await selectCommandEvidence(dialog,evidenceIds);
  const posted = page.waitForResponse((response) => response.request().method() === "POST" && /\/api\/projects\/.*\/(issues|inspections|actions)\/[^/]+\//.test(new URL(response.url()).pathname));
  const refreshed = page.waitForResponse((response) => response.request().method() === "GET" && response.url().includes("/workspace"));
  await dialog.getByRole("button", { name: /execute|확인 후 실행/i }).click();
  const response = await posted;
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(200);
  await expect(dialog).toHaveCount(0);
  await refreshed;
  return body.record;
}

async function runOwnerDecisionCommand(page: Page, command: RegExp, commandName: string, fields: Record<string, string> = {}) {
  const owner = page.locator("[data-owner-governance='true']");
  const button = owner.getByRole("button", { name: command });
  await expect(button, `Owner UI must expose ${commandName}`).toBeEnabled();
  await button.click();
  const dialog = page.getByRole("dialog");
  for (const [field, value] of Object.entries(fields)) {
    const labels: Record<string, RegExp> = {
      decision: /^(decision|결정)$/i,
      decisionReason: /decision reason|결정 사유/i,
      selectedOption: /selected option|선택 대안/i,
      decisionAt: /decision at|결정 시각/i,
    };
    const label = labels[field] || new RegExp(field, "i");
    const control = dialog.getByLabel(label).or(dialog.getByRole("textbox", { name: label })).or(dialog.getByRole("combobox", { name: label }));
    await expect(control, `${commandName} field ${field} should be exposed`).toHaveCount(1);
    if (await control.evaluateAll((nodes) => nodes.some((node) => node instanceof HTMLSelectElement))) await control.selectOption(value);
    else await control.fill(value);
  }
  const suffix = `/${commandName.replaceAll("_", "-")}`;
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.includes("/owner-decisions/") && new URL(response.url()).pathname.endsWith(suffix));
  const refreshed = page.waitForResponse((response) => response.request().method() === "GET" && response.url().includes("/workspace"));
  await dialog.getByRole("button", { name: /execute|confirm|확인 후 실행/i }).click();
  const response = await responsePromise;
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(200);
  await expect(dialog).toHaveCount(0);
  await refreshed;
  return body.record;
}

test("fixture bridge retries a reset GET once and never replays a reset POST", async ({ page }) => {
  let getAttempts = 0;
  let postAttempts = 0;
  const server = createHttpServer((request, response) => {
    if (request.method === "GET") {
      getAttempts += 1;
      if (getAttempts === 1) { request.socket.destroy(); return; }
      response.writeHead(200, { "content-type": "text/plain" }).end("GET recovered");
      return;
    }
    if (request.method === "POST") {
      postAttempts += 1;
      request.socket.destroy();
      return;
    }
    response.writeHead(405).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate retry fixture port");
  const upstream = `http://127.0.0.1:${address.port}`;
  const path = "/api/fixture-bridge-retry-check";
  await page.route(`**${path}`, async (route) => {
    try { await route.fulfill({ response: await fetchFixture(route, upstream, testOrigin()) }); }
    catch { await route.abort(); }
  });
  try {
    await page.goto("/");
    const getBody = await page.evaluate(async (url) => await (await fetch(url)).text(), path);
    expect(getBody).toBe("GET recovered");
    expect(getAttempts).toBe(2);
    const postFailed = await page.evaluate(async (url) => {
      try { await fetch(url, { method: "POST", body: "command" }); return false; }
      catch { return true; }
    }, path);
    expect(postFailed).toBe(true);
    expect(postAttempts).toBe(1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("real Completion UI creates a planned commissioning package and respects the missing current procedure gate", async ({ page }) => {
  test.setTimeout(90000);
  const origin = testOrigin();
  const { child, base, fixture } = await startApi(origin);
  try {
    let latestWorkspace: any;
    await page.route("**/api/**", async (route) => {
      const response = await fetchFixture(route, base, origin);
      if (route.request().url().includes("/workspace")) {
        latestWorkspace = await response.json();
        await route.fulfill({ response, json: latestWorkspace });
      } else await route.fulfill({ response });
    });
    await page.goto("/#/completion");
    await page.locator(".top-actions .role-picker select").first().selectOption("en");
    await useRole(page, "CON");

    const workspace = page.locator("[data-ui-component='completion-handover-workspace']");
    await workspace.locator('[data-ui-component="completion-create-action"] button').click();
    const create = page.getByRole("dialog");
    await create.getByLabel(/title/i).fill("Browser commissioned system");
    await create.getByLabel(/number/i).fill("CM-BROWSER-01");
    await create.getByLabel(/^시스템$|^system$/i).fill("SYS-BROWSER");
    const choose = async (label: RegExp, ref: Ref) => {
      const select = create.getByLabel(label);
      await expect(select).toBeVisible({ timeout: 5000 });
      await select.selectOption(await exactReferenceOption(select, ref));
    };
    await choose(/profile/i, fixture.commissioningProfileRef);
    await choose(/inspection/i, fixture.inspectionRef);
    await choose(/drawing/i, fixture.drawingRef);
    const created = page.waitForResponse((response) => response.request().method() === "POST" && /\/commissioning-packages$/.test(response.url()));
    await create.getByRole("button", { name: /save draft/i }).click();
    const createResponse = await created;
    expect(createResponse.status()).toBe(201);
    const recordId = (await createResponse.json()).record.id as string;
    await expect(workspace.getByRole("button", { name: /Browser commissioned system/ })).toBeVisible();
    await workspace.getByRole("button", { name: /Browser commissioned system/ }).click();

    await useRole(page, "SUP");
    await workspace.getByRole("button", { name: /Browser commissioned system/ }).click();
    const current = latestWorkspace.items.find((candidate: any) => candidate.record.id === recordId);
    expect(current.record.status).toBe("planned");
    expect(current.record.data.testResultHistory).toEqual([]);
    expect(current.actions.find((action: any) => action.command === "start_prerequisite_review")?.blockedReason?.code).toBe("COMMISSIONING_PROCEDURE_INVALID");
    const blocked = workspace.locator(".completion-commands").getByRole("button", { name: /start prerequisite review/i });
    await expect(blocked).toBeDisabled();
  } finally {
    await stopApi(child);
  }
});

test("real Completion UI preserves Owner reservation proposal inputs on a handover draft", async ({ page }) => {
  test.setTimeout(90000);
  const origin = testOrigin();
  const { child, base, fixture } = await startApi(origin);
  try {
    let latestWorkspace: any;
    await page.route("**/api/**", async (route) => {
      const response = await fetchFixture(route, base, origin);
      if (route.request().url().includes("/workspace")) {
        latestWorkspace = await response.json();
        await route.fulfill({ response, json: latestWorkspace });
      } else await route.fulfill({ response });
    });
    await page.goto("/#/completion");
    await page.locator(".top-actions .role-picker select").first().selectOption("en");
    await useRole(page, "CON");
    const workspace = page.locator("[data-ui-component='completion-handover-workspace']");
    await workspace.getByRole("tab", { name: /handover/i }).click();
    await workspace.locator('[data-ui-component="completion-create-action"] button').click();
    const create = page.getByRole("dialog");
    await create.getByLabel(/title/i).fill("Browser handover reservation draft");
    await create.getByLabel(/number/i).fill("HO-BROWSER-01");
    await create.getByLabel(/^system$/i).fill("SYS-BROWSER");
    await create.getByLabel(/scope id/i).fill("SYS-BROWSER-SEGMENT-A");
    const choose = async (label: RegExp, ref: Ref) => {
      const select = create.getByLabel(label);
      await expect(select).toBeVisible({ timeout: 5000 });
      await select.selectOption(await exactReferenceOption(select, ref));
    };
    await choose(/profile/i, fixture.handoverProfileRef);
    await create.getByLabel(/location/i).selectOption(fixture.scope.locationId);
    await choose(/asset/i, fixture.assets[0]);
    await choose(/open issue/i, fixture.issueRef);
    const reservation = create.locator('[data-ui-component="handover-reservation-inputs"]');
    await expect(reservation).toBeVisible();
    await reservation.getByLabel(/reservation owner/i).selectOption(fixture.actors.OWN);
    const reservationDue = new Date(fixture.tomorrow);
    reservationDue.setSeconds(0, 0);
    const reservationDueAt = reservationDue.toISOString();
    await reservation.getByLabel(/due at/i).fill(await localDateTime(page, reservationDueAt));
    await reservation.getByLabel(/closure requirement/i).fill("Verify and close the remaining punch issue");
    const created = page.waitForResponse((response) => response.request().method() === "POST" && /\/handover-packages$/.test(response.url()));
    await create.getByRole("button", { name: /save draft/i }).click();
    const response = await created;
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(201);
    const record = body.record;
    expect(record.status).toBe("draft");
    expect(record.data.reservationProposals).toEqual([{
      issueRef: fixture.issueRef,
      ownerPartyId: fixture.actors.OWN,
      dueAt: reservationDueAt,
      closureRequirement: "Verify and close the remaining punch issue",
    }]);
    await expect(workspace.getByRole("button", { name: /Browser handover reservation draft/ })).toBeVisible();
    await workspace.getByRole("button", { name: /Browser handover reservation draft/ }).click();
    await useRole(page, "CON");
    await workspace.getByRole("tab", { name: /handover/i }).click();
    await workspace.getByRole("button", { name: /Browser handover reservation draft/ }).click();
    const handoverItem = latestWorkspace.items.find((candidate: any) => candidate.record.id === record.id);
    expect(handoverItem.record.status).toBe("draft");
    const submit = handoverItem.actions.find((action: any) => action.command === "submit_handover_package");
    expect(submit).toBeTruthy();
    expect(submit.ready).toBe(false);
    await expect(workspace.locator(".completion-commands").getByRole("button", { name: /submit handover package/i })).toBeDisabled();
  } finally {
    await stopApi(child);
  }
});

async function runCompletionHandoverScenario(page: Page, continueWarranty: boolean, finalizeHandover = false): Promise<void> {
  test.setTimeout(continueWarranty || finalizeHandover ? 240000 : 120000);
  const origin = testOrigin();
  const { child, base, fixture } = await startApi(origin);
  try {
    let latestWorkspace: any;
    await page.route("**/api/**", async (route) => {
      const response = await fetchFixture(route, base, origin);
      if (route.request().url().includes("/workspace")) {
        latestWorkspace = await response.json();
        await route.fulfill({ response, json: latestWorkspace });
      } else await route.fulfill({ response });
    });

    const workspace = page.locator("[data-ui-component='completion-handover-workspace']");
    const evidenceRef = (id: string): Ref => {
      const ref = latestWorkspace.context.referenceCatalog.evidence.find((entry: any) => entry.ref.objectId === id)?.ref;
      expect(ref, `current readable Evidence ref for ${id}`).toBeTruthy();
      return ref as Ref;
    };
    const chooseRef = async (container: Locator, label: RegExp, ref: Ref) => {
      const select = container.getByLabel(label);
      await expect(select).toBeVisible({ timeout: 7000 });
      await select.selectOption(await exactReferenceOption(select, ref));
    };

    await page.goto("/#/completion");
    await page.locator(".top-actions .role-picker select").first().selectOption("en");
    await useRole(page, "CON");
    await workspace.locator('[data-ui-component="completion-create-action"] button').click();
    let create = page.getByRole("dialog");
    await create.getByLabel(/title/i).fill("Browser closed loop commissioning");
    await create.getByLabel(/number/i).fill("CM-CLOSED-01");
    await create.getByLabel(/^system$/i).fill("SYS-BROWSER");
    await chooseRef(create, /profile/i, fixture.commissioningProfileRef);
    await chooseRef(create, /inspection/i, fixture.inspectionRef);
    await chooseRef(create, /procedure/i, fixture.procedureRef);
    await chooseRef(create, /drawing/i, fixture.drawingRef);
    const createdCommissioning = page.waitForResponse((response) => response.request().method() === "POST" && /\/commissioning-packages$/.test(response.url()));
    await create.getByRole("button", { name: /save draft/i }).click();
    const commissioningResponse = await createdCommissioning;
    const commissioningBody = await commissioningResponse.json();
    expect(commissioningResponse.status(), JSON.stringify(commissioningBody)).toBe(201);
    expect(commissioningBody.record.data.testProcedureRefs).toContainEqual(fixture.procedureRef);
    const commissioningId = commissioningBody.record.id as string;
    await expect(workspace.getByRole("button", { name: /Browser closed loop commissioning/ })).toBeVisible();
    await workspace.getByRole("button", { name: /Browser closed loop commissioning/ }).click();

    await useRole(page, "SUP");
    await workspace.getByRole("button", { name: /Browser closed loop commissioning/ }).click();
    const initialAction = latestWorkspace.items.find((item: any) => item.record.id === commissioningId).actions.find((action: any) => action.command === "start_prerequisite_review");
    expect(initialAction, JSON.stringify(latestWorkspace.items.find((item: any) => item.record.id === commissioningId))).toBeTruthy();
    expect(initialAction.ready, JSON.stringify(initialAction)).toBe(true);
    await runCompletionCommand(page, /start prerequisite review/i);
    await runCompletionCommand(page, /start precommissioning/i);
    await runCompletionCommand(page, /declare test read/i, {
      precommissioningChecklist: [{ itemId: "P-01", completed: true, evidenceIds: [fixture.evidenceId] }],
    });
    await runCompletionCommand(page, /start test/i, {}, [fixture.evidenceId]);
    await useRole(page, "CON");
    await workspace.getByRole("button", { name: /Browser closed loop commissioning/ }).click();
    await runCompletionCommand(page, /submit test result/i, {
      testResultRef: evidenceRef(fixture.evidenceId),
      outcome: "fail", acceptanceCriteriaMet: false, failureReason: "Initial result outside tolerance",
    }, [fixture.evidenceId]);
    await useRole(page, "SUP");
    await workspace.getByRole("button", { name: /Browser closed loop commissioning/ }).click();
    await runCompletionCommand(page, /reject test/i, { failureReason: "Supervisor confirmed the failed reading" }, [fixture.evidenceId]);
    await runCompletionCommand(page, /require punch.*resolution/i, {
      punchIssueRefs: [fixture.issueRef], correctionActionRefs: [fixture.actionRef],
    });
    await useRole(page, "CON");
    await workspace.getByRole("button", { name: /Browser closed loop commissioning/ }).click();
    await runCompletionCommand(page, /request retest/i, { retestBasisRefs: [fixture.actionRef] }, [fixture.retestEvidenceId]);
    await useRole(page, "SUP");
    await workspace.getByRole("button", { name: /Browser closed loop commissioning/ }).click();
    await runCompletionCommand(page, /start test/i, {}, [fixture.retestEvidenceId]);
    await useRole(page, "CON");
    await workspace.getByRole("button", { name: /Browser closed loop commissioning/ }).click();
    await runCompletionCommand(page, /submit test result/i, {
      testResultRef: evidenceRef(fixture.retestEvidenceId),
      outcome: "pass", acceptanceCriteriaMet: true,
    }, [fixture.retestEvidenceId]);
    await useRole(page, "SUP");
    await workspace.getByRole("button", { name: /Browser closed loop commissioning/ }).click();
    await runCompletionCommand(page, /accept test/i, {}, [fixture.retestEvidenceId]);
    // Resolve the referenced Punch through the existing linked Issue/Inspection
    // UI. Commissioning cannot be marked ready while a referenced Punch stays open.
    await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
    const punchTitle = "F-07 browser commissioning punch";
    await runWorkbenchCommand(page, "issues", punchTitle, /assign|담당자 배정/i, {
      responsiblePartyId: fixture.actors.CON,
      responsibleOrganizationId: fixture.responsibleOrganizationId,
      dueAt: fixture.tomorrow,
      actionIds: [fixture.actionRef.objectId],
    });
    await useRole(page, "CON");
    await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
    await runWorkbenchCommand(page, "issues", punchTitle, /start correction|시정 시작/i);

    await page.goto("/#/inspections");
    await expect(page.getByTestId("inspection-case-flow")).toBeVisible();
    const casePanel = page.getByTestId("inspection-case-flow");
    const inspectionPicker = casePanel.getByLabel(/source inspection|root inspection|원 검측 선택/i);
    await inspectionPicker.selectOption(fixture.inspectionRef.objectId);
    const issueCard = casePanel.locator(".inspection-case-issue").filter({ hasText: punchTitle });
    await expect(issueCard).toBeVisible();
    const reinspectionForm = issueCard.getByRole("form", { name: /request linked reinspection|연결된 재검측 요청/i });
    const reinspectionName = "F-07 browser Punch reinspection";
    await reinspectionForm.getByLabel(/work name|작업명/i).fill(reinspectionName);
    await reinspectionForm.getByLabel(/requested inspection time|재검측 요청 일시/i).fill(await localDateTime(page, Date.now() + 3600000));
    await reinspectionForm.getByLabel(/contractor self inspection is complete|시공자 자체검측 완료/i).check();
    for (const label of [/drawing checked|도면 확인/i, /material checked|자재 확인/i, /test checked|시험 확인/i, /previous work checked|선행 작업 확인/i, /changes checked|변경사항 확인/i]) {
      await reinspectionForm.getByLabel(label).check();
    }
    await reinspectionForm.getByLabel(new RegExp(fixture.evidenceId)).check();
    const reinspectionPost = page.waitForResponse((response) => response.request().method() === "POST" && /inspection-cases\/.*\/issues\/.*\/reinspections/.test(response.url()));
    await reinspectionForm.getByRole("button", { name: /submit reinspection request|재검측 요청 제출/i }).click();
    const reinspectionResponse = await reinspectionPost;
    const reinspectionBody = await reinspectionResponse.json();
    expect(reinspectionResponse.status(), JSON.stringify(reinspectionBody)).toBe(201);
    const reinspectionId = reinspectionBody.reinspection.id as string;

    await useRole(page, "SUP");
    await page.goto("/#/inspections");
    const punchReinspection = "F-07 browser Punch reinspection";
    await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
    await runWorkbenchCommand(page, "issues", punchTitle, /start reinspection|재검측 시작/i);
    await page.getByRole("navigation").getByRole("button", { name: /inspection.*acceptance/i }).click();
    await runWorkbenchCommand(page, "inspections", punchReinspection, /receive|접수/i, { "접수 시각": new Date().toISOString() });
    await runWorkbenchCommand(page, "inspections", punchReinspection, /schedule|일정 배정/i, { "검측 예정시각": new Date(Date.now() + 3600000).toISOString() });
    await runWorkbenchCommand(page, "inspections", punchReinspection, /start|시작/i);
    const passingChecks = JSON.stringify([{ itemId: "dimension", requirementRef: fixture.requirementRef, result: "pass", evidenceIds: [fixture.evidenceId, fixture.retestEvidenceId], measuredValue: 1, unit: "count" }]);
    await runWorkbenchCommand(page, "inspections", punchReinspection, /submit results|결과 제출/i, { "검측 항목·측정 결과": passingChecks }, [fixture.evidenceId, fixture.retestEvidenceId]);
    await runWorkbenchCommand(page, "inspections", punchReinspection, /mark compliant|pass|적합 판정/i, {}, [fixture.evidenceId, fixture.retestEvidenceId]);
    expect(latestWorkspace.items.find((item: any) => item.record.id === reinspectionId)?.record.status).toBe("passed");

    // A passed hold point remains unreleased until its exact final FM-09
    // snapshot is signed by both required roles. The API fixture uses an
    // explicit test-only verifier; it is not evidence of provider validation.
    const passedReinspection = latestWorkspace.items.find((item: any) => item.record.id === reinspectionId).record;
    await page.goto("/#/documents");
    await page.getByLabel(/document form/i).selectOption("FM-09");
    await page.getByLabel(/document source/i).selectOption(reinspectionId);
    await page.getByLabel(/document output language/i).selectOption("vi");
    await page.getByLabel(/render type/i).selectOption("final");
    const formValues: Record<string, string> = {
      "inspection.no": reinspectionId,
      "inspection.work_name": passedReinspection.workName,
      "work.discipline": latestWorkspace.context.scope.discipline,
      "work.location": latestWorkspace.context.scope.locationId,
      "inspection.datetime": await localDateTime(page, Date.now()),
      "inspection.place": latestWorkspace.context.scope.locationId,
      "basis.drawings": fixture.drawingRef.objectId,
      "basis.criteria": fixture.requirementRef.objectId,
      "basis.tests": "dimension",
      "result.status": "pass",
      "result.next_work_allowed": "false",
    };
    for (const [name, value] of Object.entries(formValues)) {
      const field = page.locator(`[name="${name}"]`);
      if (await field.evaluate((node) => node.tagName.toLowerCase()) === "select") await field.selectOption(value);
      else await field.fill(value);
    }
    const finalRenderResponsePromise = page.waitForResponse((response) => response.url().includes("/forms/FM-09/render") && response.request().method() === "POST");
    await page.getByRole("button", { name: /generate final html snapshot/i }).click();
    const finalRenderResponse = await finalRenderResponsePromise;
    const finalRenderBody = await finalRenderResponse.json();
    expect(finalRenderResponse.status(), JSON.stringify(finalRenderBody)).toBe(200);
    expect(finalRenderBody.status).toBe("final");
    expect(finalRenderBody.sourceDomainRefs[0]).toMatchObject({ objectId: reinspectionId, version: passedReinspection.version });
    const finalDocumentId = finalRenderBody.id as string;
    const signDocument = async (role: "owner_side_supervisor" | "contractor_technical_lead") => {
      const signing = page.getByRole("region", { name: /legal signature/i });
      await signing.getByLabel(/current signer role/i).selectOption(role);
      await signing.getByLabel(/signing method/i).selectOption("approved_e_signature");
      const signed = page.waitForResponse((response) => response.url().includes(`/documents/${finalDocumentId}/sign`) && response.request().method() === "POST");
      await signing.getByRole("button", { name: /request signature verification/i }).click();
      const response = await signed;
      expect(response.status(), await response.text()).toBe(200);
    };
    await signDocument("owner_side_supervisor");
    await useRole(page, "CON");
    await page.goto("/#/documents");
    await page.getByLabel("Select document", { exact: true }).selectOption(finalDocumentId);
    await signDocument("contractor_technical_lead");
    const verifierReport = await (await fetch(`${base}/_test/signature-verifications`)).json();
    expect(verifierReport).toMatchObject({
      testOnly: true,
      verifier: "MockTrustedVerifier",
      calls: [
        { signerRole: "owner_side_supervisor", documentHash: finalRenderBody.renderHash, method: "approved_e_signature" },
        { signerRole: "contractor_technical_lead", documentHash: finalRenderBody.renderHash, method: "approved_e_signature" },
      ],
    });

    await useRole(page, "SUP");
    await page.goto("/#/inspections");
    await runWorkbenchCommand(page, "inspections", punchReinspection, /release next work|후속공정 허용/i, {}, [fixture.evidenceId]);
    expect(latestWorkspace.items.find((item: any) => item.record.id === reinspectionId)?.record.nextWorkAllowed).toBe(true);
    await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
    await runWorkbenchCommand(page, "issues", punchTitle, /review closure|close/i, {
      closureEvidenceIds: [fixture.evidenceId, fixture.retestEvidenceId],
    }, [fixture.evidenceId, fixture.retestEvidenceId]);

    await page.getByRole("navigation").getByRole("button", { name: /commissioning.*handover.*warranty/i }).click();
    await workspace.getByRole("button", { name: /Browser closed loop commissioning/ }).click();
    const completedPunch = latestWorkspace.items.find((item: any) => item.record.id === fixture.issueRef.objectId);
    const commissioningReady = latestWorkspace.items.find((item: any) => item.record.id === commissioningId);
    const readyAction = commissioningReady.actions.find((action: any) => action.command === "mark_ready_for_handover");
    const currentPunchRef = latestWorkspace.context.referenceCatalog.issues.find((entry: any) => entry.ref.objectId === fixture.issueRef.objectId)?.ref as Ref | undefined;
    const currentCorrectionActionRef = latestWorkspace.context.referenceCatalog.actions.find((entry: any) => entry.ref.objectId === fixture.actionRef.objectId)?.ref as Ref | undefined;
    expect(readyAction?.fields).toContain("punchIssueRefs");
    expect(readyAction?.blockedReason?.code).toBe("REFERENCE_STALE");
    expect(currentPunchRef).toMatchObject({ objectId: fixture.issueRef.objectId, version: completedPunch.record.version });
    expect(currentCorrectionActionRef).toBeDefined();
    expect(commissioningReady.record.data.punchIssueRefs[0].version).toBeLessThan(currentPunchRef!.version);
    const originalPunchRef = commissioningReady.record.data.punchIssueRefs[0];
    const originalCorrectionRefs = commissioningReady.record.data.correctionActionRefs;
    await runCompletionCommand(page, /mark ready for handover/i, {
      punchIssueRefs: [currentPunchRef!], correctionActionRefs: [currentCorrectionActionRef!],
    }, [fixture.retestEvidenceId]);
    const commissioningAfterRefresh = latestWorkspace.items.find((item: any) => item.record.id === commissioningId).record;
    expect(commissioningAfterRefresh.data.punchIssueRefs).toEqual([originalPunchRef]);
    expect(commissioningAfterRefresh.data.correctionActionRefs).toEqual(originalCorrectionRefs);
    expect(commissioningAfterRefresh.data.currentPunchIssueRefs).toEqual([currentPunchRef]);
    expect(commissioningAfterRefresh.data.currentCorrectionActionRefs).toEqual([currentCorrectionActionRef]);
    expect(commissioningAfterRefresh.data.punchReferenceRefreshHistory).toHaveLength(1);
    await runCompletionCommand(page, /close commissioning/i);
    const commissioning = latestWorkspace.items.find((item: any) => item.record.id === commissioningId);
    expect(commissioning.record.status).toBe("closed");
    expect(commissioning.record.data.testResultHistory.map((entry: any) => entry.outcome)).toEqual(["fail", "pass"]);

    await useRole(page, "CON");
    await workspace.getByRole("tab", { name: /handover/i }).click();
    await workspace.locator('[data-ui-component="completion-create-action"] button').click();
    create = page.getByRole("dialog");
    await create.getByLabel(/title/i).fill("Browser closed loop partial handover");
    await create.getByLabel(/number/i).fill("HO-CLOSED-01");
    await create.getByLabel(/^system$/i).fill("SYS-BROWSER");
    await create.getByLabel(/scope id/i).fill("SYS-BROWSER-SEGMENT-A");
    await chooseRef(create, /profile/i, fixture.handoverProfileRef);
    await chooseRef(create, /drawing/i, fixture.drawingRef);
    await create.getByLabel(/location/i).selectOption(fixture.scope.locationId);
    await chooseRef(create, /commissioning references/i, { objectType: "WorkItem", objectId: commissioningId, version: commissioning.record.version });
    const handoverAssets = create.getByLabel(/asset references/i);
    const handoverAssetValues: string[] = [];
    for (const ref of fixture.assets) {
      handoverAssetValues.push(await exactReferenceOption(handoverAssets, ref));
    }
    await handoverAssets.selectOption(handoverAssetValues);
    await chooseRef(create, /open issue/i, fixture.reservationIssueRef);
    for (const [label, key] of [
      [/as.built/i, "asBuilt"], [/operations and maintenance manual/i, "omManual"], [/training/i, "training"],
      [/spare parts/i, "spareParts"], [/certificate/i, "certificates"], [/statutory/i, "statutoryAcceptance"],
    ] as Array<[RegExp, string]>) await chooseRef(create, label, fixture.documents[key]);
    const reservation = create.locator('[data-ui-component="handover-reservation-inputs"]');
    await reservation.getByLabel(/reservation owner/i).selectOption(fixture.actors.OWN);
    const due = new Date(fixture.tomorrow); due.setSeconds(0, 0);
    const dueAt = due.toISOString();
    await reservation.getByLabel(/due at/i).fill(await localDateTime(page, dueAt));
    await reservation.getByLabel(/closure requirement/i).fill("Verify and close the reserved punch issue");
    const createHandover = page.waitForResponse((response) => response.request().method() === "POST" && /\/handover-packages$/.test(response.url()));
    await create.getByRole("button", { name: /save draft/i }).click();
    const handoverResponse = await createHandover;
    const handoverBody = await handoverResponse.json();
    expect(handoverResponse.status(), JSON.stringify(handoverBody)).toBe(201);
    const handoverId = handoverBody.record.id as string;
    await expect(workspace.getByRole("button", { name: /Browser closed loop partial handover/ })).toBeVisible();
    await workspace.getByRole("button", { name: /Browser closed loop partial handover/ }).click();
    const createdHandover = latestWorkspace.items.find((item: any) => item.record.id === handoverId);
    const submitAction = createdHandover.actions.find((action: any) => action.command === "submit_handover_package");
    expect(submitAction?.ready, JSON.stringify({ blockedReason: submitAction?.blockedReason, data: createdHandover.record.data })).toBe(true);
    await runCompletionCommand(page, /submit handover package/i);
    await useRole(page, "SUP");
    await workspace.getByRole("tab", { name: /handover/i }).click();
    await workspace.getByRole("button", { name: /Browser closed loop partial handover/ }).click();
    await runCompletionCommand(page, /start readiness review/i);
    await runCompletionCommand(page, /submit.*owner review/i, {}, [fixture.evidenceId]);

    await page.goto("/#/owner");
    await page.locator('[data-ui-component="owner-create-disclosure"] summary').click();
    const authoring = page.locator('[data-ui-component="owner-decision-authoring"]');
    await authoring.getByLabel(/decision request title/i).fill("Conditional acceptance for browser handover");
    const targetSelect = authoring.getByLabel(/target record/i);
    const targetOption = targetSelect.locator("option").filter({ hasText: "Browser closed loop partial handover" }).first();
    await expect(targetOption).toHaveCount(1);
    await targetSelect.selectOption(await targetOption.getAttribute("value") || "");
    const issuedReport = latestWorkspace.items.find((item: any) => item.machine === "report" && item.record.status === "issued");
    expect(issuedReport, "Owner decision must cite a currently issued report").toBeTruthy();
    await authoring.getByLabel(/issued report/i).selectOption(issuedReport.record.id);
    await authoring.getByLabel(/decision due date/i).fill(await localDateTime(page, Date.now() + 86400000));
    await authoring.getByLabel(/option id/i).fill("RESERVE");
    await authoring.getByLabel(/option description/i).fill("Accept the available scope with the punch issue reserved");
    await authoring.getByLabel(/requester recommendation/i).fill("Accept the verified system scope and track the remaining issue");
    await authoring.getByLabel(/scope impact/i).fill("One punch issue remains reserved");
    const saveDecision = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/owner-decisions"));
    await authoring.getByRole("button", { name: /save decision request draft/i }).click();
    const decisionResponse = await saveDecision;
    const decisionBody = await decisionResponse.json();
    expect(decisionResponse.status(), JSON.stringify(decisionBody)).toBe(201);
    const decisionTitle = "Conditional acceptance for browser handover";
    const ownerArea = page.locator("[data-owner-governance='true']");
    const supervisorDecisionRow = ownerArea.getByRole("button", { name: new RegExp(decisionTitle) });
    await expect(supervisorDecisionRow).toBeVisible();
    await supervisorDecisionRow.click();
    const reportedDecision = await runOwnerDecisionCommand(page, /^(Issue decision request|결정 요청 발행)$/i, "report");
    expect(reportedDecision.status).toBe("reported");

    await useRole(page, "OWN");
    await page.goto("/#/owner");
    const ownerDecisionRow = page.locator("[data-owner-governance='true']").getByRole("button", { name: new RegExp(decisionTitle) });
    await expect(ownerDecisionRow).toBeVisible();
    await ownerDecisionRow.click();
    const acknowledgedDecision = await runOwnerDecisionCommand(page, /^Acknowledge receipt$/i, "acknowledge");
    expect(acknowledgedDecision.status).toBe("awaiting_decision");
    await page.locator("[data-owner-governance='true']").getByRole("button", { name: new RegExp(decisionTitle) }).click();
    const decidedBody = await runOwnerDecisionCommand(page, /^(Decide|Submit decision)$/i, "decide", {
      decision: "approved", decisionReason: "Accepted with the stated reservation", selectedOption: "RESERVE", decisionAt: new Date().toISOString(),
    });
    expect(decidedBody.status).toBe("decided");
    expect(decidedBody.decision).toBe("approved");

    await page.goto("/#/completion");
    await expect(workspace).toBeVisible();
    await workspace.getByRole("tab", { name: /handover/i }).click();
    await workspace.getByRole("button", { name: /Browser closed loop partial handover/ }).click();
    await runCompletionCommand(page, /accept with reservations/i, {
      ownerDecisionRef: { objectType: "Decision", objectId: decisionBody.record.id, version: decidedBody.version },
    }, [fixture.evidenceId]);
    const handoverAfterAcceptance = latestWorkspace.items.find((item: any) => item.record.id === handoverId);
    expect(handoverAfterAcceptance.record.data.reservations).toHaveLength(1);
    expect(handoverAfterAcceptance.record.data.reservations[0].closureRequirement).toBe("Verify and close the reserved punch issue");
    if (finalizeHandover) {
      const originalOpenIssueRefs = handoverAfterAcceptance.record.data.openIssueRefs;
      const originalOwnerAcceptanceRef = handoverAfterAcceptance.record.data.ownerAcceptanceRef;
      const originalReservations = handoverAfterAcceptance.record.data.reservations;
      const reservedIssue = latestWorkspace.items.find((item: any) => item.record.id === fixture.reservationIssueRef.objectId);
      expect(reservedIssue.record.status).toBe("open");

      await useRole(page, "SUP");
      await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
      await runWorkbenchCommand(page, "issues", "F-07 browser reservation Punch", /assign|담당자 배정/i, {
        responsiblePartyId: fixture.actors.CON,
        responsibleOrganizationId: fixture.responsibleOrganizationId,
        dueAt: fixture.tomorrow,
        actionIds: reservedIssue.record.actionIds,
      });
      await useRole(page, "CON");
      await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
      await runWorkbenchCommand(page, "issues", "F-07 browser reservation Punch", /start correction|시정 시작/i);
      await page.goto("/#/inspections");
      await expect(page.getByTestId("inspection-case-flow")).toBeVisible();
      const casePanel = page.getByTestId("inspection-case-flow");
      const inspectionPicker = casePanel.getByLabel(/source inspection|root inspection|원 검측 선택/i);
      await inspectionPicker.selectOption(fixture.inspectionRef.objectId);
      await expect(inspectionPicker, "the selected root Inspection must survive the panel's initial workspace effects")
        .toHaveValue(fixture.inspectionRef.objectId);
      const issueCard = casePanel.locator(".inspection-case-issue").filter({ hasText: "F-07 browser reservation Punch" });
      await expect(issueCard).toBeVisible();
      const reinspectionForm = issueCard.getByRole("form", { name: /request linked reinspection|연결된 재검측 요청/i });
      const reinspectionName = "F-07 browser final handover reinspection";
      await reinspectionForm.getByLabel(/work name|작업명/i).fill(reinspectionName);
      await reinspectionForm.getByLabel(/requested inspection time|재검측 요청 일시/i).fill(await localDateTime(page, Date.now() + 3600000));
      await reinspectionForm.getByLabel(/contractor self inspection is complete|시공자 자체검측 완료/i).check();
      for (const label of [/drawing checked|도면 확인/i, /material checked|자재 확인/i, /test checked|시험 확인/i, /previous work checked|선행 작업 확인/i, /changes checked|변경사항 확인/i]) await reinspectionForm.getByLabel(label).check();
      await reinspectionForm.getByLabel(new RegExp(fixture.evidenceId)).check();
      const reinspectionPost = page.waitForResponse((response) => response.request().method() === "POST" && /inspection-cases\/.*\/issues\/.*\/reinspections/.test(response.url()));
      await reinspectionForm.getByRole("button", { name: /submit reinspection request|재검측 요청 제출/i }).click();
      const reinspectionResponse = await reinspectionPost;
      const reinspectionBody = await reinspectionResponse.json();
      expect(reinspectionResponse.status(), JSON.stringify(reinspectionBody)).toBe(201);
      const reinspectionId = reinspectionBody.reinspection.id as string;
      await expect(inspectionPicker).toHaveValue(fixture.inspectionRef.objectId);
      await expect(issueCard.getByText(reinspectionName)).toBeVisible();

      await useRole(page, "SUP");
      await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
      await runWorkbenchCommand(page, "issues", "F-07 browser reservation Punch", /start reinspection|재검측 시작/i);
      await page.getByRole("navigation").getByRole("button", { name: /inspection.*acceptance/i }).click();
      await runWorkbenchCommand(page, "inspections", reinspectionName, /receive|접수/i, { "접수 시각": new Date().toISOString() });
      await runWorkbenchCommand(page, "inspections", reinspectionName, /schedule|일정 배정/i, { "검측 예정시각": new Date(Date.now() + 3600000).toISOString() });
      await runWorkbenchCommand(page, "inspections", reinspectionName, /start|시작/i);
      const passingChecks = JSON.stringify([{ itemId: "dimension", requirementRef: fixture.requirementRef, result: "pass", evidenceIds: [fixture.evidenceId, fixture.retestEvidenceId], measuredValue: 1, unit: "count" }]);
      await runWorkbenchCommand(page, "inspections", reinspectionName, /submit results|결과 제출/i, { "검측 항목·측정 결과": passingChecks }, [fixture.evidenceId, fixture.retestEvidenceId]);
      await runWorkbenchCommand(page, "inspections", reinspectionName, /mark compliant|pass|적합 판정/i, {}, [fixture.evidenceId, fixture.retestEvidenceId]);
      expect(latestWorkspace.items.find((item: any) => item.record.id === reinspectionId)?.record.status).toBe("passed");
      const passedReinspection = latestWorkspace.items.find((item: any) => item.record.id === reinspectionId).record;
      await page.goto("/#/documents");
      await page.getByLabel(/document form/i).selectOption("FM-09");
      await page.getByLabel(/document source/i).selectOption(reinspectionId);
      await page.getByLabel(/document output language/i).selectOption("vi");
      await page.getByLabel(/render type/i).selectOption("final");
      const formValues: Record<string, string> = {
        "inspection.no": reinspectionId, "inspection.work_name": passedReinspection.workName,
        "work.discipline": latestWorkspace.context.scope.discipline, "work.location": latestWorkspace.context.scope.locationId,
        "inspection.datetime": await localDateTime(page, Date.now()), "inspection.place": latestWorkspace.context.scope.locationId,
        "basis.drawings": fixture.drawingRef.objectId, "basis.criteria": fixture.requirementRef.objectId,
        "basis.tests": "dimension", "result.status": "pass", "result.next_work_allowed": "false",
      };
      for (const [name, value] of Object.entries(formValues)) {
        const field = page.locator(`[name="${name}"]`);
        if (await field.evaluate((node) => node.tagName.toLowerCase()) === "select") await field.selectOption(value);
        else await field.fill(value);
      }
      const finalRender = page.waitForResponse((response) => response.url().includes("/forms/FM-09/render") && response.request().method() === "POST");
      await page.getByRole("button", { name: /generate final html snapshot/i }).click();
      const finalRenderBody = await (await finalRender).json();
      expect(finalRenderBody.status).toBe("final");
      expect(finalRenderBody.sourceDomainRefs[0]).toMatchObject({ objectId: reinspectionId, version: passedReinspection.version });
      const finalDocumentId = finalRenderBody.id as string;
      const signFinalInspection = async (role: "owner_side_supervisor" | "contractor_technical_lead") => {
        const signing = page.getByRole("region", { name: /legal signature/i });
        await signing.getByLabel(/current signer role/i).selectOption(role);
        await signing.getByLabel(/signing method/i).selectOption("approved_e_signature");
        const signed = page.waitForResponse((response) => response.url().includes(`/documents/${finalDocumentId}/sign`) && response.request().method() === "POST");
        await signing.getByRole("button", { name: /request signature verification/i }).click();
        expect((await signed).status()).toBe(200);
      };
      await signFinalInspection("owner_side_supervisor");
      await useRole(page, "CON");
      await page.goto("/#/documents");
      await page.getByLabel("Select document", { exact: true }).selectOption(finalDocumentId);
      await signFinalInspection("contractor_technical_lead");
      await useRole(page, "SUP");
      await page.goto("/#/inspections");
      await runWorkbenchCommand(page, "inspections", reinspectionName, /release next work|후속공정 허용/i, {}, [fixture.evidenceId]);
      await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
      await runWorkbenchCommand(page, "issues", "F-07 browser reservation Punch", /review closure|close/i, {
        closureEvidenceIds: [fixture.evidenceId, fixture.retestEvidenceId],
      }, [fixture.evidenceId, fixture.retestEvidenceId]);

      await useRole(page, "SUP");
      await page.getByRole("navigation").getByRole("button", { name: /commissioning.*handover.*warranty/i }).click();
      await workspace.getByRole("tab", { name: /handover/i }).click();
      await workspace.getByRole("button", { name: /Browser closed loop partial handover/ }).click();
      const currentIssueRef = latestWorkspace.context.referenceCatalog.issues.find((entry: any) => entry.ref.objectId === fixture.reservationIssueRef.objectId)?.ref as Ref | undefined;
      expect(currentIssueRef).toBeDefined();
      const refreshed = await runCompletionCommand(page, /refresh current issue references/i, { currentIssueRefs: [currentIssueRef!] });
      expect(refreshed.status).toBe("accepted_with_reservations");
      expect(refreshed.data.openIssueRefs).toEqual(originalOpenIssueRefs);
      expect(refreshed.data.currentIssueRefs).toEqual([currentIssueRef]);
      expect(refreshed.data.currentOpenIssueRefs).toEqual([]);
      expect(refreshed.data.ownerAcceptanceRef).toEqual(originalOwnerAcceptanceRef);
      expect(refreshed.data.reservations).toEqual(originalReservations);
      expect(refreshed.data.issueReferenceRefreshHistory).toHaveLength(1);
      const locale = page.locator(".top-actions .role-picker select").first();
      const handoverLocaleLabels = [
        { locale: "ko", current: "현재 지적사항 참조", open: "현재 미결 지적사항 참조", history: "지적사항 참조 갱신 이력", prior: "이전 참조", updated: "갱신 참조" },
        { locale: "vi", current: "Tham chiếu vấn đề hiện tại", open: "Tham chiếu vấn đề hiện tại chưa đóng", history: "Lịch sử cập nhật tham chiếu vấn đề", prior: "Tham chiếu trước đó", updated: "Tham chiếu đã cập nhật" },
        { locale: "en", current: "Current issue references", open: "Current open issue references", history: "Issue reference refresh history", prior: "Prior references", updated: "Refreshed references" },
      ];
      for (const labels of handoverLocaleLabels) {
        await locale.selectOption(labels.locale);
        await expect(workspace.getByText(labels.current, { exact: true })).toBeVisible();
        await expect(workspace.getByText(labels.open, { exact: true })).toBeVisible();
        await expect(workspace.getByRole("heading", { name: labels.history, exact: true })).toBeVisible();
        await expect(workspace.getByText(labels.prior, { exact: true })).toBeVisible();
        await expect(workspace.getByText(labels.updated, { exact: true })).toBeVisible();
        expect(latestWorkspace.items.find((item: any) => item.record.id === handoverId).record.version).toBe(refreshed.version);
        expect(latestWorkspace.items.find((item: any) => item.record.id === handoverId).record.data.ownerAcceptanceRef).toEqual(originalOwnerAcceptanceRef);
        expect(latestWorkspace.items.find((item: any) => item.record.id === handoverId).record.data.reservations).toEqual(originalReservations);
      }

      await useRole(page, "OWN");
      await workspace.getByRole("tab", { name: /handover/i }).click();
      await workspace.getByRole("button", { name: /Browser closed loop partial handover/ }).click();
      const finalized = await runCompletionCommand(page, /record final handover/i, {
        effectiveAt: fixture.warrantyStartAt, warrantyTrigger: true,
      }, [fixture.evidenceId]);
      expect(finalized.status).toBe("final_handover");
      expect(finalized.data.openIssueRefs).toEqual(originalOpenIssueRefs);
      expect(finalized.data.ownerAcceptanceRef).toEqual(originalOwnerAcceptanceRef);
      expect(finalized.data.reservations).toEqual(originalReservations);
      expect(finalized.data.issueReferenceRefreshHistory).toHaveLength(1);
      await useRole(page, "SUP");
      await workspace.getByRole("tab", { name: /handover/i }).click();
      await workspace.getByRole("button", { name: /Browser closed loop partial handover/ }).click();
      const closed = await runCompletionCommand(page, /close handover package/i);
      expect(closed.status).toBe("closed");
      expect(closed.data.openIssueRefs).toEqual(originalOpenIssueRefs);
      expect(closed.data.reservations).toEqual(originalReservations);
      return;
    }
    const acceptedScope = {
      scopeId: "SYS-BROWSER-SEGMENT-A", system: "SYS-BROWSER", locationIds: [fixture.scope.locationId], assetRefs: [fixture.assets[0]],
    };
    await runCompletionCommand(page, /record partial handover/i, {
      acceptedScope, effectiveAt: fixture.warrantyStartAt, warrantyTrigger: true,
    }, [fixture.evidenceId]);
    const partial = latestWorkspace.items.find((item: any) => item.record.id === handoverId);
    expect(partial.record.status).toBe("partial_handover");
    expect(partial.record.data.acceptedScope).toEqual(acceptedScope);
    expect(partial.record.data.warrantyStartAt).toBe(fixture.warrantyStartAt);
    const handoverVersionBeforeWarranty = partial.record.version;
    const handoverOwnerAcceptanceBeforeWarranty = partial.record.data.ownerAcceptanceRef;
    const handoverReservationsBeforeWarranty = partial.record.data.reservations;
    const handoverOpenIssuesBeforeWarranty = partial.record.data.openIssueRefs;
    let warrantyIssueRef = fixture.reservationIssueRef;
    let warrantyIssueTitle = "F-07 browser reservation Punch";
    if (continueWarranty) {
      const warrantyIssueSeedResponse = await fetch(`${base}/_test/warranty-issue`, { method: "POST" });
      expect(warrantyIssueSeedResponse.status).toBe(201);
      warrantyIssueRef = (await warrantyIssueSeedResponse.json()).ref as Ref;
      warrantyIssueTitle = "F-07 browser warranty defect Issue";
      await page.reload();
      await expect(workspace).toBeVisible();
    }

    await useRole(page, "OWN");
    await workspace.getByRole("tab", { name: /warranty/i }).click();
    await workspace.locator('[data-ui-component="completion-create-action"] button').click();
    create = page.getByRole("dialog");
    await create.getByLabel(/title/i).fill("Browser warranty defect claim");
    await create.getByLabel(/number/i).fill("WC-CLOSED-01");
    await create.getByLabel(/^system$/i).fill("SYS-BROWSER");
    await chooseRef(create, /warranty period/i, fixture.warrantyPeriodRef);
    await chooseRef(create, /handover/i, { objectType: "WorkItem", objectId: handoverId, version: partial.record.version });
    await chooseRef(create, /issue/i, warrantyIssueRef);
    await create.getByLabel(/observed at/i).fill(await localDateTime(page, fixture.warrantyStartAt));
    await create.getByLabel(/defect description/i).fill("Seal leakage observed at the accepted flange");
    await create.getByLabel(/cause description/i).fill("Seal failed during operation");
    await create.getByLabel(/operational impact/i).fill("System isolated pending repair");
    await create.getByLabel(/scope id/i).fill("SYS-BROWSER-SEGMENT-A");
    await create.getByLabel(/^system/i).last().fill("SYS-BROWSER");
    await create.getByLabel(/location/i).selectOption(fixture.scope.locationId);
    const evidenceSelect = create.getByLabel(/evidence/i);
    await evidenceSelect.selectOption(await exactReferenceOption(evidenceSelect, evidenceRef(fixture.evidenceId)));
    const createClaim = page.waitForResponse((response) => response.request().method() === "POST" && /\/warranty-claims$/.test(response.url()));
    await create.getByRole("button", { name: /save draft/i }).click();
    const claimResponse = await createClaim;
    const claimBody = await claimResponse.json();
    expect(claimResponse.status(), JSON.stringify(claimBody)).toBe(201);
    expect(new Date(claimBody.record.data.defectObservedAt).toISOString())
      .toBe(new Date(fixture.warrantyStartAt).toISOString());
    expect(claimBody.record.data.issueRef).toEqual(warrantyIssueRef);
    const claimId = claimBody.record.id as string;
    await expect(workspace.getByRole("button", { name: /Browser warranty defect claim/ })).toBeVisible();
    await workspace.getByRole("button", { name: /Browser warranty defect claim/ }).click();
    await runCompletionCommand(page, /report warranty defect/i, {}, [fixture.evidenceId]);
    await useRole(page, "CON");
    await workspace.getByRole("tab", { name: /warranty/i }).click();
    await workspace.getByRole("button", { name: /Browser warranty defect claim/ }).click();
    await runCompletionCommand(page, /acknowledge claim/i);
    await useRole(page, "SUP");
    await workspace.getByRole("tab", { name: /warranty/i }).click();
    await workspace.getByRole("button", { name: /Browser warranty defect claim/ }).click();
    await runCompletionCommand(page, /assess warranty/i);
    if (!continueWarranty) {
      await runCompletionCommand(page, /require remedy/i, {
        actionRefs: [fixture.reservationActionRef], responseDueAt: fixture.tomorrow,
      });
    }
    await useRole(page, "CON");
    await workspace.getByRole("tab", { name: /warranty/i }).click();
    await workspace.getByRole("button", { name: /Browser warranty defect claim/ }).click();
    const statusBeforeMissingAction = latestWorkspace.items.find((item: any) => item.record.id === claimId).record.status;
    const linkedVerifiedAction = latestWorkspace.items.find((item: any) => item.record.id === fixture.reservationActionRef.objectId);
    expect(linkedVerifiedAction?.record.status).toBe("verified");
    if (!continueWarranty) {
      const startRemedy = latestWorkspace.items.find((item: any) => item.record.id === claimId).actions
        .find((action: any) => action.command === "start_remedy");
      expect(startRemedy?.ready).toBe(false);
      expect(startRemedy?.blockedReason?.code).toBe("WARRANTY_ACTION_REQUIRED");
      await expect(workspace.locator(".completion-commands").getByRole("button", { name: /start remedy/i })).toBeDisabled();
      const claimAfterGuard = latestWorkspace.items.find((item: any) => item.record.id === claimId);
      expect(claimAfterGuard.record.status).toBe(statusBeforeMissingAction);
      return;
    }

    // Create an in-scope Action through its UI, assign it through the SUP
    // command, and use its exact assigned version for the warranty command.
    await page.getByRole("navigation").getByRole("button", { name: /corrective actions/i }).click();
    const actionWorkbench = page.locator("[data-workbench-route='actions']");
    await expect(actionWorkbench).toBeVisible();
    await actionWorkbench.locator('[data-ui-component="new-action-entry"] button').click();
    const actionAuthoring = page.locator("[data-ui-component='action-authoring-panel']");
    await expect(actionAuthoring).toBeVisible();
    const remedyActionTitle = "F-07 browser warranty corrective action";
    await actionAuthoring.getByLabel(/action title/i).fill(remedyActionTitle);
    const relatedIssue = actionAuthoring.getByLabel(/related issue/i);
    const issueOption = relatedIssue.locator("option").filter({ hasText: warrantyIssueRef.objectId });
    await expect(issueOption, "select the exact current warranty Issue reference").toHaveCount(1);
    await relatedIssue.selectOption(warrantyIssueRef.objectId);
    await actionAuthoring.getByLabel(/assignee/i).selectOption(fixture.actors.CON);
    await actionAuthoring.getByLabel(/due date/i).fill(await localDateTime(page, fixture.tomorrow));
    const actionCreatedPromise = page.waitForResponse((response) => response.request().method() === "POST" && /\/actions$/.test(new URL(response.url()).pathname));
    await actionAuthoring.getByRole("button", { name: /save action draft/i }).click();
    const actionCreatedResponse = await actionCreatedPromise;
    const actionCreatedBody = await actionCreatedResponse.json();
    expect(actionCreatedResponse.status(), JSON.stringify(actionCreatedBody)).toBe(201);
    const remedyActionId = actionCreatedBody.record.id as string;
    await expect(actionWorkbench.getByRole("button", { name: new RegExp(remedyActionTitle) })).toBeVisible();

    await useRole(page, "SUP");
    await page.getByRole("navigation").getByRole("button", { name: /corrective actions/i }).click();
    await runWorkbenchCommand(page, "actions", remedyActionTitle, /assign/i, {
      responsiblePartyId: fixture.actors.CON, dueAt: fixture.tomorrow,
    });
    const assignedAction = latestWorkspace.items.find((item: any) => item.record.id === remedyActionId);
    expect(assignedAction.record.status).toBe("assigned");
    const assignedActionRef = { objectType: "Action", objectId: remedyActionId, version: assignedAction.record.version };

    await useRole(page, "SUP");
    await workspace.getByRole("tab", { name: /warranty/i }).click();
    await workspace.getByRole("button", { name: /Browser warranty defect claim/ }).click();
    await runCompletionCommand(page, /require remedy/i, {
      actionRefs: [assignedActionRef], responseDueAt: fixture.tomorrow,
    });
    await useRole(page, "CON");
    await workspace.getByRole("tab", { name: /warranty/i }).click();
    await workspace.getByRole("button", { name: /Browser warranty defect claim/ }).click();
    await runCompletionCommand(page, /start remedy/i);

    // Start/submit the actual Action after Warranty has captured its assigned
    // version. Explicit reconciliation later supplies only the current Action
    // references after the exact linked Issue completes its correction cycle.
    await page.getByRole("navigation").getByRole("button", { name: /corrective actions/i }).click();
    await runWorkbenchCommand(page, "actions", remedyActionTitle, /start/i);
    await runWorkbenchCommand(page, "actions", remedyActionTitle, /submit/i, {
      correction: "Seal replaced and pressure-tested",
      rootCause: "Seal failure at the accepted flange",
      preventiveAction: "Add a second-person seal inspection before commissioning",
    }, [fixture.evidenceId]);
    await useRole(page, "SUP");
    await page.getByRole("navigation").getByRole("button", { name: /corrective actions/i }).click();
    await runWorkbenchCommand(page, "actions", remedyActionTitle, /verify/i, {}, [fixture.evidenceId]);
    await useRole(page, "CON");
    await workspace.getByRole("tab", { name: /warranty/i }).click();
    await workspace.getByRole("button", { name: /Browser warranty defect claim/ }).click();
    await runCompletionCommand(page, /submit remedy/i, { remedySummary: "Replaced seal and pressure-tested" }, [fixture.evidenceId]);
    expect(latestWorkspace.items.find((item: any) => item.record.id === claimId).record.status).toBe("reinspection");

    // Run the linked Issue reinspection through its existing case UI. The
    // Issue transition changes its current version; the Warranty snapshot
    // intentionally retains its prior Issue ref so any next boundary remains
    // visible to the server instead of being silently rewritten in the test.
    await useRole(page, "SUP");
    await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
    await runWorkbenchCommand(page, "issues", warrantyIssueTitle, /assign|담당자 배정/i, {
      responsiblePartyId: fixture.actors.CON,
      responsibleOrganizationId: fixture.responsibleOrganizationId,
      dueAt: fixture.tomorrow,
      actionIds: [remedyActionId],
    });
    await useRole(page, "CON");
    await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
    await runWorkbenchCommand(page, "issues", warrantyIssueTitle, /start correction|시정 시작/i);
    await page.goto("/#/inspections");
    await expect(page.getByTestId("inspection-case-flow")).toBeVisible();
    const warrantyCasePanel = page.getByTestId("inspection-case-flow");
    await warrantyCasePanel.getByLabel(/source inspection|root inspection|원 검측 선택/i).selectOption(fixture.inspectionRef.objectId);
    const warrantyIssueCard = warrantyCasePanel.locator(".inspection-case-issue").filter({ hasText: warrantyIssueTitle });
    await expect(warrantyIssueCard).toBeVisible();
    const warrantyReinspectionForm = warrantyIssueCard.getByRole("form", { name: /request linked reinspection|연결된 재검측 요청/i });
    const warrantyReinspectionName = "F-07 browser warranty reinspection";
    await warrantyReinspectionForm.getByLabel(/work name|작업명/i).fill(warrantyReinspectionName);
    await warrantyReinspectionForm.getByLabel(/requested inspection time|재검측 요청 일시/i).fill(await localDateTime(page, Date.now() + 3600000));
    await warrantyReinspectionForm.getByLabel(/contractor self inspection is complete|시공자 자체검측 완료/i).check();
    for (const label of [/drawing checked|도면 확인/i, /material checked|자재 확인/i, /test checked|시험 확인/i, /previous work checked|선행 작업 확인/i, /changes checked|변경사항 확인/i]) {
      await warrantyReinspectionForm.getByLabel(label).check();
    }
    await warrantyReinspectionForm.getByLabel(new RegExp(fixture.evidenceId)).check();
    const warrantyReinspectionPost = page.waitForResponse((response) => response.request().method() === "POST" && /inspection-cases\/.*\/issues\/.*\/reinspections/.test(response.url()));
    await warrantyReinspectionForm.getByRole("button", { name: /submit reinspection request|재검측 요청 제출/i }).click();
    const warrantyReinspectionResponse = await warrantyReinspectionPost;
    const warrantyReinspectionBody = await warrantyReinspectionResponse.json();
    expect(warrantyReinspectionResponse.status(), JSON.stringify(warrantyReinspectionBody)).toBe(201);
    const failedWarrantyReinspectionId = warrantyReinspectionBody.reinspection.id as string;

    await useRole(page, "SUP");
    await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
    await runWorkbenchCommand(page, "issues", warrantyIssueTitle, /start reinspection|재검측 시작/i);
    await page.getByRole("navigation").getByRole("button", { name: /inspection.*acceptance/i }).click();
    await runWorkbenchCommand(page, "inspections", warrantyReinspectionName, /receive|접수/i, { "접수 시각": new Date().toISOString() });
    await runWorkbenchCommand(page, "inspections", warrantyReinspectionName, /schedule|일정 배정/i, { "검측 예정시각": new Date(Date.now() + 3600000).toISOString() });
    await runWorkbenchCommand(page, "inspections", warrantyReinspectionName, /start|시작/i);
    const warrantyFailingChecks = JSON.stringify([{ itemId: "dimension", requirementRef: fixture.requirementRef, result: "fail", evidenceIds: [fixture.evidenceId, fixture.retestEvidenceId], measuredValue: 1, unit: "count", note: "Leakage remains at the flange" }]);
    await runWorkbenchCommand(page, "inspections", warrantyReinspectionName, /submit results|결과 제출/i, { "검측 항목·측정 결과": warrantyFailingChecks }, [fixture.evidenceId, fixture.retestEvidenceId]);
    await runWorkbenchCommand(page, "inspections", warrantyReinspectionName, /fail|noncompliant|부적합/i, { failureReason: "Leakage remains at the flange" }, [fixture.evidenceId, fixture.retestEvidenceId]);
    expect(latestWorkspace.items.find((item: any) => item.record.id === failedWarrantyReinspectionId)?.record.status).toBe("failed");

    const failedWarrantyReinspectionRef = latestWorkspace.context.referenceCatalog.inspections
      .find((entry: any) => entry.ref.objectId === failedWarrantyReinspectionId)?.ref as Ref | undefined;
    expect(failedWarrantyReinspectionRef).toBeDefined();
    await useRole(page, "SUP");
    await workspace.getByRole("tab", { name: /warranty/i }).click();
    await workspace.getByRole("button", { name: /Browser warranty defect claim/ }).click();
    const reworkRequired = await runCompletionCommand(page, /require rework/i, {
      reinspectionRef: failedWarrantyReinspectionRef!, reworkReason: "Leakage remains after the first remedy cycle",
    }, [fixture.evidenceId]);
    expect(reworkRequired.status).toBe("rework_required");

    await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
    await runWorkbenchCommand(page, "issues", warrantyIssueTitle, /request recorrection|재시정 요청|yêu cầu khắc phục lại/i, {}, [fixture.evidenceId]);
    await useRole(page, "CON");
    await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
    await runWorkbenchCommand(page, "issues", warrantyIssueTitle, /restart corrective work|재시정 시작|bắt đầu lại công việc khắc phục/i);
    const issueAtReplacementCycle = latestWorkspace.items.find((item: any) => item.record.id === warrantyIssueRef.objectId);
    expect(issueAtReplacementCycle.record.correctionCycle).toBe(1);

    const replacementActionTitle = "F-07 browser warranty replacement corrective action";
    await page.getByRole("navigation").getByRole("button", { name: /corrective actions/i }).click();
    await page.locator('[data-ui-component="new-action-entry"] button').click();
    const replacementAuthoring = page.locator("[data-ui-component='action-authoring-panel']");
    await expect(replacementAuthoring).toBeVisible();
    await replacementAuthoring.getByLabel(/action title/i).fill(replacementActionTitle);
    const replacementRelatedIssue = replacementAuthoring.getByLabel(/related issue/i);
    await replacementRelatedIssue.selectOption(warrantyIssueRef.objectId);
    await replacementAuthoring.getByLabel(/assignee/i).selectOption(fixture.actors.CON);
    await replacementAuthoring.getByLabel(/due date/i).fill(await localDateTime(page, fixture.tomorrow));
    const replacementActionPost = page.waitForResponse((response) => response.request().method() === "POST" && /\/actions$/.test(new URL(response.url()).pathname));
    await replacementAuthoring.getByRole("button", { name: /save action draft/i }).click();
    const replacementActionResponse = await replacementActionPost;
    const replacementActionBody = await replacementActionResponse.json();
    expect(replacementActionResponse.status(), JSON.stringify(replacementActionBody)).toBe(201);
    const replacementActionId = replacementActionBody.record.id as string;

    await useRole(page, "SUP");
    await page.getByRole("navigation").getByRole("button", { name: /corrective actions/i }).click();
    await runWorkbenchCommand(page, "actions", replacementActionTitle, /assign/i, {
      responsiblePartyId: fixture.actors.CON, dueAt: fixture.tomorrow,
    });
    await useRole(page, "CON");
    await page.getByRole("navigation").getByRole("button", { name: /corrective actions/i }).click();
    await runWorkbenchCommand(page, "actions", replacementActionTitle, /start/i);
    await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
    const issueBeforeLink = latestWorkspace.items.find((item: any) => item.record.id === warrantyIssueRef.objectId);
    await runWorkbenchCommand(page, "issues", warrantyIssueTitle, /link corrective actions|link actions|조치 연결/i, {
      actionIds: [...issueBeforeLink.record.actionIds, replacementActionId],
    });
    const linkedIssue = latestWorkspace.items.find((item: any) => item.record.id === warrantyIssueRef.objectId);
    expect(linkedIssue.record.correctionCycle).toBe(1);
    expect(linkedIssue.record.actionIds).toContain(replacementActionId);

    await useRole(page, "SUP");
    await page.getByRole("navigation").getByRole("button", { name: /commissioning.*handover.*warranty/i }).click();
    await workspace.getByRole("tab", { name: /warranty/i }).click();
    await workspace.getByRole("button", { name: /Browser warranty defect claim/ }).click();
    const currentRemedyIssueRef = latestWorkspace.context.referenceCatalog.issues
      .find((entry: any) => entry.ref.objectId === warrantyIssueRef.objectId)?.ref as Ref | undefined;
    const replacementActionRef = latestWorkspace.context.referenceCatalog.actions
      .find((entry: any) => entry.ref.objectId === replacementActionId)?.ref as Ref | undefined;
    expect(currentRemedyIssueRef).toMatchObject({ objectId: warrantyIssueRef.objectId, version: linkedIssue.record.version });
    expect(replacementActionRef).toBeDefined();
    const originalRemedyIssueRef = latestWorkspace.items.find((item: any) => item.record.id === claimId).record.data.issueRef;
    const originalRemedyActionRefs = latestWorkspace.items.find((item: any) => item.record.id === claimId).record.data.actionRefs;
    const refreshedRemedy = await runCompletionCommand(page, /refresh current remedy references/i, {
      issueRef: currentRemedyIssueRef!, actionRefs: [replacementActionRef!],
    });
    expect(refreshedRemedy.status).toBe("rework_required");
    expect(refreshedRemedy.data.issueRef).toEqual(originalRemedyIssueRef);
    expect(refreshedRemedy.data.actionRefs).toEqual(originalRemedyActionRefs);
    expect(refreshedRemedy.data.currentIssueRef).toEqual(currentRemedyIssueRef);
    expect(refreshedRemedy.data.currentActionRefs).toEqual([replacementActionRef]);
    expect(refreshedRemedy.data.remedyReferenceRefreshHistory).toHaveLength(1);
    const locale = page.locator(".top-actions .role-picker select").first();
    const remedyLocaleLabels = [
      { locale: "ko", issue: "현재 연결 지적사항 참조", actions: "현재 시정조치 참조", history: "보수 참조 갱신 이력", prior: "이전 참조", updated: "갱신 참조" },
      { locale: "vi", issue: "Tham chiếu vấn đề liên kết hiện tại", actions: "Tham chiếu hành động khắc phục hiện tại", history: "Lịch sử cập nhật tham chiếu khắc phục", prior: "Tham chiếu trước đó", updated: "Tham chiếu đã cập nhật" },
      { locale: "en", issue: "Current linked issue reference", actions: "Current corrective action references", history: "Remedy reference refresh history", prior: "Prior references", updated: "Refreshed references" },
    ];
    for (const labels of remedyLocaleLabels) {
      await locale.selectOption(labels.locale);
      await expect(workspace.getByText(labels.issue, { exact: true })).toBeVisible();
      await expect(workspace.getByText(labels.actions, { exact: true })).toBeVisible();
      await expect(workspace.getByRole("heading", { name: labels.history, exact: true })).toBeVisible();
      const priorLabels = workspace.getByText(labels.prior, { exact: true });
      const updatedLabels = workspace.getByText(labels.updated, { exact: true });
      await expect(priorLabels).toHaveCount(2);
      await expect(updatedLabels).toHaveCount(2);
      await expect(priorLabels.first()).toBeVisible();
      await expect(priorLabels.nth(1)).toBeVisible();
      await expect(updatedLabels.first()).toBeVisible();
      await expect(updatedLabels.nth(1)).toBeVisible();
      expect(latestWorkspace.items.find((item: any) => item.record.id === claimId).record.version).toBe(refreshedRemedy.version);
      expect(latestWorkspace.items.find((item: any) => item.record.id === claimId).record.data.issueRef).toEqual(originalRemedyIssueRef);
      expect(latestWorkspace.items.find((item: any) => item.record.id === claimId).record.data.actionRefs).toEqual(originalRemedyActionRefs);
    }

    await useRole(page, "CON");
    await workspace.getByRole("tab", { name: /warranty/i }).click();
    await workspace.getByRole("button", { name: /Browser warranty defect claim/ }).click();
    await runCompletionCommand(page, /start remedy/i);
    await page.getByRole("navigation").getByRole("button", { name: /corrective actions/i }).click();
    await runWorkbenchCommand(page, "actions", replacementActionTitle, /submit/i, {
      correction: "Replaced the seal in correction cycle 1",
      rootCause: "Initial seal seating remained incomplete",
      preventiveAction: "Require a second-person seal seating check",
    }, [fixture.evidenceId]);
    await useRole(page, "SUP");
    await page.getByRole("navigation").getByRole("button", { name: /corrective actions/i }).click();
    await runWorkbenchCommand(page, "actions", replacementActionTitle, /verify/i, {}, [fixture.evidenceId]);
    await useRole(page, "CON");
    await workspace.getByRole("tab", { name: /warranty/i }).click();
    await workspace.getByRole("button", { name: /Browser warranty defect claim/ }).click();
    await runCompletionCommand(page, /submit remedy/i, { remedySummary: "Replaced the seal in correction cycle 1" }, [fixture.evidenceId]);

    await page.goto("/#/inspections");
    await expect(page.getByTestId("inspection-case-flow")).toBeVisible();
    const replacementCasePanel = page.getByTestId("inspection-case-flow");
    await replacementCasePanel.getByLabel(/source inspection|root inspection|원 검측 선택/i).selectOption(fixture.inspectionRef.objectId);
    const replacementIssueCard = replacementCasePanel.locator(".inspection-case-issue").filter({ hasText: warrantyIssueTitle });
    const replacementReinspectionForm = replacementIssueCard.getByRole("form", { name: /request linked reinspection|연결된 재검측 요청/i });
    const warrantyReplacementReinspectionName = "F-07 browser warranty replacement reinspection";
    await replacementReinspectionForm.getByLabel(/work name|작업명/i).fill(warrantyReplacementReinspectionName);
    await replacementReinspectionForm.getByLabel(/requested inspection time|재검측 요청 일시/i).fill(await localDateTime(page, Date.now() + 3600000));
    await replacementReinspectionForm.getByLabel(/contractor self inspection is complete|시공자 자체검측 완료/i).check();
    for (const label of [/drawing checked|도면 확인/i, /material checked|자재 확인/i, /test checked|시험 확인/i, /previous work checked|선행 작업 확인/i, /changes checked|변경사항 확인/i]) await replacementReinspectionForm.getByLabel(label).check();
    await replacementReinspectionForm.getByLabel(new RegExp(fixture.evidenceId)).check();
    const replacementReinspectionPost = page.waitForResponse((response) => response.request().method() === "POST" && /inspection-cases\/.*\/issues\/.*\/reinspections/.test(response.url()));
    await replacementReinspectionForm.getByRole("button", { name: /submit reinspection request|재검측 요청 제출/i }).click();
    const replacementReinspectionResponse = await replacementReinspectionPost;
    const replacementReinspectionBody = await replacementReinspectionResponse.json();
    expect(replacementReinspectionResponse.status(), JSON.stringify(replacementReinspectionBody)).toBe(201);
    const warrantyReinspectionId = replacementReinspectionBody.reinspection.id as string;

    await useRole(page, "SUP");
    await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
    await runWorkbenchCommand(page, "issues", warrantyIssueTitle, /start reinspection|재검측 시작/i);
    await page.getByRole("navigation").getByRole("button", { name: /inspection.*acceptance/i }).click();
    await runWorkbenchCommand(page, "inspections", warrantyReplacementReinspectionName, /receive|접수/i, { "접수 시각": new Date().toISOString() });
    await runWorkbenchCommand(page, "inspections", warrantyReplacementReinspectionName, /schedule|일정 배정/i, { "검측 예정시각": new Date(Date.now() + 3600000).toISOString() });
    await runWorkbenchCommand(page, "inspections", warrantyReplacementReinspectionName, /start|시작/i);
    const warrantyPassingChecks = JSON.stringify([{ itemId: "dimension", requirementRef: fixture.requirementRef, result: "pass", evidenceIds: [fixture.evidenceId, fixture.retestEvidenceId], measuredValue: 1, unit: "count" }]);
    await runWorkbenchCommand(page, "inspections", warrantyReplacementReinspectionName, /submit results|결과 제출/i, { "검측 항목·측정 결과": warrantyPassingChecks }, [fixture.evidenceId, fixture.retestEvidenceId]);
    await runWorkbenchCommand(page, "inspections", warrantyReplacementReinspectionName, /mark compliant|pass|적합 판정/i, {}, [fixture.evidenceId, fixture.retestEvidenceId]);
    expect(latestWorkspace.items.find((item: any) => item.record.id === warrantyReinspectionId)?.record.status).toBe("passed");

    const passedWarrantyReinspection = latestWorkspace.items.find((item: any) => item.record.id === warrantyReinspectionId).record;
    await page.goto("/#/documents");
    await page.getByLabel(/document form/i).selectOption("FM-09");
    await page.getByLabel(/document source/i).selectOption(warrantyReinspectionId);
    await page.getByLabel(/document output language/i).selectOption("vi");
    await page.getByLabel(/render type/i).selectOption("final");
    const warrantyFormValues: Record<string, string> = {
      "inspection.no": warrantyReinspectionId,
      "inspection.work_name": passedWarrantyReinspection.workName,
      "work.discipline": latestWorkspace.context.scope.discipline,
      "work.location": latestWorkspace.context.scope.locationId,
      "inspection.datetime": await localDateTime(page, Date.now()),
      "inspection.place": latestWorkspace.context.scope.locationId,
      "basis.drawings": fixture.drawingRef.objectId,
      "basis.criteria": fixture.requirementRef.objectId,
      "basis.tests": "dimension",
      "result.status": "pass",
      "result.next_work_allowed": "false",
    };
    for (const [name, value] of Object.entries(warrantyFormValues)) {
      const field = page.locator(`[name="${name}"]`);
      if (await field.evaluate((node) => node.tagName.toLowerCase()) === "select") await field.selectOption(value);
      else await field.fill(value);
    }
    const warrantyFinalRender = page.waitForResponse(response => response.url().includes("/forms/FM-09/render") && response.request().method() === "POST");
    await page.getByRole("button", { name: /generate final html snapshot/i }).click();
    const warrantyFinalBody = await (await warrantyFinalRender).json();
    expect(warrantyFinalBody.status).toBe("final");
    expect(warrantyFinalBody.sourceDomainRefs[0]).toMatchObject({ objectId: warrantyReinspectionId, version: passedWarrantyReinspection.version });
    const warrantyFinalDocumentId = warrantyFinalBody.id as string;
    const signWarrantyDocument = async (role: "owner_side_supervisor" | "contractor_technical_lead") => {
      const signing = page.getByRole("region", { name: /legal signature/i });
      await signing.getByLabel(/current signer role/i).selectOption(role);
      await signing.getByLabel(/signing method/i).selectOption("approved_e_signature");
      const signed = page.waitForResponse(response => response.url().includes(`/documents/${warrantyFinalDocumentId}/sign`) && response.request().method() === "POST");
      await signing.getByRole("button", { name: /request signature verification/i }).click();
      expect((await signed).status()).toBe(200);
    };
    await signWarrantyDocument("owner_side_supervisor");
    await useRole(page, "CON");
    await page.goto("/#/documents");
    await page.getByLabel("Select document", { exact: true }).selectOption(warrantyFinalDocumentId);
    await signWarrantyDocument("contractor_technical_lead");
    const warrantyVerifierReport = await (await fetch(`${base}/_test/signature-verifications`)).json();
    expect(warrantyVerifierReport).toMatchObject({ testOnly: true, verifier: "MockTrustedVerifier" });

    await useRole(page, "SUP");
    await page.getByRole("navigation").getByRole("button", { name: /inspection.*acceptance/i }).click();
    await runWorkbenchCommand(page, "inspections", warrantyReplacementReinspectionName, /release next work|후속공정 허용/i, {}, [fixture.evidenceId]);
    expect(latestWorkspace.items.find((item: any) => item.record.id === warrantyReinspectionId)?.record.nextWorkAllowed).toBe(true);
    await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
    await runWorkbenchCommand(page, "issues", warrantyIssueTitle, /review closure|close/i, {
      closureEvidenceIds: [fixture.evidenceId, fixture.retestEvidenceId],
    }, [fixture.evidenceId, fixture.retestEvidenceId]);

    await useRole(page, "SUP");
    await page.getByRole("navigation").getByRole("button", { name: /commissioning.*handover.*warranty/i }).click();
    await workspace.getByRole("tab", { name: /warranty/i }).click();
    await workspace.getByRole("button", { name: /Browser warranty defect claim/ }).click();
    const claimAfterReinspection = latestWorkspace.items.find((item: any) => item.record.id === claimId);
    const warrantyIssue = latestWorkspace.items.find((item: any) => item.record.id === warrantyIssueRef.objectId);
    expect(claimAfterReinspection.record.data.issueRef.version).toBeLessThan(warrantyIssue.record.version);
    const acceptRemedy = claimAfterReinspection.actions.find((action: any) => action.command === "accept_remedy");
    expect(acceptRemedy?.fields).toContain("reinspectionRef");
    expect(acceptRemedy?.fields).toContain("issueRef");
    expect(acceptRemedy?.fields).toContain("actionRefs");
    const currentReinspectionRef = latestWorkspace.context.referenceCatalog.inspections
      .find((entry: any) => entry.ref.objectId === warrantyReinspectionId)?.ref as Ref | undefined;
    const currentIssueRef = latestWorkspace.context.referenceCatalog.issues
      .find((entry: any) => entry.ref.objectId === warrantyIssueRef.objectId)?.ref as Ref | undefined;
    const currentActionRefs = warrantyIssue.record.actionIds
      .filter((id: string) => latestWorkspace.items.find((item: any) => item.record.id === id)?.record.correctionCycle === warrantyIssue.record.correctionCycle)
      .map((id: string) => latestWorkspace.context.referenceCatalog.actions.find((entry: any) => entry.ref.objectId === id)?.ref)
      .filter(Boolean) as Ref[];
    const acceptedReplacementAction = latestWorkspace.items.find((item: any) => item.record.id === replacementActionId).record;
    expect(currentReinspectionRef).toBeDefined();
    expect(currentIssueRef).toMatchObject({ objectId: warrantyIssueRef.objectId, version: warrantyIssue.record.version });
    expect(currentActionRefs).toHaveLength(1);
    expect(currentActionRefs[0]).toMatchObject({ objectType: "Action", objectId: replacementActionId, version: acceptedReplacementAction.version });
    expect(acceptedReplacementAction.correctionCycle).toBe(1);
    const originalWarrantyIssueRef = claimAfterReinspection.record.data.issueRef;
    const originalWarrantyActionRefs = claimAfterReinspection.record.data.actionRefs;
    const acceptedRemedy = await runCompletionCommand(page, /accept remedy/i, {
      reinspectionRef: currentReinspectionRef!, issueRef: currentIssueRef!, actionRefs: currentActionRefs,
    }, [fixture.evidenceId]);
    expect(acceptedRemedy.status).toBe("accepted");
    expect(acceptedRemedy.version).toBeGreaterThan(claimAfterReinspection.record.version);
    expect(acceptedRemedy.data.issueRef).toEqual(originalWarrantyIssueRef);
    expect(originalWarrantyIssueRef).toMatchObject({ objectType: "Issue", objectId: warrantyIssueRef.objectId });
    expect(acceptedRemedy.data.actionRefs).toEqual(originalWarrantyActionRefs);
    expect(acceptedRemedy.data.currentIssueRef).toEqual(currentIssueRef);
    expect(acceptedRemedy.data.currentActionRefs).toHaveLength(currentActionRefs.length);
    expect(acceptedRemedy.data.currentActionRefs).toEqual(expect.arrayContaining(currentActionRefs));
    expect(acceptedRemedy.data.remedyReferenceRefreshHistory).toHaveLength(2);
    expect(acceptedRemedy.data.remedyReferenceRefreshHistory[0]).toMatchObject({
      currentIssueRef: currentRemedyIssueRef,
      currentActionRefs: [replacementActionRef],
    });
    expect(acceptedRemedy.data.remedyReferenceRefreshHistory[1]).toMatchObject({
      priorIssueRef: currentRemedyIssueRef,
      priorActionRefs: [replacementActionRef],
      currentIssueRef,
      currentActionRefs,
    });
    const closedClaim = await runCompletionCommand(page, /close warranty claim/i, {
      closureRef: currentIssueRef!,
    }, [fixture.evidenceId]);
    expect(closedClaim.status).toBe("closed");
    const handoverAfterWarranty = latestWorkspace.items.find((item: any) => item.record.id === handoverId).record;
    expect(handoverAfterWarranty.version).toBe(handoverVersionBeforeWarranty);
    expect(handoverAfterWarranty.data.ownerAcceptanceRef).toEqual(handoverOwnerAcceptanceBeforeWarranty);
    expect(handoverAfterWarranty.data.reservations).toEqual(handoverReservationsBeforeWarranty);
    expect(handoverAfterWarranty.data.openIssueRefs).toEqual(handoverOpenIssuesBeforeWarranty);
  } finally {
    await stopApi(child);
  }
}

test("real Completion UI refreshes stale commissioning references and completes partial handover", async ({ page }) => {
  await runCompletionHandoverScenario(page, false);
});

test("real warranty UI accepts a remedy with current references after reinspection and closes the claim", async ({ page }) => {
  test.setTimeout(240_000);
  await runCompletionHandoverScenario(page, true);
});

test("real Owner and SUP UI complete final handover after a reserved Issue closes", async ({ page }) => {
  test.setTimeout(240_000);
  await runCompletionHandoverScenario(page, true, true);
});
