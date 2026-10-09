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

async function runCompletionHandoverScenario(page: Page, continueWarranty: boolean): Promise<void> {
  test.setTimeout(120000);
  const origin = testOrigin();
  const { child, base, fixture } = await startApi(origin);
  try {
    let latestWorkspace: any;
    await page.route("**/api/**", async (route) => {
      const response = await route.fetch({
        url: route.request().url().replace(/http:\/\/127\.0\.0\.1:\d+\/api/, base),
        headers: { ...route.request().headers(), origin },
      });
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
      const option = select.locator("option").filter({ hasText: ref.objectId.slice(0, 8) });
      await expect(option, `authorized ${ref.objectType} ${ref.objectId} reference must be selectable; options: ${(await select.locator("option").allTextContents()).join(" | ")}`).toHaveCount(1, { timeout: 7000 });
      await select.selectOption(await option.getAttribute("value") || "");
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

    await page.goto("/#/parallel-test");
    await page.getByRole("tab", { name: /work inbox|작업함/i }).click();
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
    expect(readyAction?.fields).toContain("punchIssueRefs");
    expect(readyAction?.blockedReason?.code).toBe("REFERENCE_STALE");
    expect(currentPunchRef).toMatchObject({ objectId: fixture.issueRef.objectId, version: completedPunch.record.version });
    expect(commissioningReady.record.data.punchIssueRefs[0].version).toBeLessThan(currentPunchRef!.version);
    await runCompletionCommand(page, /mark ready for handover/i, { punchIssueRefs: [currentPunchRef!] }, [fixture.retestEvidenceId]);
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
      const option = handoverAssets.locator("option").filter({ hasText: ref.objectId.slice(0, 8) });
      await expect(option, `authorized handover Asset ${ref.objectId}`).toHaveCount(1);
      handoverAssetValues.push(await option.getAttribute("value") || "");
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

    await useRole(page, "SUP");
    await workspace.getByRole("tab", { name: /handover/i }).click();
    await workspace.getByRole("button", { name: /Browser closed loop partial handover/ }).click();
    await runCompletionCommand(page, /close handover package/i);
    await useRole(page, "OWN");
    await workspace.getByRole("tab", { name: /warranty/i }).click();
    await workspace.locator('[data-ui-component="completion-create-action"] button').click();
    create = page.getByRole("dialog");
    await create.getByLabel(/title/i).fill("Browser warranty defect claim");
    await create.getByLabel(/number/i).fill("WC-CLOSED-01");
    await create.getByLabel(/^system$/i).fill("SYS-BROWSER");
    await chooseRef(create, /warranty period/i, fixture.warrantyPeriodRef);
    await chooseRef(create, /handover/i, { objectType: "WorkItem", objectId: handoverId, version: partial.record.version });
    await chooseRef(create, /issue/i, fixture.reservationIssueRef);
    await create.getByLabel(/observed at/i).fill(await localDateTime(page, fixture.warrantyStartAt));
    await create.getByLabel(/defect description/i).fill("Seal leakage observed at the accepted flange");
    await create.getByLabel(/cause description/i).fill("Seal failed during operation");
    await create.getByLabel(/operational impact/i).fill("System isolated pending repair");
    await create.getByLabel(/scope id/i).fill("SYS-BROWSER-SEGMENT-A");
    await create.getByLabel(/^system/i).last().fill("SYS-BROWSER");
    await create.getByLabel(/location/i).selectOption(fixture.scope.locationId);
    const evidenceSelect = create.getByLabel(/evidence/i);
    const evidenceOption = evidenceSelect.locator("option").filter({ hasText: fixture.evidenceId.slice(0, 8) });
    await expect(evidenceOption).toHaveCount(1);
    await evidenceSelect.selectOption(await evidenceOption.getAttribute("value") || "");
    const createClaim = page.waitForResponse((response) => response.request().method() === "POST" && /\/warranty-claims$/.test(response.url()));
    await create.getByRole("button", { name: /save draft/i }).click();
    const claimResponse = await createClaim;
    const claimBody = await claimResponse.json();
    expect(claimResponse.status(), JSON.stringify(claimBody)).toBe(201);
    expect(new Date(claimBody.record.data.defectObservedAt).toISOString())
      .toBe(new Date(fixture.warrantyStartAt).toISOString());
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
    const actionAuthoring = page.locator("[data-ui-component='action-authoring-panel']");
    await expect(actionAuthoring).toBeVisible();
    const remedyActionTitle = "F-07 browser warranty corrective action";
    await actionAuthoring.getByLabel(/action title/i).fill(remedyActionTitle);
    const relatedIssue = actionAuthoring.getByLabel(/related issue/i);
    const issueOption = relatedIssue.locator("option").filter({ hasText: fixture.reservationIssueRef.objectId });
    await expect(issueOption, "select the exact current warranty Issue reference").toHaveCount(1);
    await relatedIssue.selectOption(fixture.reservationIssueRef.objectId);
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
    // version. Any stale-reference guard on the next warranty transition is
    // reported as a contract boundary, never worked around with a newer ref.
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
    const reservationPunchTitle = "F-07 browser reservation Punch";
    await runWorkbenchCommand(page, "issues", reservationPunchTitle, /assign|담당자 배정/i, {
      responsiblePartyId: fixture.actors.CON,
      responsibleOrganizationId: fixture.responsibleOrganizationId,
      dueAt: fixture.tomorrow,
      actionIds: [fixture.reservationActionRef.objectId, remedyActionId],
    });
    await useRole(page, "CON");
    await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
    await runWorkbenchCommand(page, "issues", reservationPunchTitle, /start correction|시정 시작/i);
    await page.goto("/#/parallel-test");
    await page.getByRole("tab", { name: /work inbox|작업함/i }).click();
    const warrantyCasePanel = page.getByTestId("inspection-case-flow");
    await warrantyCasePanel.getByLabel(/source inspection|root inspection|원 검측 선택/i).selectOption(fixture.inspectionRef.objectId);
    const warrantyIssueCard = warrantyCasePanel.locator(".inspection-case-issue").filter({ hasText: reservationPunchTitle });
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
    const warrantyReinspectionId = warrantyReinspectionBody.reinspection.id as string;

    await useRole(page, "SUP");
    await page.getByRole("navigation").getByRole("button", { name: /issues/i }).click();
    await runWorkbenchCommand(page, "issues", reservationPunchTitle, /start reinspection|재검측 시작/i);
    await page.getByRole("navigation").getByRole("button", { name: /inspection.*acceptance/i }).click();
    await runWorkbenchCommand(page, "inspections", warrantyReinspectionName, /receive|접수/i, { "접수 시각": new Date().toISOString() });
    await runWorkbenchCommand(page, "inspections", warrantyReinspectionName, /schedule|일정 배정/i, { "검측 예정시각": new Date(Date.now() + 3600000).toISOString() });
    await runWorkbenchCommand(page, "inspections", warrantyReinspectionName, /start|시작/i);
    const warrantyPassingChecks = JSON.stringify([{ itemId: "dimension", requirementRef: fixture.requirementRef, result: "pass", evidenceIds: [fixture.evidenceId, fixture.retestEvidenceId], measuredValue: 1, unit: "count" }]);
    await runWorkbenchCommand(page, "inspections", warrantyReinspectionName, /submit results|결과 제출/i, { "검측 항목·측정 결과": warrantyPassingChecks }, [fixture.evidenceId, fixture.retestEvidenceId]);
    await runWorkbenchCommand(page, "inspections", warrantyReinspectionName, /mark compliant|pass|적합 판정/i, {}, [fixture.evidenceId, fixture.retestEvidenceId]);
    expect(latestWorkspace.items.find((item: any) => item.record.id === warrantyReinspectionId)?.record.status).toBe("passed");

    await useRole(page, "SUP");
    await page.getByRole("navigation").getByRole("button", { name: /commissioning.*handover.*warranty/i }).click();
    await workspace.getByRole("tab", { name: /warranty/i }).click();
    await workspace.getByRole("button", { name: /Browser warranty defect claim/ }).click();
    const claimAfterReinspection = latestWorkspace.items.find((item: any) => item.record.id === claimId);
    const reservationIssue = latestWorkspace.items.find((item: any) => item.record.id === fixture.reservationIssueRef.objectId);
    expect(claimAfterReinspection.record.data.issueRef.version).toBeLessThan(reservationIssue.record.version);
    const acceptRemedy = claimAfterReinspection.actions.find((action: any) => action.command === "accept_remedy");
    expect(acceptRemedy?.fields).toContain("reinspectionRef");
    const currentReinspectionRef = latestWorkspace.context.referenceCatalog.inspections
      .find((entry: any) => entry.ref.objectId === warrantyReinspectionId)?.ref as Ref | undefined;
    expect(currentReinspectionRef).toBeDefined();
    await runCompletionCommand(page, /accept remedy/i, { reinspectionRef: currentReinspectionRef! }, [fixture.evidenceId], "REFERENCE_STALE");
  } finally {
    await stopApi(child);
  }
}

test("real Completion UI carries commissioning through partial handover and records the verified Action gate", async ({ page }) => {
  await runCompletionHandoverScenario(page, false);
});

test("complementary warranty UI reaches the stale Issue reference gate after actual reinspection", async ({ page }) => {
  await runCompletionHandoverScenario(page, true);
});
