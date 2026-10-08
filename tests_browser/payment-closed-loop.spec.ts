import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { resolve, join, delimiter } from "node:path";
import { commands, fields } from "../apps/web/src/labels";

const paymentRoute = "/#/payment";
const expectedVersions = new Map<string, number>();
let fixtureToken = "";
let apiOrigin = "";
let fixtureProcess: ChildProcess | undefined;
let fixtureDatabase = "";
let fixtureStderr = "";

if (process.env.PAYMENT_TEST_CHROMIUM) {
  test.use({ launchOptions: { executablePath: process.env.PAYMENT_TEST_CHROMIUM, args: ["--no-sandbox"] } });
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
  fixtureDatabase = join(process.cwd(), "work", `payment-browser-${randomUUID()}.sqlite3`);
  mkdirSync(join(process.cwd(), "work"), { recursive: true });
  const python = process.env.PAYMENT_TEST_PYTHON || process.env.DOUL_TEST_PYTHON || resolve(process.cwd(), ".venv/bin/python");
  const script = resolve(process.cwd(), "tests_browser/support/payment_api_fixture.py");
  fixtureProcess = spawn(python, [script, "--database", fixtureDatabase, "--port", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PAYMENT_TEST_FIXTURE_TOKEN: fixtureToken,
      PYTHONPATH: [process.cwd(), process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  fixtureProcess.stderr?.on("data", (chunk: Buffer) => { fixtureStderr += chunk.toString(); });
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (fixtureProcess.exitCode !== null) throw new Error(`Payment fixture exited early (${fixtureProcess.exitCode}): ${fixtureStderr}`);
    try {
      const response = await fetch(`${apiOrigin}/health`);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  fixtureProcess.kill("SIGTERM");
  throw new Error(`Payment API fixture did not become healthy: ${String(lastError)}`);
}, 45_000);

test.afterAll(async () => {
  if (fixtureProcess && fixtureProcess.exitCode === null) {
    const child = fixtureProcess;
    child.kill("SIGTERM");
    await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  }
  fixtureProcess = undefined;
  if (fixtureDatabase) {
    for (const path of [fixtureDatabase, `${fixtureDatabase}-wal`, `${fixtureDatabase}-shm`]) rmSync(path, { force: true });
  }
});

test.beforeEach(async ({ page }) => {
  // Keep the normal app page and controls, but bridge its /api requests to this
  // test's isolated live Uvicorn app. route.fetch forwards real HTTP; it does
  // not synthesize API records or command responses.
  await page.route("**/api/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname.replace(/^\/api/, "");
    const response = await route.fetch({ url: `${apiOrigin}${path}${requestUrl.search}` });
    await route.fulfill({ response });
  });
});

type Session = { projectId: string; accessToken: string; actor: { roleAssignmentId: string; actorGroup: string } };
type Ref = { objectType: string; objectId: string; version: number };
type Fixture = {
  projectId: string;
  scope: Record<string, string>;
  requirementRef: Ref;
  paymentRuleRef: Ref;
  evidenceId: string;
  evidenceRef: Ref;
  acceptedInspectionRef: Ref;
  drawingRef: Ref;
};

async function login(request: APIRequestContext, actorGroup: string): Promise<Session> {
  const response = await request.post(`${apiOrigin}/dev/sessions`, { data: { actorGroup } });
  expect(response.status()).toBe(200);
  return response.json();
}

async function fixture(request: APIRequestContext): Promise<Fixture> {
  const response = await request.get(`${apiOrigin}/test-fixtures/payment-metadata`, {
    headers: { "X-Test-Fixture-Token": fixtureToken },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function ownerDecision(request: APIRequestContext, machine: "contract_boq" | "payment_claim", objectId: string) {
  const response = await request.post(`${apiOrigin}/test-fixtures/payment-owner-decision`, {
    headers: { "X-Test-Fixture-Token": fixtureToken },
    data: { machine, objectId, title: `UI acceptance ${machine} decision`, reason: "Trusted exact-version fixture decision" },
  });
  expect(response.status()).toBe(200);
  return await response.json() as { ref: Ref; targetVersion: number };
}

function auth(session: Session) {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    "X-Role-Assignment-Id": session.actor.roleAssignmentId,
  };
}

async function chooseRole(page: Page, group: string) {
  const picker = page.getByRole("combobox", { name: "개발 역할 선택" });
  if (await picker.count()) {
    if ((await picker.inputValue()) !== group) {
      const refreshed = page.waitForResponse((r) => r.url().endsWith("/workspace") && r.ok());
      await picker.selectOption(group);
      await refreshed;
    }
  }
  await page.goto(paymentRoute);
  await expect(page.locator('[data-ui-component="measurement-payment-workspace"]')).toBeVisible();
}

async function selectTab(page: Page, name: "계약 BOQ" | "물량 측정" | "기성 신청") {
  await page.getByRole("tab", { name, exact: true }).click();
}

async function createDraft(page: Page, kindLabel: string, title: string, number: string, currency?: string) {
  const createdPromise = page.waitForResponse((r) =>
    r.request().method() === "POST" &&
    ["/contract-boqs", "/quantity-measurements", "/payment-claims"].some((suffix) => r.url().endsWith(suffix)),
  );
  await page.getByRole("button", { name: "기록 추가", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `${kindLabel} 기록 추가`, exact: true });
  await dialog.getByLabel("제목 *").fill(title);
  await dialog.getByLabel("번호 *").fill(number);
  if (currency) await dialog.getByLabel("통화").fill(currency);
  await dialog.locator(".modal-actions button.primary").click();
  const response = await createdPromise;
  expect(response.status(), await response.text()).toBe(201);
  const record = (await response.json()).record;
  expectedVersions.set(record.id, record.version);
  await expect(page.locator(".detail-head h2")).toHaveText(title);
  return record;
}

function commandLabel(command: string) {
  return (commands as Record<string, string>)[command] || command.replaceAll("_", " ");
}

function fieldLabel(field: string) {
  return (fields as Record<string, string>)[field] || field;
}

async function setField(dialog: Locator, field: string, value: unknown) {
  const name = fieldLabel(field);
  const locator = dialog.getByLabel(name, { exact: true })
    .or(dialog.getByRole("textbox", { name, exact: true }))
    .or(dialog.getByRole("combobox", { name, exact: true }))
    .or(dialog.getByRole("listbox", { name, exact: true }))
    .or(dialog.getByRole("spinbutton", { name, exact: true }));
  if (await locator.count()) {
    const tag = await locator.evaluate((element) => element.tagName.toLowerCase());
    if (tag === "select") {
      const isMultiple = await locator.evaluate((element) => (element as HTMLSelectElement).multiple);
      if (isMultiple) {
        const options = Array.isArray(value) ? value.map((entry) => JSON.stringify(entry)) : [JSON.stringify(value)];
        await locator.selectOption(options);
      } else {
        await locator.selectOption(typeof value === "string" ? value : JSON.stringify(value));
      }
    } else {
      await locator.fill(typeof value === "string" ? value : JSON.stringify(value));
    }
    return;
  }
  throw new Error(`UI command form did not expose field ${field} (${fieldLabel(field)})`);
}

async function runCommand(
  page: Page,
  command: string,
  payload: Record<string, unknown> = {},
  evidenceIds: string[] = [],
  configureDialog?: (dialog: Locator) => Promise<void>,
) {
  await page.getByRole("button", { name: commandLabel(command), exact: true }).click();
  const dialog = page.getByRole("dialog", { name: commandLabel(command), exact: true });
  for (const [field, value] of Object.entries(payload)) await setField(dialog, field, value);
  if (configureDialog) await configureDialog(dialog);
  if (evidenceIds.length) {
    const textareas = dialog.locator("textarea");
    await textareas.last().fill(evidenceIds.join(" "));
  }
  const commandUrl = `/${command.replaceAll("_", "-")}`;
  const result = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(commandUrl), { timeout: 15_000 });
  await dialog.locator(".modal-actions button.primary").click();
  const response = await result.catch(async (error) => {
    const alerts = await dialog.locator('[role="alert"]').allTextContents();
    throw new Error(`${command} did not reach API; alerts=${JSON.stringify(alerts)}; ${String(error)}`);
  });
  expect(response.status(), `${command}: ${await response.text()}`).toBe(200);
  const commandRequest = response.request();
  const path = new URL(commandRequest.url()).pathname;
  const recordId = path.split("/").at(-2)!;
  expect(path.endsWith(commandUrl)).toBe(true);
  expect(commandRequest.headers()["idempotency-key"]).toBeTruthy();
  const expectedVersion = expectedVersions.get(recordId);
  expect(expectedVersion, `tracked current version missing for ${recordId}`).toBeDefined();
  expect(commandRequest.postDataJSON().expectedVersion).toBe(expectedVersion);
  const body = await response.json();
  const record = body.record;
  expect(record.id).toBe(recordId);
  expectedVersions.set(record.id, record.version);
  await expect(page.locator(".detail-head")).toContainText(`v${record.version}`);
  return record;
}

async function selectRecord(page: Page, title: string) {
  const row = page.locator(".payment-record-row").filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator(".detail-head h2")).toHaveText(title);
}

async function getWorkspace(request: APIRequestContext, session: Session) {
  const response = await request.get(`${apiOrigin}/projects/${session.projectId}/workspace`, { headers: auth(session) });
  expect(response.status()).toBe(200);
  return response.json();
}

// Owner Decisions are trusted exact-version fixtures here; this case covers
// payment workflow use of those decisions, not Owner Decision authoring.
test("real UI/API payment chain preserves server quantities, exact Owner decisions and append-only partial-payment corrections", async ({ page, request }) => {
  expectedVersions.clear();
  const seeded = await fixture(request);
  const suffix = randomUUID().slice(0, 8);
  const boqTitle = `Browser BOQ ${suffix}`;
  const measurementTitle = `Browser measurement ${suffix}`;
  const claimTitle = `Browser claim ${suffix}`;

  // This session is used only for the final authenticated read snapshot. All
  // state-changing workflow operations are initiated from the page UI.
  const adm = await login(request, "ADM");

  await chooseRole(page, "SUP");
  await selectTab(page, "계약 BOQ");
  const boqDraft = await createDraft(page, "계약 BOQ", boqTitle, `BOQ-${suffix}`);
  const boqRef = (record: any): Ref => ({ objectType: "InformationItem", objectId: record.id, version: record.version });
  let boqItemId = "";
  let boq = await runCommand(page, "submit_boq", {
    currency: "VND",
    contractRef: seeded.requirementRef,
    effectiveFrom: "2026-01-01T00:00:00Z",
    sourceFileRefs: [seeded.evidenceRef],
    provisionalSumRules: [],
    measurementRulesRef: seeded.requirementRef,
    roundingRule: "contract-currency-rule-v1",
    revisionBasisRefs: [],
  }, [seeded.evidenceId], async (dialog) => {
    await dialog.getByRole("button", { name: "항목 추가", exact: true }).click();
    const line = dialog.locator("fieldset[data-boq-item-id]").first();
    boqItemId = (await line.getAttribute("data-boq-item-id")) || "";
    expect(boqItemId).toBeTruthy();
    await line.getByLabel("항목 번호", { exact: true }).fill("A.01");
    await line.getByLabel("단위", { exact: true }).fill("m3");
    await line.getByLabel("설명", { exact: true }).fill("Concrete work");
    await line.getByLabel("계약 수량", { exact: true }).fill("100");
    await line.getByLabel("단가", { exact: true }).fill("20");
    await line.getByLabel("계약 금액", { exact: true }).fill("2000");
    await line.getByLabel("기성 측정 규칙 참조", { exact: true }).selectOption(JSON.stringify(seeded.requirementRef));
    await line.getByLabel("변경 대상 가능", { exact: true }).check();
  });
  expect(boq.id).toBe(boqDraft.id);
  boq = await runCommand(page, "start_boq_review");
  boq = await runCommand(page, "request_boq_decision");
  const boqDecision = await ownerDecision(request, "contract_boq", boq.id);
  expect(boqDecision.targetVersion).toBe(boq.version);
  await chooseRole(page, "OWN");
  await selectTab(page, "계약 BOQ");
  await selectRecord(page, boqTitle);
  boq = await runCommand(page, "approve_boq", { ownerDecisionRef: boqDecision.ref }, [seeded.evidenceId]);
  await chooseRole(page, "SUP");
  await selectTab(page, "계약 BOQ");
  await selectRecord(page, boqTitle);
  boq = await runCommand(page, "activate_boq");
  expect(boq.status).toBe("effective");
  expect(boq.boq.lineItems[0].boqItemId).toBe(boqItemId);
  expect(boq.boq.lineItems[0].contractQuantity).toBe("100");

  await chooseRole(page, "CON");
  await selectTab(page, "물량 측정");
  const measurementDraft = await createDraft(page, "물량 측정", measurementTitle, `QM-${suffix}`);
  let measurement = await runCommand(page, "submit_measurement", {
    periodStart: "2026-09-01T00:00:00Z",
    periodEnd: "2026-09-30T23:59:59Z",
    measuredAt: "2026-10-04T12:00:00Z",
    boqRef: boqRef(boq),
    boqItemRef: { boqRef: boqRef(boq), boqItemId },
    claimedQuantity: "80.125",
    unit: "m3",
    measurementMethod: "joint field measurement",
    drawingRefs: [seeded.drawingRef],
    inspectionRefs: [seeded.acceptedInspectionRef],
    testRefs: [], materialLotRefs: [], changeRefs: [], variationRefs: [],
    previousCertifiedQuantity: "0",
  }, [seeded.evidenceId]);
  expect(measurement.id).toBe(measurementDraft.id);
  await chooseRole(page, "SUP");
  await selectTab(page, "물량 측정");
  await selectRecord(page, measurementTitle);
  measurement = await runCommand(page, "receive_measurement");
  measurement = await runCommand(page, "start_field_verification");
  measurement = await runCommand(page, "start_technical_verification", {}, [seeded.evidenceId]);
  measurement = await runCommand(page, "verify_quantity", { verifiedQuantity: "70.125" }, [seeded.evidenceId]);
  expect(measurement.data.claimedQuantity).toBe("80.125");
  expect(measurement.data.verifiedQuantity).toBe("70.125");
  expect(measurement.data.paymentEligible).toBe(true);

  await chooseRole(page, "CON");
  await selectTab(page, "기성 신청");
  const claimDraft = await createDraft(page, "기성 신청", claimTitle, `IPC-${suffix}`, "VND");
  let claim = await runCommand(page, "submit_payment_claim", {
    periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-09-30T23:59:59Z",
    contractRef: seeded.requirementRef, boqRef: boqRef(boq), currency: "VND",
    quantityMeasurementRefs: [{ objectType: "WorkItem", objectId: measurement.id, version: measurement.version }],
    claimedGrossAmount: "1000.00", variationComponents: [], previousCertifiedAmount: "0", previousPaidAmount: "0",
  }, [seeded.evidenceId]);
  expect(claim.id).toBe(claimDraft.id);

  await chooseRole(page, "SUP");
  await selectTab(page, "기성 신청");
  await selectRecord(page, claimTitle);
  claim = await runCommand(page, "receive_payment_claim");
  claim = await runCommand(page, "start_quantity_review");
  claim = await runCommand(page, "start_valuation_review", { verifiedGrossAmount: "900", disputedAmount: "100" }, [seeded.evidenceId]);
  claim = await runCommand(page, "prepare_recommendation", {
    eligibleVariationAmount: "0", eligibleMaterialOnSiteAmount: "0", retentionAmount: "50",
    advanceRecoveryAmount: "0", otherDeductionAmount: "0", taxAmount: "0", recommendedNetAmount: "850",
    deductionComponents: [{ type: "retention", basis: "contract payment rule", amount: "50", currency: "VND", contractClauseRef: seeded.requirementRef }],
    calculationRuleRef: seeded.paymentRuleRef, reservationComment: "Verified eligible work only",
  });
  claim = await runCommand(page, "recommend_payment", {}, [seeded.evidenceId]);
  expect(claim.data.recommendedNetAmount).toBe("850");
  expect(claim.data.recommendationSnapshot.calculationTrace.formulaId).toBe("verified-eligible-net-v1");
  expect(claim.data.recommendationSnapshot.claimBasisRef.version).toBe(claim.version - 1);
  claim = await runCommand(page, "submit_owner_review");
  const claimDecision = await ownerDecision(request, "payment_claim", claim.id);
  expect(claimDecision.targetVersion).toBe(claim.version);

  await chooseRole(page, "OWN");
  await selectTab(page, "기성 신청");
  await selectRecord(page, claimTitle);
  claim = await runCommand(page, "adjust_payment", {
    ownerApprovedAmount: "800", adjustmentReason: "Owner commercial adjustment", decisionRefs: [claimDecision.ref],
  }, [seeded.evidenceId]);
  expect(claim.data.ownerApprovedAmount).toBe("800");
  expect(claim.data.recommendedNetAmount).toBe("850");

  await chooseRole(page, "ADM");
  await selectTab(page, "기성 신청");
  await selectRecord(page, claimTitle);
  const beforePay = claim.version;
  claim = await runCommand(page, "record_payment", {
    paymentAmount: "500", paidAt: "2026-10-04T12:00:00Z", paymentReference: `BANK-${suffix}`,
    externalSystemRef: `ERP-${suffix}`,
  }, [seeded.evidenceId]);
  expect(claim.version).toBeGreaterThan(beforePay);
  const originalRecords = structuredClone(claim.data.paymentRecords);
  expect(originalRecords).toHaveLength(1);
  expect(originalRecords[0].amount).toBe("500");
  expect(claim.data.paidAmount).toBe("500");
  expect(claim.data.unpaidBalance).toBe("300");

  claim = await runCommand(page, "correct_payment_record", {
    supersedesPaymentRecordId: originalRecords[0].recordId,
    paymentAmount: "450", paidAt: "2026-10-04T12:00:00Z",
    paymentReference: `BANK-CORR-${suffix}`,
    externalSystemRef: `ERP-CORR-${suffix}`,
    correctionReason: "Bank advice corrected the first transfer",
  }, [seeded.evidenceId]);
  expect(claim.data.paymentRecords).toHaveLength(2);
  expect(claim.data.paymentRecords[0]).toEqual(originalRecords[0]);
  expect(claim.data.paymentRecords[1].kind).toBe("correction");
  expect(claim.data.paymentRecords[1].supersedesPaymentRecordId).toBe(originalRecords[0].recordId);
  expect(claim.data.paymentRecords[1].amount).toBe("450");
  expect(claim.data.paidAmount).toBe("450");
  expect(claim.data.unpaidBalance).toBe("350");

  // Read-only API snapshots confirm the UI's displayed server values and the
  // original payment row remain unchanged after the append-only correction.
  const currentWorkspace = await getWorkspace(request, adm);
  const persisted = currentWorkspace.items.find((item: any) => item.record.id === claim.id);
  expect(persisted.record.version).toBe(claim.version);
  expect(persisted.record.data.ownerApprovedAmount).toBe("800");
  expect(persisted.record.data.paymentRecords).toEqual(claim.data.paymentRecords);
  await expect(page.locator(".payment-history li")).toHaveCount(2);
  await expect(page.locator(".payment-history")).toContainText(`BANK-${suffix}`);
  await expect(page.locator(".payment-history")).toContainText(`BANK-CORR-${suffix}`);
  await expect(page.locator(".payment-summary")).toContainText("450");

  // Authority boundary: an Owner view must not offer the administrator's
  // actual payment-recording command on this same persisted record.
  await chooseRole(page, "OWN");
  await selectTab(page, "기성 신청");
  await selectRecord(page, claimTitle);
  await expect(page.getByRole("button", { name: commandLabel("record_payment"), exact: true })).toHaveCount(0);
});
