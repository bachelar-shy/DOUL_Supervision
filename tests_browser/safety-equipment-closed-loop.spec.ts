import { selectCommandEvidence } from "./command-evidence-helper";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { resolve, join, delimiter } from "node:path";
import { commands, fields } from "../apps/web/src/labels";

type ActorGroup = "CON" | "SUP";
type Session = { accessToken: string; projectId: string; actor: { actorGroup: ActorGroup; partyId: string; roleAssignmentId: string } };
type Ref = { objectType: string; objectId: string; version: number };
type RecordData = { id: string; version: number; title?: string; status: string; data?: Record<string, any>; [key: string]: any };
type Fixture = {
  projectId: string;
  scope: Record<string, string | number>;
  evidenceId: string;
  requirementRef: Ref;
  assetRef: Ref;
  certificateRef: Ref;
  calibrationRef: Ref;
  methodStatementRef: Ref;
  riskAssessmentRef: Ref;
  emergencyPlanRef: Ref;
};

const safetyTabs = { permit: "작업허가", stop: "작업중지", equipment: "장비 안전검사" } as const;
const expectedVersions = new Map<string, number>();
let fixtureToken = "";
let apiOrigin = "";
let fixtureProcess: ChildProcess | undefined;
let fixtureDatabase = "";
let fixtureStderr = "";

