import { expect, test, type Locator, type Page } from "@playwright/test";
import { localDateTime } from "./support/local-datetime";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
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

async function useRole(page: Page, role: "CON" | "SUP" | "OWN") {
  await page.locator(".top-actions .role-picker select").nth(1).selectOption(role);
  await expect(page.locator(".top-actions .role-picker select").nth(1)).toHaveValue(role);
  await page.getByRole("navigation").getByRole("button", { name: /commissioning.*handover.*warranty/i }).click();
  await expect(page.locator("[data-ui-component='completion-handover-workspace']")).toBeVisible({ timeout: 15000 });
}

type CommandInput = string | boolean | Ref | Ref[] | Record<string, unknown> | Array<Record<string, unknown>>;

const commandFieldLabels: Record<string, RegExp> = {
  precommissioningChecklist: /precommission|checklist|시운전|점검/i,
  testResultRef: /testResultRef|시험 결과 증빙 참조|시험 증빙/i,
  outcome: /outcome|^시험 결과$/i,
  acceptanceCriteriaMet: /acceptanceCriteria|인수 기준 충족 여부|합격 기준/i,
  failureReason: /failureReason|부적합 사유|실패 사유/i,
  correctionActionRefs: /correctionAction|시정.?조치/i,
  retestBasisRefs: /retestBasis|재시험 근거/i,
  punchIssueRefs: /punchIssue|punch issue|펀치|이슈/i,
  ownerDecisionRef: /owner decision reference|발주처 결정/i,
  reinspectionRef: /reinspection reference|재검측 참조/i,
  acceptedScope: /acceptedScope|인수 범위/i,
  effectiveAt: /effectiveAt|적용 시각/i,
  warrantyTrigger: /warrantyTrigger|보증 개시 여부/i,
  actionRefs: /actionRefs|조치 참조/i,
  responseDueAt: /responseDueAt|조치 응답 기한/i,
  remedySummary: /remedySummary|보수 요약/i,
  decisionReason: /decisionReason|결정 사유/i,
  selectedOption: /selectedOption|선택 옵션/i,
  evidenceIds: /evidence ids|명령 증빙 ID/i,
};
const workbenchFieldLabels: Record<string, RegExp> = {
  responsiblePartyId: /responsible party|담당자/i,
  responsibleOrganizationId: /responsible organization|company ID|담당 회사 ID/i,
  dueAt: /due at|기한|처리기한/i,
  actionIds: /action IDs|연결 조치 ID/i,
  closureEvidenceIds: /closureEvidenceIds|closure evidence|종결 증빙/i,
  correction: /correction|시정.?조치 내용/i,
  rootCause: /root cause|원인/i,
  preventiveAction: /preventive action|재발방지 대책/i,
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
  for (const [field, value] of Object.entries(fields)) {
    const label = commandFieldLabels[field] || new RegExp(field, "i");
    const control = dialog.getByLabel(label)
      .or(dialog.getByRole("textbox", { name: label }))
      .or(dialog.getByRole("combobox", { name: label }));
    await expect(control, `command field ${field} should be exposed with its current localized label`).toHaveCount(1, { timeout: 5000 });
    if (value && typeof value === "object" && !Array.isArray(value) && "objectType" in value && typeof value.objectId === "string") {
      const option = control.locator("option").filter({ hasText: value.objectId.slice(0, 8) });
      await expect(option, `server-provided ${value.objectType} option ${value.objectId}`).toHaveCount(1);
      await control.selectOption(await option.getAttribute("value") || "");
    } else if (Array.isArray(value) && value.length && value.every((item) => item && typeof item === "object" && "objectType" in item)) {
      const select = control;
      const isSelect = await select.evaluateAll((nodes) => nodes.some((node) => node instanceof HTMLSelectElement));
      if (isSelect) {
        const optionValues: string[] = [];
        for (const ref of value as Ref[]) {
          const option = select.locator("option").filter({ hasText: ref.objectId.slice(0, 8) });
          await expect(option, `server-provided ${ref.objectType} option ${ref.objectId}`).toHaveCount(1);
          optionValues.push(await option.getAttribute("value") || "");
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
    const evidenceInput = dialog.getByLabel(commandFieldLabels.evidenceIds);
    await expect(evidenceInput, "command evidence IDs are an explicit per-transition input").toHaveCount(1, { timeout: 5000 });
    await evidenceInput.fill(evidenceIds.join(","));
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
          await row.getByLabel(/inspection item ID|검측 항목 ID/i).fill(check.itemId);
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
  if (evidenceIds.length) await dialog.getByLabel(/evidence ids|명령 증빙 ID/i).fill(evidenceIds.join(","));
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

test("real Completion UI creates a planned commissioning package and respects the missing current procedure gate", async ({ page }) => {
  test.setTimeout(90000);
  const origin = testOrigin();
  const { child, base, fixture } = await startApi(origin);
  try {
    let latestWorkspace: any;
    await page.route("**/api/**", async (route) => {
      const response = await route.fetch({ url: route.request().url().replace(/http:\/\/127\.0\.0\.1:\d+\/api/, base), headers: { ...route.request().headers(), origin } });
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
      const option = select.locator("option").filter({ hasText: ref.objectId.slice(0, 8) });
      await expect(option, `${ref.objectType} ${ref.objectId} must be visible as a server reference option`).toHaveCount(1, { timeout: 5000 });
      await select.selectOption(await option.getAttribute("value") || "");
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
      const response = await route.fetch({ url: route.request().url().replace(/http:\/\/127\.0\.0\.1:\d+\/api/, base), headers: { ...route.request().headers(), origin } });
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
      const option = select.locator("option").filter({ hasText: ref.objectId.slice(0, 8) });
      await expect(option, `${ref.objectType} ${ref.objectId} must be visible as a server reference option`).toHaveCount(1, { timeout: 5000 });
      await select.selectOption(await option.getAttribute("value") || "");
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