if (process.env.SAFETY_EQUIPMENT_TEST_CHROMIUM) {
  test.use({ launchOptions: { executablePath: process.env.SAFETY_EQUIPMENT_TEST_CHROMIUM, args: ["--no-sandbox"] } });
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a local fixture port");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

test.beforeAll(async () => {
  const port = await availablePort();
  fixtureToken = randomBytes(32).toString("hex");
  apiOrigin = `http://127.0.0.1:${port}`;
  fixtureDatabase = join(process.cwd(), "work", `safety-equipment-browser-${randomUUID()}.sqlite3`);
  mkdirSync(join(process.cwd(), "work"), { recursive: true });
  const venvPython = resolve(process.cwd(), ".venv/bin/python");
  const python = process.env.SAFETY_EQUIPMENT_TEST_PYTHON || process.env.DOUL_TEST_PYTHON || venvPython;
  const script = resolve(process.cwd(), "tests_browser/support/safety_equipment_api_fixture.py");
  fixtureProcess = spawn(python, [script, "--database", fixtureDatabase, "--port", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SAFETY_EQUIPMENT_TEST_FIXTURE_TOKEN: fixtureToken,
      PYTHONPATH: [process.cwd(), process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  fixtureProcess.stderr?.on("data", (chunk: Buffer) => { fixtureStderr += chunk.toString(); });
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (fixtureProcess.exitCode !== null) throw new Error(`Safety fixture exited early (${fixtureProcess.exitCode}): ${fixtureStderr}`);
    try {
      const response = await fetch(`${apiOrigin}/health`);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  fixtureProcess.kill("SIGTERM");
  throw new Error(`Safety API fixture did not become healthy: ${String(lastError)}; ${fixtureStderr}`);
}, 45_000);

test.afterAll(async () => {
  if (fixtureProcess && fixtureProcess.exitCode === null) {
    const child = fixtureProcess;
    child.kill("SIGTERM");
    await new Promise<void>((resolveExit) => {
      const timeout = setTimeout(() => { child.kill("SIGKILL"); resolveExit(); }, 3_000);
      child.once("exit", () => { clearTimeout(timeout); resolveExit(); });
    });
  }
  fixtureProcess = undefined;
  if (fixtureDatabase) {
    for (const path of [fixtureDatabase, `${fixtureDatabase}-wal`, `${fixtureDatabase}-shm`]) rmSync(path, { force: true });
  }
});

test.beforeEach(async ({ page }) => {
  // The product page stays real. route.fetch forwards its authenticated API
  // requests to this test's isolated Uvicorn process without synthesizing data.
  await page.route("**/api/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname.replace(/^\/api/, "");
    const response = await route.fetch({ url: `${apiOrigin}${path}${requestUrl.search}` });
    await route.fulfill({ response });
  });
});

async function jsonResponse<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>, expected: number): Promise<T> {
  const text = await response.text();
  expect(response.status(), text).toBe(expected);
  return JSON.parse(text) as T;
}

async function login(request: APIRequestContext, actorGroup: ActorGroup): Promise<Session> {
  const response = await request.post(`${apiOrigin}/dev/sessions`, { data: { actorGroup } });
  return jsonResponse<Session>(response, 200);
}

async function readFixture(request: APIRequestContext): Promise<Fixture> {
  const response = await request.get(`${apiOrigin}/test-fixtures/safety-equipment`, {
    headers: { "X-Test-Fixture-Token": fixtureToken },
  });
  return jsonResponse<Fixture>(response, 200);
}

function auth(session: Session) {
  return { Authorization: `Bearer ${session.accessToken}`, "X-Role-Assignment-Id": session.actor.roleAssignmentId };
}

async function readWorkspace(request: APIRequestContext, session: Session) {
  const response = await request.get(`${apiOrigin}/projects/${session.projectId}/workspace`, { headers: auth(session) });
  return jsonResponse<{
    items: Array<{ machine: string; record: RecordData }>;
    context?: { scope?: Record<string, unknown>; referenceCatalog?: { issues?: Array<{ ref: Ref; record: RecordData }> } };
    participants?: Array<{ actorGroup: string; partyId: string }>;
  }>(response, 200);
}

function commandLabel(command: string) {
  return (commands as Record<string, string>)[command] || command.replaceAll("_", " ");
}

function fieldLabel(field: string) {
  return (fields as Record<string, string>)[field] || field;
}

async function chooseRole(page: Page, actorGroup: ActorGroup) {
  await page.goto("/#/safety");
  const picker = page.getByRole("combobox", { name: "시험 사용자 역할 선택" });
  if (await picker.count() && await picker.inputValue() !== actorGroup) {
    const refreshed = page.waitForResponse((response) => response.url().endsWith("/workspace") && response.ok());
    await picker.selectOption(actorGroup);
    await refreshed;
  }
  await page.goto("/#/safety");
  await expect(page.locator('[data-ui-component="safety-workspace"]')).toBeVisible();
}

async function selectTab(page: Page, tab: string) {
  await page.getByRole("tab", { name: tab, exact: true }).click();
}

async function selectRecord(page: Page, title: string) {
  const row = page.locator(".record-list").getByRole("button").filter({ hasText: title }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator(".detail-head h2, h2.detail-title")).toHaveText(title);
}

async function createSafetyDraft(page: Page, machine: "equipment" | "permit" | "stop", fixture: Fixture, title: string, permitTitle?: string) {
  await selectTab(page, safetyTabs[machine]);
  const disclosure = page.locator('[data-ui-component="safety-create-disclosure"]');
  if ((await disclosure.getAttribute("open")) === null) await disclosure.locator("summary").click();
  const panel = page.locator('[data-ui-component="safety-authoring-panel"]');
  await expect(panel).toBeVisible();
  await panel.getByLabel("기록 제목", { exact: true }).fill(title);
  const requirementGroup = panel.getByRole("group", { name: "적용 요건" });
  await requirementGroup.getByLabel("Safety equipment inspection and permit control", { exact: false }).check();
  const evidenceGroup = panel.getByRole("group", { name: "증빙" });
  if (machine === "permit" || machine === "stop") await evidenceGroup.getByRole("checkbox").first().check();
  if (machine === "equipment") {
    const equipmentSelect = panel.locator("select").first();
    await equipmentSelect.selectOption(`${fixture.assetRef.objectType}:${fixture.assetRef.objectId}:${fixture.assetRef.version}`);
    await panel.getByLabel("검사 유형", { exact: true }).fill("Pre-use safety inspection");
  } else if (machine === "permit") {
    await panel.getByLabel("허가 번호", { exact: true }).fill(`PERMIT-${title.slice(-8)}`);
    await panel.getByLabel("작업 유형", { exact: true }).fill("Equipment operation");
    await panel.getByLabel("위험 수준", { exact: true }).fill("high");
  }
  if (machine === "stop") {
    await panel.getByLabel("작업중지 번호", { exact: true }).fill(`STOP-${title.slice(-8)}`);
    await panel.getByLabel("중지 범위 유형", { exact: true }).fill("permit");
    await panel.getByLabel("작업중지 사유", { exact: true }).fill("Pre-start inspection found incomplete edge protection.");
    await panel.getByLabel("위험 설명", { exact: true }).fill("Unprotected edge in the active work area.");
    const now = new Date();
    const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await panel.getByLabel("발견 시각", { exact: true }).fill(localNow);
    await panel.getByLabel("시행 시각", { exact: true }).fill(localNow);
    const affectedPermits = panel.getByRole("group", { name: "영향 작업허가" });
    const permitLabel = affectedPermits.locator("label").filter({ hasText: permitTitle || "" });
    await permitLabel.locator('input[type="checkbox"]').check();
  }
  const collection = machine === "equipment" ? "safety-equipment-inspections" : machine === "permit" ? "safety-permits" : "safety-stop-orders";
  const createdResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith(`/${collection}`));
  await panel.getByRole("button", { name: "안전 초안 저장", exact: true }).click();
  const response = await createdResponse;
  const body = await jsonResponse<{ record: RecordData }>(response, 201);
  expectedVersions.set(body.record.id, body.record.version);
  return body.record;
}

async function setCommandField(dialog: Locator, field: string, value: unknown) {
  const name = fieldLabel(field);
  const locator = dialog.getByLabel(name, { exact: true })
    .or(dialog.getByRole("textbox", { name, exact: true }))
    .or(dialog.getByRole("combobox", { name, exact: true }))
    .or(dialog.getByRole("listbox", { name, exact: true }));
  await expect(locator).toBeVisible();
  const tag = await locator.evaluate((element) => element.tagName.toLowerCase());
  if (tag === "select") {
    const multiple = await locator.evaluate((element) => (element as HTMLSelectElement).multiple);
    if (multiple) {
      await locator.selectOption(Array.isArray(value) ? value.map((ref) => JSON.stringify(ref)) : []);
    } else {
      await locator.selectOption(typeof value === "string" ? value : JSON.stringify(value));
    }
  } else {
    await locator.fill(typeof value === "string" ? value : JSON.stringify(value));
  }
}

async function openAndSubmitCommand(
  page: Page,
  projectId: string,
  current: RecordData,
  collection: string,
  command: string,
  payload: Record<string, unknown> = {},
  evidenceIds: string[] = [],
) {
  const label = commandLabel(command);
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: label });
  for (const [field, value] of Object.entries(payload)) await setCommandField(dialog, field, value);
  if (evidenceIds.length) await selectCommandEvidence(dialog,evidenceIds);
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith(`/api/projects/${projectId}/${collection}/${current.id}/${command.replaceAll("_", "-")}`));
  await dialog.locator(".modal-actions button.primary").click();
  const response = await responsePromise.catch(async (error) => {
    const alerts = await dialog.locator('[role="alert"]').allTextContents();
    throw new Error(`${command} did not reach the API; alerts=${JSON.stringify(alerts)}; ${String(error)}`);
  });
  expect(response.request().postDataJSON().expectedVersion).toBe(expectedVersions.get(current.id));
  expect(response.request().headers()["idempotency-key"]).toBeTruthy();
  return { response, dialog, label };
}

async function runCommand(
  page: Page,
  projectId: string,
  current: RecordData,
  collection: string,
  command: string,
  payload: Record<string, unknown> = {},
  evidenceIds: string[] = [],
): Promise<RecordData> {
  const { response, dialog } = await openAndSubmitCommand(page, projectId, current, collection, command, payload, evidenceIds);
  const body = await jsonResponse<{ record: RecordData }>(response, 200);
  expect(body.record.id).toBe(current.id);
  expectedVersions.set(body.record.id, body.record.version);
  await expect(dialog).toHaveCount(0);
  return body.record;
}

test("real Safety UI/API gates Permit activation on current equipment and keeps Stop lift separate from Permit resume", async ({ page, request }) => {
  test.setTimeout(180_000);
  expectedVersions.clear();
  const fixture = await readFixture(request);
  const con = await login(request, "CON");
  const sup = await login(request, "SUP");
  expect(con.projectId).toBe(sup.projectId);
  const suffix = randomUUID().slice(0, 8);
  const equipmentTitle = `AC-S Equipment ${suffix}`;
  const permitTitle = `AC-S Permit ${suffix}`;
  const pagePosts: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/api\/projects\/[^/]+\/(?:safety-equipment-inspections|safety-permits|safety-stop-orders|actions)(?:\/|$)/.test(new URL(req.url()).pathname)) pagePosts.push(req.url());
  });

  // The only direct fixture objects are upstream Equipment, approved documents,
  // and a scoped Requirement. The EquipmentInspection and Permit are authored
  // and transitioned through the UI against the self-hosted real HTTP API.
  await chooseRole(page, "SUP");
  const equipment = await createSafetyDraft(page, "equipment", fixture, equipmentTitle);
  expect(equipment.subtype).toBe("SafetyEquipmentInspection");
  expect(equipment.status).toBe("due");
  expect(equipment.data?.equipmentAvailable).toBe(false);
  expect(equipment.data?.equipmentRef).toEqual(fixture.assetRef);

  await chooseRole(page, "CON");
  await selectTab(page, safetyTabs.equipment);
  await selectRecord(page, equipmentTitle);
  let currentEquipment = await runCommand(page, fixture.projectId, equipment, "safety-equipment-inspections", "request_inspection");
  expect(currentEquipment.status).toBe("requested");

  await chooseRole(page, "SUP");
  await selectTab(page, safetyTabs.equipment);
  await selectRecord(page, equipmentTitle);
  currentEquipment = await runCommand(page, fixture.projectId, currentEquipment, "safety-equipment-inspections", "schedule_inspection", {
    scheduledAt: new Date(Date.now() + 60_000).toISOString(),
  });
  currentEquipment = await runCommand(page, fixture.projectId, currentEquipment, "safety-equipment-inspections", "start_inspection", {
    inspectedAt: new Date().toISOString(),
  });
  currentEquipment = await runCommand(page, fixture.projectId, currentEquipment, "safety-equipment-inspections", "submit_result", {
    resultSummary: "Pre-use check found a damaged lifting cable.",
  }, [fixture.evidenceId]);
  currentEquipment = await runCommand(page, fixture.projectId, currentEquipment, "safety-equipment-inspections", "fail", {
    failureReason: "Damaged lifting cable; equipment cannot be used.",
    blockedReasons: ["Replace damaged cable before use"],
  }, [fixture.evidenceId]);
  expect(currentEquipment.status).toBe("failed");
  expect(currentEquipment.data?.equipmentAvailable).toBe(false);

  const prerequisiteWorkspace = await readWorkspace(request, sup);
  const correctiveAction = prerequisiteWorkspace.items.find((item) => item.machine === "action" && !["cancelled", "closed"].includes(item.record.status));
  const prestartInspection = prerequisiteWorkspace.items.find((item) => item.machine === "inspection"
    && item.record.resultStatus === "pass" && ["passed", "completed"].includes(item.record.status));
  expect(correctiveAction, "trusted demo corrective-action reference should be readable").toBeTruthy();
  expect(prestartInspection, "trusted demo passed inspection reference should be readable").toBeTruthy();
  currentEquipment = await runCommand(page, fixture.projectId, currentEquipment, "safety-equipment-inspections", "require_reinspection", {
    correctiveActionRefs: [{ objectType: "Action", objectId: correctiveAction!.record.id, version: correctiveAction!.record.version }],
    reason: "Correct the damaged cable and verify equipment before reuse.",
  });
  expect(currentEquipment.status).toBe("reinspection_due");

  // Prepare and review a real permit while the latest equipment inspection is
  // failed. The subsequent activation attempt must be rejected atomically.
  await chooseRole(page, "CON");
  const permitDraft = await createSafetyDraft(page, "permit", fixture, permitTitle);
  expect(permitDraft.subtype).toBe("SafetyPermit");
  expect(permitDraft.status).toBe("draft");
  await selectRecord(page, permitTitle);
  const readiness = {
    methodStatementCurrent: true,
    riskAssessmentCurrent: true,
    personnelQualified: true,
    equipmentReady: true,
    controlMeasuresReady: true,
    emergencyReady: true,
    environmentalConditionsReady: true,
    noBlockingSafetyIssue: true,
  };
  const validFrom = new Date(Date.now() - 60_000).toISOString();
  const validTo = new Date(Date.now() + 86_400_000).toISOString();
  let currentPermit = await runCommand(page, fixture.projectId, permitDraft, "safety-permits", "submit_permit", {
    permitNo: `PERMIT-${suffix}`,
    workType: "Equipment operation",
    riskLevel: "high",
    responsiblePartyId: con.actor.partyId,
    safetyResponsiblePartyId: sup.actor.partyId,
    methodStatementRef: fixture.methodStatementRef,
    riskAssessmentRef: fixture.riskAssessmentRef,
    emergencyPlanRef: fixture.emergencyPlanRef,
    personnelQualificationRefs: [],
    equipmentRefs: [fixture.assetRef],
    validFrom,
    validTo,
    readiness,
    blockedReasons: [],
  }, [fixture.evidenceId]);
  expect(currentPermit.data?.equipmentRefs).toEqual([fixture.assetRef]);
  await chooseRole(page, "SUP");
  await selectTab(page, safetyTabs.permit);
  await selectRecord(page, permitTitle);
  currentPermit = await runCommand(page, fixture.projectId, currentPermit, "safety-permits", "receive_permit");
  currentPermit = await runCommand(page, fixture.projectId, currentPermit, "safety-permits", "accept_for_safety_review");
  currentPermit = await runCommand(page, fixture.projectId, currentPermit, "safety-permits", "request_prestart_verification", {
    safetyReviewComplete: true,
    readiness,
    reviewNotes: "Current equipment inspection must pass before this permit can activate.",
  });
  currentPermit = await runCommand(page, fixture.projectId, currentPermit, "safety-permits", "request_authorization", {
    prestartVerified: true,
    prestartVerificationRefs: [{ objectType: "Inspection", objectId: prestartInspection!.record.id, version: prestartInspection!.record.version }],
    readiness,
  }, [fixture.evidenceId]);
  currentPermit = await runCommand(page, fixture.projectId, currentPermit, "safety-permits", "authorize", {
    validFrom,
    validTo,
  });
  expect(currentPermit.status).toBe("authorized");
  expect(currentPermit.data?.workAuthorized).toBe(false);

  const blocked = await openAndSubmitCommand(page, fixture.projectId, currentPermit, "safety-permits", "activate", {
    readiness,
    blockedReasons: [],
  });
  const blockedText = await blocked.response.text();
  expect(blocked.response.status(), blockedText).toBe(409);
  const blockedBody = JSON.parse(blockedText) as { code: string };
  expect(blockedBody.code).toBe("SAFETY_WORK_AUTHORIZED");
  await expect(blocked.dialog).toBeVisible();
  await blocked.dialog.getByRole("button", { name: "대화상자 닫기", exact: true }).click();
  const unchangedWorkspace = await readWorkspace(request, sup);
  const unchangedPermit = unchangedWorkspace.items.find((item) => item.record.id === currentPermit.id)?.record;
  expect(unchangedPermit?.status).toBe("authorized");
  expect(unchangedPermit?.version).toBe(currentPermit.version);
  expect(unchangedPermit?.data?.workAuthorized).toBe(false);

  // Reinspect the same equipment after the recorded correction, with current
  // approved safety/calibration documents, a qualified supervisor and evidence.
  const equipmentRef = { objectType: "WorkItem", objectId: currentEquipment.id, version: currentEquipment.version };
  await chooseRole(page, "CON");
  await selectTab(page, safetyTabs.equipment);
  await selectRecord(page, equipmentTitle);
  currentEquipment = await runCommand(page, fixture.projectId, currentEquipment, "safety-equipment-inspections", "request_reinspection", {
    reinspectionRefs: [equipmentRef],
  }, [fixture.evidenceId]);
  await chooseRole(page, "SUP");
  await selectTab(page, safetyTabs.equipment);
  await selectRecord(page, equipmentTitle);
  currentEquipment = await runCommand(page, fixture.projectId, currentEquipment, "safety-equipment-inspections", "schedule_inspection", {
    scheduledAt: new Date(Date.now() + 60_000).toISOString(),
  });
  currentEquipment = await runCommand(page, fixture.projectId, currentEquipment, "safety-equipment-inspections", "start_inspection", {
    inspectedAt: new Date().toISOString(),
  });
  currentEquipment = await runCommand(page, fixture.projectId, currentEquipment, "safety-equipment-inspections", "submit_result", {
    resultSummary: "Replacement cable inspected; pre-use check passed.",
    certificateRefs: [fixture.certificateRef],
    calibrationRefs: [fixture.calibrationRef],
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validTo: new Date(Date.now() + 86_400_000).toISOString(),
    preUseCheckComplete: true,
    blockedReasons: [],
  }, [fixture.evidenceId]);
  currentEquipment = await runCommand(page, fixture.projectId, currentEquipment, "safety-equipment-inspections", "pass", {
    blockedReasons: [],
  }, [fixture.evidenceId]);
  expect(currentEquipment.status).toBe("passed");
  expect(currentEquipment.data?.equipmentAvailable).toBe(true);

  await chooseRole(page, "SUP");
  await selectTab(page, safetyTabs.permit);
  await selectRecord(page, permitTitle);
  currentPermit = await runCommand(page, fixture.projectId, currentPermit, "safety-permits", "activate", {
    readiness,
    blockedReasons: [],
  });
  expect(currentPermit.status).toBe("active");
  expect(currentPermit.data?.workAuthorized).toBe(true);

  // Continue the same equipment-backed Permit through a distinct Stop and
  // resume cycle. These trusted demo records are prerequisites only; every
  // Safety/Action transition below is still submitted through the browser UI.
  const remedyWorkspace = await readWorkspace(request, sup);
  const scope = remedyWorkspace.context?.scope || {};
  const relatedIssue = remedyWorkspace.context?.referenceCatalog?.issues?.find(({ record }) =>
    record.projectId === con.projectId && ["packageId", "locationId", "discipline", "responsibleOrganizationId"]
      .every((field) => record[field] === scope[field]));
  const contractor = remedyWorkspace.participants?.find((participant) => participant.actorGroup === "CON");
  const passedInspection = remedyWorkspace.items.find((item) => item.machine === "inspection"
    && item.record.resultStatus === "pass" && ["passed", "completed"].includes(item.record.status));
  expect(relatedIssue, "trusted demo project should provide a readable in-scope Issue").toBeTruthy();
  expect(contractor, "trusted demo project should provide a readable contractor participant").toBeTruthy();
  expect(passedInspection, "trusted demo project should provide a current passed Inspection").toBeTruthy();

  const remedyTitle = `AC-S Equipment remedy ${suffix}`;
  await page.goto("/#/actions");
  await page.locator('[data-ui-component="new-action-entry"] button').click();
  const actionPanel = page.locator('[data-ui-component="action-authoring-panel"]');
  await expect(actionPanel).toBeVisible();
  await actionPanel.getByLabel("시정조치 제목", { exact: true }).fill(remedyTitle);
  await actionPanel.getByLabel("관련 지적사항", { exact: true }).selectOption(relatedIssue!.ref.objectId);
  await actionPanel.getByLabel("담당자", { exact: true }).selectOption(contractor!.partyId);
  await actionPanel.getByLabel("기한", { exact: true }).fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
  const actionCreate = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === `/api/projects/${con.projectId}/actions`);
  await actionPanel.getByRole("button", { name: "시정조치 초안 저장", exact: true }).click();
  const actionResponse = await actionCreate;
  const actionBody = await jsonResponse<{ record: RecordData }>(actionResponse, 201);
  let remedied = actionBody.record;
  expect(remedied.status).toBe("draft");
  expectedVersions.set(remedied.id, remedied.version);

  await chooseRole(page, "SUP");
  const stopTitle = `AC-S Equipment Stop ${suffix}`;
  const stop = await createSafetyDraft(page, "stop", fixture, stopTitle, permitTitle);
  expect(stop.subtype).toBe("SafetyStopOrder");
  expect(stop.status).toBe("issued");
  let suspendedWorkspace = await readWorkspace(request, sup);
  currentPermit = suspendedWorkspace.items.find((item) => item.record.id === currentPermit.id)!.record;
  expectedVersions.set(currentPermit.id, currentPermit.version);
  expect(currentPermit.status).toBe("suspended");
  expect(currentPermit.data?.workAuthorized).toBe(false);
  expect(currentPermit.data?.equipmentRefs).toEqual([fixture.assetRef]);

  await chooseRole(page, "CON");
  await selectTab(page, safetyTabs.stop);
  await selectRecord(page, stopTitle);
  let currentStop = await runCommand(page, fixture.projectId, stop, "safety-stop-orders", "acknowledge_stop");

  await chooseRole(page, "SUP");
  await page.goto("/#/actions");
  await selectRecord(page, remedyTitle);
  remedied = await runCommand(page, fixture.projectId, remedied, "actions", "assign", {
    responsiblePartyId: contractor!.partyId,
    responsibleOrganizationId: scope.responsibleOrganizationId,
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  await chooseRole(page, "CON");
  await page.goto("/#/actions");
  await selectRecord(page, remedyTitle);
  remedied = await runCommand(page, fixture.projectId, remedied, "actions", "start");
  remedied = await runCommand(page, fixture.projectId, remedied, "actions", "submit", {
    correction: "Restored the missing edge protection and isolated the affected work area.",
    rootCause: "A temporary access change omitted the edge protection check.",
    preventiveAction: "Add an independent edge protection confirmation to pre-start checks.",
  }, [fixture.evidenceId]);
  await chooseRole(page, "SUP");
  await page.goto("/#/actions");
  await selectRecord(page, remedyTitle);
  remedied = await runCommand(page, fixture.projectId, remedied, "actions", "verify", {}, [fixture.evidenceId]);
  expect(remedied.status).toBe("verified");

  await chooseRole(page, "CON");
  await selectTab(page, safetyTabs.stop);
  await selectRecord(page, stopTitle);
  currentStop = await runCommand(page, fixture.projectId, currentStop, "safety-stop-orders", "start_correction", {
    correctiveActionRefs: [{ objectType: "Action", objectId: remedied.id, version: remedied.version }],
  });
  currentStop = await runCommand(page, fixture.projectId, currentStop, "safety-stop-orders", "request_resume", {}, [fixture.evidenceId]);
  await chooseRole(page, "SUP");
  await selectTab(page, safetyTabs.stop);
  await selectRecord(page, stopTitle);
  currentStop = await runCommand(page, fixture.projectId, currentStop, "safety-stop-orders", "start_resume_verification", {
    resumeVerificationRefs: [{ objectType: "Inspection", objectId: passedInspection!.record.id, version: passedInspection!.record.version }],
  });
  currentStop = await runCommand(page, fixture.projectId, currentStop, "safety-stop-orders", "lift_stop", {}, [fixture.evidenceId]);
  expect(currentStop.status).toBe("lifted");
  expect(Object.values(currentStop.data?.resumeGate || {}).every((value) => value === true)).toBe(true);

  suspendedWorkspace = await readWorkspace(request, sup);
  currentPermit = suspendedWorkspace.items.find((item) => item.record.id === currentPermit.id)!.record;
  expectedVersions.set(currentPermit.id, currentPermit.version);
  expect(currentPermit.status).toBe("suspended");
  expect(currentPermit.data?.workAuthorized).toBe(false);
  await chooseRole(page, "CON");
  await selectTab(page, safetyTabs.permit);
  await selectRecord(page, permitTitle);
  currentPermit = await runCommand(page, fixture.projectId, currentPermit, "safety-permits", "request_resume", {
    readiness,
    blockedReasons: [],
  }, [fixture.evidenceId]);
  expect(currentPermit.status).toBe("resume_review");
  expect(currentPermit.data?.workAuthorized).toBe(false);
  await chooseRole(page, "SUP");
  await selectTab(page, safetyTabs.permit);
  await selectRecord(page, permitTitle);
  currentPermit = await runCommand(page, fixture.projectId, currentPermit, "safety-permits", "approve_resume", {
    readiness,
    blockedReasons: [],
  }, [fixture.evidenceId]);
  expect(currentPermit.status).toBe("active");
  expect(currentPermit.data?.workAuthorized).toBe(true);

  const persisted = await readWorkspace(request, sup);
  const persistedPermit = persisted.items.find((item) => item.record.id === currentPermit.id)?.record;
  const persistedEquipment = persisted.items.find((item) => item.record.id === currentEquipment.id)?.record;
  expect(persistedPermit?.data?.equipmentRefs).toEqual([fixture.assetRef]);
  expect(persistedPermit?.data?.workAuthorized).toBe(true);
  expect(persistedPermit?.data?.stopOrderRefs).toContainEqual({ objectType: "WorkItem", objectId: currentStop.id, version: stop.version });
  expect(persistedEquipment?.status).toBe("passed");
  expect(persistedEquipment?.data?.equipmentAvailable).toBe(true);
  expect(persisted.items.find((item) => item.record.id === currentStop.id)?.record.status).toBe("lifted");
  expect(persisted.items.find((item) => item.record.id === remedied.id)?.record.status).toBe("verified");
  expect(pagePosts.some((url) => url.endsWith("/safety-equipment-inspections"))).toBe(true);
  expect(pagePosts.some((url) => url.endsWith("/safety-permits"))).toBe(true);
  expect(pagePosts.some((url) => url.endsWith("/safety-stop-orders"))).toBe(true);
  expect(pagePosts.some((url) => url.includes(`/actions/${remedied.id}/submit`))).toBe(true);
  expect(pagePosts.some((url) => url.includes(`/actions/${remedied.id}/verify`))).toBe(true);
  expect(pagePosts.some((url) => url.includes(`/safety-stop-orders/${stop.id}/lift-stop`))).toBe(true);
  expect(pagePosts.some((url) => url.includes(`/safety-permits/${currentPermit.id}/approve-resume`))).toBe(true);
  expect(pagePosts.every((url) => /\/(?:safety-equipment-inspections|safety-permits|safety-stop-orders|actions)(?:\/|$)/.test(new URL(url).pathname))).toBe(true);
});

test("real Safety UI/API separates Stop correction, verification, lift, and Permit resume approval", async ({ page, request }) => {
  test.setTimeout(180_000);
  expectedVersions.clear();
  const fixture = await readFixture(request);
  const con = await login(request, "CON");
  const sup = await login(request, "SUP");
  expect(con.projectId).toBe(sup.projectId);
  const suffix = randomUUID().slice(0, 8);
  const permitTitle = `AC-S Permit Resume ${suffix}`;
  const stopTitle = `AC-S Stop Resume ${suffix}`;
  const pagePosts: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/api\/projects\/[^/]+\/(?:safety-stop-orders|safety-permits|actions)(?:\/|$)/.test(new URL(req.url()).pathname)) pagePosts.push(req.url());
  });

  // Read one live demo Action and one passed Inspection as current prerequisites.
  // The fixture does not create workflow records; the Action is remedied and
  // verified below, while the passed Inspection is referenced as verification.
  const initialWorkspace = await readWorkspace(request, con);
  const remedyItem = initialWorkspace.items.find((item) => item.machine === "action" && item.record.status === "in_progress");
  const passedInspection = initialWorkspace.items.find((item) => item.machine === "inspection"
    && item.record.resultStatus === "pass" && ["passed", "completed"].includes(item.record.status));
  expect(remedyItem, "the demo project should provide a current in-progress Action for real UI remedy/verification").toBeTruthy();
  expect(passedInspection, "the demo project should provide a current passed Inspection for Stop resume verification").toBeTruthy();
  const remedyTitle = remedyItem!.record.title || `Action ${remedyItem!.record.id}`;
  expectedVersions.set(remedyItem!.record.id, remedyItem!.record.version);

  // Create and activate a Permit through the Safety authoring and command UI.
  await chooseRole(page, "CON");
  const permitDraft = await createSafetyDraft(page, "permit", fixture, permitTitle);
  expect(permitDraft.status).toBe("draft");
  await selectRecord(page, permitTitle);
  const readiness = {
    methodStatementCurrent: true,
    riskAssessmentCurrent: true,
    personnelQualified: true,
    equipmentReady: true,
    controlMeasuresReady: true,
    emergencyReady: true,
    environmentalConditionsReady: true,
    noBlockingSafetyIssue: true,
  };
  const validFrom = new Date(Date.now() - 60_000).toISOString();
  const validTo = new Date(Date.now() + 86_400_000).toISOString();
  let permit = await runCommand(page, fixture.projectId, permitDraft, "safety-permits", "submit_permit", {
    permitNo: `PERMIT-${suffix}`,
    workType: "Equipment operation",
    riskLevel: "high",
    responsiblePartyId: con.actor.partyId,
    safetyResponsiblePartyId: sup.actor.partyId,
    methodStatementRef: fixture.methodStatementRef,
    riskAssessmentRef: fixture.riskAssessmentRef,
    emergencyPlanRef: fixture.emergencyPlanRef,
    personnelQualificationRefs: [],
    equipmentRefs: [],
    validFrom,
    validTo,
    readiness,
    blockedReasons: [],
  }, [fixture.evidenceId]);
  await chooseRole(page, "SUP");
  await selectTab(page, safetyTabs.permit);
  await selectRecord(page, permitTitle);
  permit = await runCommand(page, fixture.projectId, permit, "safety-permits", "receive_permit");
  permit = await runCommand(page, fixture.projectId, permit, "safety-permits", "accept_for_safety_review");
  permit = await runCommand(page, fixture.projectId, permit, "safety-permits", "request_prestart_verification", {
    safetyReviewComplete: true,
    readiness,
    reviewNotes: "Review the affected work permit after Stop lift as a separate decision.",
  });
  permit = await runCommand(page, fixture.projectId, permit, "safety-permits", "request_authorization", {
    prestartVerified: true,
    prestartVerificationRefs: [{ objectType: "Inspection", objectId: passedInspection!.record.id, version: passedInspection!.record.version }],
    readiness,
  }, [fixture.evidenceId]);
  permit = await runCommand(page, fixture.projectId, permit, "safety-permits", "authorize", { validFrom, validTo });
  permit = await runCommand(page, fixture.projectId, permit, "safety-permits", "activate", { readiness, blockedReasons: [] });
  expect(permit.status).toBe("active");
  expect(permit.data?.workAuthorized).toBe(true);

  // SUP authors a real Stop Order through the Safety draft form. Its server
  // creation suspends this exact active Permit and clears workAuthorized.
  const stop = await createSafetyDraft(page, "stop", fixture, stopTitle, permitTitle);
  expect(stop.subtype).toBe("SafetyStopOrder");
  expect(stop.status).toBe("issued");
  const suspendedWorkspace = await readWorkspace(request, sup);
  permit = suspendedWorkspace.items.find((item) => item.record.id === permit.id)!.record;
  expectedVersions.set(permit.id, permit.version);
  expect(permit.status).toBe("suspended");
  expect(permit.data?.workAuthorized).toBe(false);
  expect(permit.data?.stopOrderRefs).toContainEqual({ objectType: "WorkItem", objectId: stop.id, version: stop.version });

  // The assigned contractor acknowledges the Stop and links the current
  // corrective Action. The correction and supervisor verification are real
  // Action commands in the existing action workbench.
  await chooseRole(page, "CON");
  await selectTab(page, safetyTabs.stop);
  await selectRecord(page, stopTitle);
  let currentStop = await runCommand(page, fixture.projectId, stop, "safety-stop-orders", "acknowledge_stop");

  await page.goto("/#/actions");
  await selectRecord(page, remedyTitle);
  let remedied = await runCommand(page, fixture.projectId, remedyItem!.record, "actions", "submit", {
    correction: "Restored the missing edge protection and isolated the affected work area.",
    rootCause: "A temporary access change omitted the edge protection check.",
    preventiveAction: "Add an independent edge protection confirmation to pre-start checks.",
  }, [fixture.evidenceId]);
  await chooseRole(page, "SUP");
  await page.goto("/#/actions");
  await selectRecord(page, remedyTitle);
  remedied = await runCommand(page, fixture.projectId, remedied, "actions", "verify", {}, [fixture.evidenceId]);
  expect(remedied.status).toBe("verified");

  await chooseRole(page, "CON");
  await selectTab(page, safetyTabs.stop);
  await selectRecord(page, stopTitle);
  currentStop = await runCommand(page, fixture.projectId, currentStop, "safety-stop-orders", "start_correction", {
    correctiveActionRefs: [{ objectType: "Action", objectId: remedied.id, version: remedied.version }],
  });
  await chooseRole(page, "CON");
  await selectTab(page, safetyTabs.stop);
  await selectRecord(page, stopTitle);
  const resumeActions = await request.get(`${apiOrigin}/projects/${fixture.projectId}/safety-stop-orders/${currentStop.id}/available-actions`, { headers: auth(con) });
  expect(resumeActions.status(), await resumeActions.text()).toBe(200);
  const resumeActionState = await resumeActions.json() as Array<{ command: string; ready: boolean; blockedReason?: { code?: string } }>;
  expect(resumeActionState.find((action) => action.command === "request_resume"), JSON.stringify(resumeActionState)).toMatchObject({
    ready: false,
    requiresInput: true,
    blockedReason: { code: "EVIDENCE_REQUIRED" },
  });
  currentStop = await runCommand(page, fixture.projectId, currentStop, "safety-stop-orders", "request_resume", {}, [fixture.evidenceId]);
  await chooseRole(page, "SUP");
  await selectTab(page, safetyTabs.stop);
  await selectRecord(page, stopTitle);
  currentStop = await runCommand(page, fixture.projectId, currentStop, "safety-stop-orders", "start_resume_verification", {
    resumeVerificationRefs: [{ objectType: "Inspection", objectId: passedInspection!.record.id, version: passedInspection!.record.version }],
  });
  currentStop = await runCommand(page, fixture.projectId, currentStop, "safety-stop-orders", "lift_stop", {}, [fixture.evidenceId]);
  expect(currentStop.status).toBe("lifted");
  expect(currentStop.data?.liftedAt).toBeTruthy();
  expect(Object.values(currentStop.data?.resumeGate || {}).every((value) => value === true)).toBe(true);

  // Lift clears the linked Stop condition, but never resumes the Permit.
  const afterLift = await readWorkspace(request, sup);
  permit = afterLift.items.find((item) => item.record.id === permit.id)!.record;
  expect(permit.status).toBe("suspended");
  expect(permit.data?.workAuthorized).toBe(false);

  await chooseRole(page, "CON");
  await selectTab(page, safetyTabs.permit);
  await selectRecord(page, permitTitle);
  permit = await runCommand(page, fixture.projectId, permit, "safety-permits", "request_resume", {
    readiness,
    blockedReasons: [],
  }, [fixture.evidenceId]);
  expect(permit.status).toBe("resume_review");
  expect(permit.data?.workAuthorized).toBe(false);
  await chooseRole(page, "SUP");
  await selectTab(page, safetyTabs.permit);
  await selectRecord(page, permitTitle);
  permit = await runCommand(page, fixture.projectId, permit, "safety-permits", "approve_resume", {
    readiness,
    blockedReasons: [],
  }, [fixture.evidenceId]);
  expect(permit.status).toBe("active");
  expect(permit.data?.workAuthorized).toBe(true);

  const finalWorkspace = await readWorkspace(request, sup);
  const finalStop = finalWorkspace.items.find((item) => item.record.id === currentStop.id)!.record;
  const finalPermit = finalWorkspace.items.find((item) => item.record.id === permit.id)!.record;
  const finalAction = finalWorkspace.items.find((item) => item.record.id === remedied.id)!.record;
  expect(finalStop.status).toBe("lifted");
  expect(finalPermit.status).toBe("active");
  expect(finalPermit.data?.workAuthorized).toBe(true);
  expect(finalAction.status).toBe("verified");
  expect(pagePosts.some((url) => url.endsWith("/safety-stop-orders"))).toBe(true);
  expect(pagePosts.some((url) => url.includes(`/safety-stop-orders/${stop.id}/lift-stop`))).toBe(true);
  expect(pagePosts.some((url) => url.includes(`/safety-permits/${permit.id}/approve-resume`))).toBe(true);
  expect(pagePosts.some((url) => url.includes(`/actions/${remedied.id}/submit`))).toBe(true);
  expect(pagePosts.some((url) => url.includes(`/actions/${remedied.id}/verify`))).toBe(true);
});
