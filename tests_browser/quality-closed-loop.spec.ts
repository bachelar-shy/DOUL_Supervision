import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

let apiPort = Number(process.env.DOUL_QUALITY_FIXTURE_PORT ?? 0);
let apiOrigin = "";
let apiProcess: ChildProcess | undefined;
let fixtureDir: string | undefined;
test.use({ launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium" } });

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a loopback port");
  const port = address.port;
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return port;
}

test.beforeAll(async () => {
  if (!apiPort) apiPort = await availablePort();
  apiOrigin = `http://127.0.0.1:${apiPort}`;
  fixtureDir = mkdtempSync(join(tmpdir(), "doul-quality-ui-"));
  const python = process.env.DOUL_QUALITY_PYTHON ?? process.env.PYTHON ?? "python3";
  apiProcess = spawn(python, [
    "-m", "tests_browser.support.quality_api_fixture",
    "--host", "127.0.0.1", "--port", String(apiPort),
    "--database", join(fixtureDir, "quality.sqlite3"),
  ], { cwd: process.cwd(), stdio: "ignore" });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) throw new Error(`Quality fixture API exited: ${apiProcess.exitCode}`);
    try {
      const response = await fetch(`${apiOrigin}/health`);
      if (response.ok) return;
    } catch { /* Wait for the isolated ASGI fixture to bind its port. */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error("Quality fixture API did not become ready");
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

type Session = {
  projectId: string;
  accessToken: string;
  actor: { partyId: string; roleAssignmentId: string; actorGroup: string };
};

function headers(session: Session, idempotent = false) {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    "X-Role-Assignment-Id": session.actor.roleAssignmentId,
    ...(idempotent ? { "Idempotency-Key": randomUUID() } : {}),
  };
}

async function api<T>(request: APIRequestContext, session: Session, path: string, body?: unknown, expected = 200): Promise<T> {
  const response = body === undefined
    ? await request.get(`${apiOrigin}/projects/${session.projectId}${path}`, { headers: headers(session) })
    : await request.post(`${apiOrigin}/projects/${session.projectId}${path}`, {
      headers: headers(session, true), data: body,
    });
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

async function routeBrowserApiToFixture(page: Page) {
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

function onePagePdf(): Buffer {
  const text = "BT /F1 24 Tf 72 720 Td (Synthetic quality issue drawing) Tj ET";
  const stream = `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    stream,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function selectRole(page: Page, role: string) {
  const picker = page.getByLabel("개발 역할 선택");
  await picker.selectOption(role);
  await expect(picker).toHaveValue(role);
  await page.goto("/#/inspections");
  await expect(page.getByRole("button", { name: "새로고침", exact: true })).toBeEnabled({ timeout: 30_000 });
}

async function runCommand(
  page: Page,
  label: string,
  fieldValues: Record<string, string>,
  evidenceIds: string[],
  options: { source?: Locator; expectedStatus?: number } = {},
) {
  const source = options.source ?? page.locator('[data-ui-component="action-gate"]');
  const action = source.getByRole("button", { name: new RegExp(`^${escapeRegExp(label)}(?: (?:열기|입력 필요))?$`) });
  await expect(action, `server should expose ${label} at the current record version`).toBeEnabled();
  await action.click();
  const dialog = page.getByRole("dialog");
  for (const [labelText, value] of Object.entries(fieldValues)) {
    const field = dialog.locator("label").filter({ hasText: labelText }).locator("textarea, input, select").first();
    await expect(field, `command field ${labelText} should be supplied by the server`).toBeVisible();
    if (await field.evaluate((node) => node.tagName.toLowerCase()) === "select") {
      await field.selectOption(value);
    } else {
      await field.fill(value);
    }
  }
  if (evidenceIds.length) {
    const evidence = dialog.getByLabel("명령 증빙 ID");
    await expect(evidence).toBeVisible();
    await evidence.fill(evidenceIds.join("\n"));
  }
  const post = page.waitForResponse((response) => response.url().includes("/api/projects/")
    && response.request().method() === "POST"
    && /\/(inspections|observations|issues|actions|owner-reports)\/[^/]+\//.test(new URL(response.url()).pathname));
  await dialog.getByRole("button", { name: "확인 후 실행", exact: true }).click();
  const response = await post;
  expect(response.status(), await response.text()).toBe(options.expectedStatus ?? 200);
  if ((options.expectedStatus ?? 200) === 200) await expect(dialog).toHaveCount(0);
  else await expect(dialog).toBeVisible();
  return response;
}

test("connected Quality UI completes linked reinspection, issue, and Owner report workflows", async ({ page, request }) => {
  await routeBrowserApiToFixture(page);
  const con = await login(request, "CON");
  const sup = await login(request, "SUP");
  const adm = await login(request, "ADM");
  expect(sup.projectId).toBe(con.projectId);
  const workspace = await api<{
    context: { scope: Record<string, string>; evidenceId: string; requirementRef: { objectType: string; objectId: string; version: number }; drawingRef: { objectType: string; objectId: string; version: number } };
    participants: Array<{ partyId: string; actorGroup: string }>;
    items: Array<{ machine: string; record: Record<string, unknown> }>;
  }>(request, con, "/workspace");
  const evidenceId = workspace.context.evidenceId;
  const supervisorWorkspace = await api<{ items: Array<{ machine: string; record: Record<string, unknown> }> }>(request, sup, "/workspace");
  const seededCandidate = supervisorWorkspace.items.find((item) => item.machine === "observation" && item.record.status === "candidate");
  expect(seededCandidate, "demo source observation is only an input; the Supervisor still confirms it in the UI").toBeTruthy();
  const suffix = randomUUID().slice(0, 8);
  const workName = `Browser quality inspection ${suffix}`;

  await page.goto("/#/inspections");
  await selectRole(page, "CON");
  const form = page.getByRole("form", { name: "자체검측 작성" });
  const drawing = form.getByLabel("검측 기준 도면");
  await expect(drawing.locator("option").nth(1)).toBeAttached();
  await drawing.selectOption({ index: 1 });
  const location = form.getByLabel("검측 위치");
  await expect(location.locator("option").nth(1)).toBeAttached();
  await location.selectOption({ index: 1 });
  await form.getByRole("group", { name: "검측 기준", exact: true }).getByRole("checkbox").first().check();
  await form.getByRole("group", { name: "현장 증빙", exact: true }).getByRole("checkbox").first().check();
  await form.getByLabel("공종·작업명").fill(workName);
  await form.getByLabel("자체검측 완료", { exact: true }).check();
  for (const label of ["도면 확인", "자재 확인", "시험 확인", "선행 공정 확인", "변경사항 확인"]) await form.getByLabel(label, { exact: true }).check();
  const createDraft = page.waitForResponse((response) => response.url().endsWith("/inspection-authoring/drafts") && response.request().method() === "POST");
  await form.getByRole("button", { name: "자체검측 초안 저장", exact: true }).click();
  const draftResponse = await createDraft;
  expect(draftResponse.status(), await draftResponse.text()).toBe(201);
  const draft = (await draftResponse.json()).record as { id: string; version: number; status: string };
  expect(draft.status).toBe("draft");
  await expect(page.getByRole("heading", { name: workName, exact: true })).toBeVisible();

  const requestedAt = new Date().toISOString();
  const requestedInspectionAt = new Date(Date.now() + 3_600_000).toISOString();
  // Keep this explicit: the connected dialog must serialize this value as a boolean.
  await runCommand(page, "검측 요청", {
    "요청 시각": requestedAt,
    "희망 검측시각": requestedInspectionAt,
    selfInspectionComplete: "true",
  }, [evidenceId]);

  await selectRole(page, "SUP");
  // The Authoring page refreshes the same real Inspection row after role change.
  const inspectionRow = page.getByRole("button", { name: new RegExp(workName) });
  await expect(inspectionRow).toBeVisible();
  await inspectionRow.click();
  await runCommand(page, "접수", { "접수 시각": new Date().toISOString() }, []);
  await runCommand(page, "일정 배정", { "검측 예정시각": new Date(Date.now() + 3_600_000).toISOString() }, []);
  await runCommand(page, "시작", {}, []);
  const failedResults = JSON.stringify([{
    itemId: "dimension", requirementRef: workspace.context.requirementRef,
    result: "fail", evidenceIds: [evidenceId], measuredValue: 90, unit: "mm",
  }]);
  await runCommand(page, "결과 제출", { "검측 항목·측정 결과": failedResults }, [evidenceId]);
  await runCommand(page, "부적합 판정", { "부적합 사유": "Browser acceptance fixture measured outside tolerance." }, [evidenceId]);

  const currentInspection = await api<{ id: string; version: number; status: string; resultStatus: string }>(request, sup,
    `/inspections/${draft.id}`);
  expect(currentInspection.status).toBe("failed");
  expect(currentInspection.resultStatus).toBe("fail");

  // The demo candidate is source input only. Review and confirmation are real UI commands.
  await page.goto("/#/observations");
  const observationRow = page.getByRole("button", { name: new RegExp(String(seededCandidate!.record.id).slice(0, 6)) });
  await expect(observationRow).toBeVisible();
  await observationRow.click();
  await runCommand(page, "관찰 검토", {}, []);
  await runCommand(page, "관찰 확인", { "현장 확인 근거": "Supervisor checked the source observation in the connected UI." }, [evidenceId]);

  // Create an exact Drawing/PDF reference and a saved markup through their connected UI.
  await page.goto("/#/parallel-test");
  await selectRole(page, "ADM");
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
  const viewer = page.getByLabel("PDF 도면 뷰어");
  const uploaded = page.waitForResponse((response) => response.url().includes("/uploads/")
    && response.url().endsWith("/complete") && response.request().method() === "POST");
  await viewer.getByTestId("pdf-upload").setInputFiles({ name: `quality-${suffix}.pdf`, mimeType: "application/pdf", buffer: onePagePdf() });
  const uploadedResponse = await uploaded;
  expect(uploadedResponse.status()).toBe(201);
  const pdfEvidence = await uploadedResponse.json() as { id: string; version: number };
  const reinspectionUpload = page.waitForResponse((response) => response.url().includes("/uploads/")
    && response.url().endsWith("/complete") && response.request().method() === "POST");
  await viewer.getByTestId("pdf-upload").setInputFiles({ name: `quality-reinspection-${suffix}.pdf`, mimeType: "application/pdf", buffer: onePagePdf() });
  const reinspectionUploadResponse = await reinspectionUpload;
  expect(reinspectionUploadResponse.status()).toBe(201);
  const reinspectionOnlyEvidence = await reinspectionUploadResponse.json() as { id: string; version: number };
  const bindingPanel = page.getByRole("region", { name: "도면 PDF 연결" });
  await bindingPanel.getByLabel("도면 버전").selectOption(`${workspace.context.drawingRef.objectType}:${workspace.context.drawingRef.objectId}:${workspace.context.drawingRef.version}`);
  await bindingPanel.getByLabel("PDF 원본").selectOption(`Evidence:${pdfEvidence.id}:${pdfEvidence.version}`);
  const bindingResponse = page.waitForResponse((response) => response.url().endsWith("/parallel/drawing-pdf-bindings") && response.request().method() === "POST");
  await bindingPanel.getByRole("button", { name: "선택한 버전 연결" }).click();
  expect((await bindingResponse).status()).toBe(201);
  await viewer.getByLabel("PDF 원본 선택").selectOption(pdfEvidence.id);
  await expect(viewer.locator("canvas")).toHaveAttribute("aria-label", /PDF 페이지 1 \/ /);
  await viewer.getByRole("button", { name: "사각형 메모 추가" }).click();
  const markupLayer = viewer.locator(".pdf-markup-layer");
  await expect(markupLayer).toHaveClass(/is-drawing/);
  await markupLayer.scrollIntoViewIfNeeded();
  const box = await markupLayer.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.5, { steps: 6 });
  await page.mouse.up();
  const markupText = `Observed nonconformance ${suffix}`;
  await viewer.getByLabel("주석 메모").fill(markupText);
  const markupResponsePromise = page.waitForResponse((response) => response.url().endsWith("/parallel/drawing-markups") && response.request().method() === "POST");
  await viewer.getByRole("button", { name: "주석 저장" }).click();
  const markupResponse = await markupResponsePromise;
  expect(markupResponse.status()).toBe(201);
  const markup = await markupResponse.json() as { id: string; version: number };

  await page.getByLabel("개발 역할 선택").selectOption("SUP");
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
  const supervisorViewer = page.getByLabel("PDF 도면 뷰어");
  await supervisorViewer.getByLabel("PDF 원본 선택").selectOption(pdfEvidence.id);
  const savedMarkup = supervisorViewer.getByRole("list", { name: "저장된 도면 주석" }).getByRole("button", { name: new RegExp(markupText) });
  await expect(savedMarkup).toBeVisible();
  await savedMarkup.click();
  const issuePanel = page.getByTestId("drawing-markup-issue");
  await issuePanel.getByLabel("실패 원 검측").selectOption(draft.id);
  await issuePanel.getByLabel("확인된 관찰").selectOption(String(seededCandidate!.record.id));
  await issuePanel.getByLabel("Issue 유형").selectOption("NCR");
  const issueTitle = `Browser quality issue ${suffix}`;
  const actionTitle = `Browser corrective action ${suffix}`;
  await issuePanel.getByLabel("Issue 제목").fill(issueTitle);
  await issuePanel.getByLabel("시정조치 제목").fill(actionTitle);
  await issuePanel.getByLabel("담당자").selectOption(con.actor.partyId);
  await issuePanel.getByLabel("기한").fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
  await issuePanel.getByRole("button", { name: "이슈 등록 검토" }).click();
  const issueDialog = page.getByRole("dialog", { name: "Issue 및 시정조치 등록 확인" });
  const issueCreatedPromise = page.waitForResponse((response) => response.url().includes(`/parallel/drawing-markups/${markup.id}/issues`)
    && response.request().method() === "POST");
  await issueDialog.getByRole("button", { name: "확인 후 Issue와 조치 등록" }).click();
  const issueCreated = await issueCreatedPromise;
  expect(issueCreated.status()).toBe(201);
  const pair = await issueCreated.json() as { issue: { id: string; inspectionIds: string[]; observationIds: string[] }; correctiveAction: { id: string } };
  expect(pair.issue.inspectionIds).toContain(draft.id);
  expect(pair.issue.observationIds).toContain(String(seededCandidate!.record.id));
  expect(pair.correctiveAction.id).toBeTruthy();

  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "작업함", exact: true }).click();
  const casePanel = page.getByTestId("inspection-case-flow");
  await casePanel.getByLabel("원 검측 선택", { exact: true }).selectOption(draft.id);
  let issueCard = casePanel.locator(".inspection-case-issue").filter({ hasText: issueTitle });
  await expect(issueCard).toBeVisible();
  const issueRow = issueCard.locator(".inspection-case-record").filter({ hasText: issueTitle });

  // Action correction and verification use linked record controls and actual evidence.
  await selectRole(page, "CON");
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "작업함", exact: true }).click();
  await casePanel.getByLabel("원 검측 선택", { exact: true }).selectOption(draft.id);
  issueCard = casePanel.locator(".inspection-case-issue").filter({ hasText: issueTitle });
  const contractorIssueRow = issueCard.locator(".inspection-case-record").filter({ hasText: issueTitle });
  await runCommand(page, "시정 시작", {}, [], { source: contractorIssueRow });
  const actionRow = issueCard.locator(".inspection-case-record").filter({ hasText: actionTitle });
  await runCommand(page, "시작", {}, [], { source: actionRow });
  await runCommand(page, "시정자료 제출", {
    "시정조치 내용": "Corrected the measured installation to the approved drawing dimension.",
    "원인": "The original setting was not checked against the approved drawing.",
    "재발방지 대책": "Add an independent measurement check before the next pour.",
  }, [pdfEvidence.id], { source: actionRow });

  await selectRole(page, "SUP");
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "작업함", exact: true }).click();
  await casePanel.getByLabel("원 검측 선택", { exact: true }).selectOption(draft.id);
  issueCard = casePanel.locator(".inspection-case-issue").filter({ hasText: issueTitle });
  const supervisorActionRow = issueCard.locator(".inspection-case-record").filter({ hasText: actionTitle });
  await runCommand(page, "조치 검증", {}, [pdfEvidence.id], { source: supervisorActionRow });
  const verifiedAction = await api<{ id: string; version: number; status: string }>(request, sup, `/actions/${pair.correctiveAction.id}`);
  expect(verifiedAction.status).toBe("verified");

  // Request the exact linked reinspection using the case authoring form.
  await selectRole(page, "CON");
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "작업함", exact: true }).click();
  await casePanel.getByLabel("원 검측 선택", { exact: true }).selectOption(draft.id);
  issueCard = casePanel.locator(".inspection-case-issue").filter({ hasText: issueTitle });
  const reinspectionForm = issueCard.getByRole("form", { name: "연결된 재검측 요청" });
  const reinspectionWorkName = `Browser reinspection ${suffix}`;
  await reinspectionForm.getByLabel("작업명").fill(reinspectionWorkName);
  await reinspectionForm.getByLabel("재검측 요청 일시").fill(new Date(Date.now() + 3_600_000).toISOString().slice(0, 16));
  await reinspectionForm.getByLabel("시공자 자체검측 완료").check();
  for (const label of ["도면 확인", "자재 확인", "시험 확인", "선행 작업 확인", "변경사항 확인"]) {
    await reinspectionForm.getByLabel(label, { exact: true }).check();
  }
  await reinspectionForm.getByLabel(new RegExp(pdfEvidence.id)).check();
  await reinspectionForm.getByLabel(new RegExp(reinspectionOnlyEvidence.id)).check();
  const reinspectionResponsePromise = page.waitForResponse((response) => response.url().includes(`/inspection-cases/${draft.id}/issues/${pair.issue.id}/reinspections`)
    && response.request().method() === "POST");
  await reinspectionForm.getByRole("button", { name: "재검측 요청 제출", exact: true }).click();
  const reinspectionResponse = await reinspectionResponsePromise;
  expect(reinspectionResponse.status(), await reinspectionResponse.text()).toBe(201);
  const reinspectionCreated = await reinspectionResponse.json() as { issue: { id: string }; reinspection: { id: string; version: number; workName: string; status: string } };
  expect(reinspectionCreated.issue.id).toBe(pair.issue.id);
  expect(reinspectionCreated.reinspection.workName).toBe(reinspectionWorkName);

  // Supervisor receives, schedules, performs, and passes this linked reinspection.
  await selectRole(page, "SUP");
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "작업함", exact: true }).click();
  await casePanel.getByLabel("원 검측 선택", { exact: true }).selectOption(draft.id);
  issueCard = casePanel.locator(".inspection-case-issue").filter({ hasText: issueTitle });
  const currentIssueRow = issueCard.locator(".inspection-case-record").filter({ hasText: issueTitle });
  await runCommand(page, "재검측 시작", {}, [], { source: currentIssueRow });
  const reinspectionRow = issueCard.locator(".inspection-case-record").filter({ hasText: reinspectionWorkName });
  await runCommand(page, "접수", { "접수 시각": new Date().toISOString() }, [], { source: reinspectionRow });
  await runCommand(page, "일정 배정", { "검측 예정시각": new Date(Date.now() + 3_600_000).toISOString() }, [], { source: reinspectionRow });
  await runCommand(page, "시작", {}, [], { source: reinspectionRow });
  const passedResults = JSON.stringify([{
    itemId: "dimension", requirementRef: workspace.context.requirementRef,
    result: "pass", evidenceIds: [pdfEvidence.id, reinspectionOnlyEvidence.id], measuredValue: 120, unit: "mm",
  }]);
  await runCommand(page, "결과 제출", { "검측 항목·측정 결과": passedResults }, [pdfEvidence.id, reinspectionOnlyEvidence.id], { source: reinspectionRow });
  await runCommand(page, "적합 판정", {}, [pdfEvidence.id, reinspectionOnlyEvidence.id], { source: reinspectionRow });
  const passedReinspection = await api<{ id: string; version: number; status: string; resultStatus: string; nextWorkAllowed: boolean; workName: string }>(request, sup,
    `/inspections/${reinspectionCreated.reinspection.id}`);
  expect(passedReinspection.status).toBe("passed");
  expect(passedReinspection.resultStatus).toBe("pass");
  expect(passedReinspection.nextWorkAllowed).toBe(false);

  // Generate the exact Vietnamese final FM-09 snapshot and sign it in the
  // connected Document page. The verifier is explicitly test-only.
  await page.goto("/#/documents");
  await page.getByLabel("문서 양식").selectOption("FM-09");
  await page.getByLabel("문서 원본 선택").selectOption(passedReinspection.id);
  await page.getByLabel("문서 출력 언어").selectOption("vi");
  await page.getByLabel("렌더링 종류").selectOption("final");
  const formValues: Record<string, string> = {
    "inspection.no": passedReinspection.id,
    "inspection.work_name": passedReinspection.workName,
    "work.discipline": workspace.context.scope.discipline,
    "work.location": workspace.context.scope.locationId,
    "inspection.datetime": new Date().toISOString().slice(0, 16),
    "inspection.place": workspace.context.scope.locationId,
    "basis.drawings": workspace.context.drawingRef.objectId,
    "basis.criteria": workspace.context.requirementRef.objectId,
    "basis.tests": "dimension",
    "result.status": "pass",
    "result.next_work_allowed": "false",
  };
  for (const [name, value] of Object.entries(formValues)) {
    const field = page.locator(`[name="${name}"]`);
    if (await field.evaluate((node) => node.tagName.toLowerCase()) === "select") await field.selectOption(value);
    else await field.fill(value);
  }
  const finalRenderResponsePromise = page.waitForResponse((response) => response.url().includes(`/forms/FM-09/render`)
    && response.request().method() === "POST");
  await page.getByRole("button", { name: "최종 HTML 스냅샷 생성", exact: true }).click();
  const finalRenderResponse = await finalRenderResponsePromise;
  expect(finalRenderResponse.status(), await finalRenderResponse.text()).toBe(200);
  const finalDocument = await finalRenderResponse.json() as { id: string; status: string; renderHash: string; sourceDomainRefs: Array<{ objectId: string; version: number }> };
  expect(finalDocument.status).toBe("final");
  expect(finalDocument.sourceDomainRefs[0]).toMatchObject({ objectId: passedReinspection.id, version: passedReinspection.version });
  const signingPanel = page.getByRole("region", { name: "법적 서명" });
  await signingPanel.getByLabel("현재 서명 역할").selectOption("owner_side_supervisor");
  await signingPanel.getByLabel("서명 방식").selectOption("approved_e_signature");
  const supervisorSignPromise = page.waitForResponse((response) => response.url().includes(`/documents/${finalDocument.id}/sign`)
    && response.request().method() === "POST");
  await signingPanel.getByRole("button", { name: "서명 검증 요청", exact: true }).click();
  expect((await supervisorSignPromise).status()).toBe(200);
  await selectRole(page, "CON");
  await page.goto("/#/documents");
  const contractorSigningPanel = page.getByRole("region", { name: "법적 서명" });
  await contractorSigningPanel.getByLabel("문서 선택").selectOption(finalDocument.id);
  await contractorSigningPanel.getByLabel("현재 서명 역할").selectOption("contractor_technical_lead");
  await contractorSigningPanel.getByLabel("서명 방식").selectOption("approved_e_signature");
  const contractorSignPromise = page.waitForResponse((response) => response.url().includes(`/documents/${finalDocument.id}/sign`)
    && response.request().method() === "POST");
  await contractorSigningPanel.getByRole("button", { name: "서명 검증 요청", exact: true }).click();
  expect((await contractorSignPromise).status()).toBe(200);
  const verifierReport = await request.get(`${apiOrigin}/_test/signature-verifications`);
  expect(verifierReport.status()).toBe(200);
  expect(await verifierReport.json()).toMatchObject({
    testOnly: true,
    verifier: "MockTrustedVerifier",
    calls: [
      { signerRole: "owner_side_supervisor", documentHash: finalDocument.renderHash, method: "approved_e_signature" },
      { signerRole: "contractor_technical_lead", documentHash: finalDocument.renderHash, method: "approved_e_signature" },
    ],
  });

  // Case graph links the reinspection but currently does not expose its
  // release_next_work descriptor. Use the existing Inspection workbench's
  // selected-record action gate for the same real UI command.
  await selectRole(page, "SUP");
  const releaseInspectionRow = page.getByRole("button", { name: new RegExp(escapeRegExp(reinspectionWorkName)) });
  await expect(releaseInspectionRow).toBeVisible();
  await releaseInspectionRow.click();
  await runCommand(page, "후속공정 허용", {}, [pdfEvidence.id]);
  const releasedReinspection = await api<{ id: string; version: number; status: string; nextWorkAllowed: boolean }>(request, sup,
    `/inspections/${passedReinspection.id}`);
  expect(releasedReinspection.status).toBe("completed");
  expect(releasedReinspection.nextWorkAllowed).toBe(true);

  const issueCurrent = await api<{ id: string; version: number; status: string; inspectionIds: string[] }>(request, sup, `/issues/${pair.issue.id}`);
  expect(issueCurrent.status).not.toBe("closed");
  expect(issueCurrent.inspectionIds).toContain(draft.id);
  const contractorClose = await request.post(`${apiOrigin}/projects/${con.projectId}/issues/${pair.issue.id}/close`, {
    headers: headers(con, true), data: {
      roleAssignmentId: con.actor.roleAssignmentId, expectedVersion: issueCurrent.version,
      payload: { closureEvidenceIds: [pdfEvidence.id] }, evidenceIds: [pdfEvidence.id],
    },
  });
  expect(contractorClose.status()).toBe(403);
  const staleClose = await request.post(`${apiOrigin}/projects/${sup.projectId}/issues/${pair.issue.id}/close`, {
    headers: headers(sup, true), data: {
      roleAssignmentId: sup.actor.roleAssignmentId, expectedVersion: issueCurrent.version - 1,
      payload: { closureEvidenceIds: [pdfEvidence.id] }, evidenceIds: [pdfEvidence.id],
    },
  });
  expect(staleClose.status()).toBe(409);
  expect((await staleClose.json()).code).toBe("VERSION_CONFLICT");

  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "작업함", exact: true }).click();
  await casePanel.getByLabel("원 검측 선택", { exact: true }).selectOption(draft.id);
  issueCard = casePanel.locator(".inspection-case-issue").filter({ hasText: issueTitle });
  const initialEvidenceRejection = await runCommand(page, "종결 검토", {
    closureEvidenceIds: JSON.stringify([evidenceId]),
  }, [evidenceId], {
    source: issueCard.locator(".inspection-case-record").filter({ hasText: issueTitle }),
    expectedStatus: 409,
  });
  expect((await initialEvidenceRejection.json()).code).toBe("CLOSURE_REINSPECTION_EVIDENCE_REQUIRED");
  await page.getByRole("dialog").getByRole("button", { name: "취소", exact: true }).click();
  const actionEvidenceRejection = await runCommand(page, "종결 검토", {
    closureEvidenceIds: JSON.stringify([reinspectionOnlyEvidence.id]),
  }, [reinspectionOnlyEvidence.id], {
    source: issueCard.locator(".inspection-case-record").filter({ hasText: issueTitle }),
    expectedStatus: 409,
  });
  expect((await actionEvidenceRejection.json()).code).toBe("CLOSURE_ACTION_EVIDENCE_REQUIRED");
  await page.getByRole("dialog").getByRole("button", { name: "취소", exact: true }).click();
  await runCommand(page, "종결 검토", {
    closureEvidenceIds: JSON.stringify([pdfEvidence.id]),
  }, [pdfEvidence.id], {
    source: issueCard.locator(".inspection-case-record").filter({ hasText: issueTitle }),
  });
  const closedIssue = await api<{ id: string; version: number; status: string; closureEvidenceIds: string[] }>(request, sup, `/issues/${pair.issue.id}`);
  expect(closedIssue.status).toBe("closed");
  expect(closedIssue.closureEvidenceIds).toContain(pdfEvidence.id);

  // Create and issue a distinct linked Owner Report. Issue closure alone must
  // leave the case reporting gate open until Owner receipt and SUP follow-up.
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "작업함", exact: true }).click();
  await casePanel.getByLabel("원 검측 선택", { exact: true }).selectOption(draft.id);
  issueCard = casePanel.locator(".inspection-case-issue").filter({ hasText: issueTitle });
  const reportForm = issueCard.getByRole("form", { name: "연결된 발주자 보고 초안 작성" });
  const reportTitle = `Browser closeout report ${suffix}`;
  await reportForm.getByLabel("보고서 제목").fill(reportTitle);
  await reportForm.getByLabel("개정").fill("1");
  await reportForm.getByLabel("보고 유형").selectOption("regular");
  await reportForm.getByLabel("우선순위").selectOption("P2");
  const ownerPartyId = workspace.participants.find((person) => person.actorGroup === "OWN")!.partyId;
  await reportForm.getByLabel(new RegExp(ownerPartyId)).check();
  await reportForm.getByLabel("사실관계").fill("A failed inspection was corrected and its current-cycle reinspection passed.");
  await reportForm.getByLabel("원인 (선택)").fill("The original measurement was not checked against the approved drawing.");
  await reportForm.getByLabel("영향").fill("The affected work remained on hold until retest and release.");
  await reportForm.getByLabel("즉시 조치 (선택)").fill("A second measurement check was added before proceeding.");
  await reportForm.getByLabel("권고사항").fill("Confirm Owner receipt and include this Issue in closeout reporting.");
  await reportForm.getByLabel("회신 기한").fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
  await reportForm.getByLabel("수령 확인 기한").fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
  const reportCreatedPromise = page.waitForResponse((response) => response.url().includes(`/inspection-cases/${draft.id}/issues/${pair.issue.id}/owner-reports`)
    && response.request().method() === "POST");
  await reportForm.getByRole("button", { name: "초안 작성", exact: true }).click();
  const reportCreatedResponse = await reportCreatedPromise;
  expect(reportCreatedResponse.status(), await reportCreatedResponse.text()).toBe(201);
  const reportCreated = await reportCreatedResponse.json() as { report: { id: string; status: string; title: string } };
  expect(reportCreated.report.status).toBe("draft");
  expect(reportCreated.report.title).toBe(reportTitle);
  const openCase = await api<{ issues: Array<{ issue: { record: { id: string } }; ownerReports: Array<{ record: { id: string; status: string } }>; readiness: { ownerReportingComplete: boolean; ownerReceiptPending: boolean } }> }>(request, sup,
    `/inspection-cases/${draft.id}`);
  const openGroup = openCase.issues.find((group) => group.issue.record.id === pair.issue.id)!;
  expect(openGroup.ownerReports[0].record.status).toBe("draft");
  expect(openGroup.readiness.ownerReportingComplete).toBe(false);

  let reportRow = issueCard.locator(".inspection-case-record").filter({ hasText: reportTitle });
  await runCommand(page, "시정자료 제출", {}, [], { source: reportRow });
  await runCommand(page, "공식 발행", {}, [], { source: reportRow });
  const issuedReport = await api<{ id: string; version: number; status: string }>(request, sup, `/owner-reports/${reportCreated.report.id}`);
  expect(issuedReport.status).toBe("issued");
  const awaitingReceipt = await api<{ issues: Array<{ issue: { record: { id: string } }; readiness: { ownerReportingComplete: boolean; ownerReceiptPending: boolean } }> }>(request, sup,
    `/inspection-cases/${draft.id}`);
  const awaitingGroup = awaitingReceipt.issues.find((group) => group.issue.record.id === pair.issue.id)!;
  expect(awaitingGroup.readiness.ownerReceiptPending).toBe(true);
  expect(awaitingGroup.readiness.ownerReportingComplete).toBe(false);

  await selectRole(page, "OWN");
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "작업함", exact: true }).click();
  await casePanel.getByLabel("원 검측 선택", { exact: true }).selectOption(draft.id);
  issueCard = casePanel.locator(".inspection-case-issue").filter({ hasText: issueTitle });
  reportRow = issueCard.locator(".inspection-case-record").filter({ hasText: reportTitle });
  await runCommand(page, "수령 확인", {}, [], { source: reportRow });

  await selectRole(page, "SUP");
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "작업함", exact: true }).click();
  await casePanel.getByLabel("원 검측 선택", { exact: true }).selectOption(draft.id);
  issueCard = casePanel.locator(".inspection-case-issue").filter({ hasText: issueTitle });
  reportRow = issueCard.locator(".inspection-case-record").filter({ hasText: reportTitle });
  await runCommand(page, "후속조치 이행", {}, [], { source: reportRow });
  await runCommand(page, "조치 검증", {}, [evidenceId], { source: reportRow });
  await runCommand(page, "종결 검토", {}, [], { source: reportRow });
  const closedReport = await api<{ id: string; version: number; status: string; report: { acknowledgedBy: string } }>(request, sup,
    `/owner-reports/${reportCreated.report.id}`);
  expect(closedReport.status).toBe("closed");
  expect(closedReport.report.acknowledgedBy).toBe(ownerPartyId);
  const finalCase = await api<{ readiness: { complete: boolean; openIssueIds: string[] }; issues: Array<{ issue: { record: { id: string } }; ownerReports: Array<{ record: { id: string; status: string } }>; readiness: { ownerReceiptConfirmed: boolean; ownerReportingComplete: boolean; closeReady: boolean } }> }>(request, sup,
    `/inspection-cases/${draft.id}`);
  expect(finalCase.readiness.complete).toBe(true);
  expect(finalCase.readiness.openIssueIds).not.toContain(pair.issue.id);
  const finalGroup = finalCase.issues.find((group) => group.issue.record.id === pair.issue.id)!;
  expect(finalGroup.ownerReports[0].record.status).toBe("closed");
  expect(finalGroup.readiness.ownerReceiptConfirmed).toBe(true);
  expect(finalGroup.readiness.ownerReportingComplete).toBe(true);
  expect(markup.id).toBeTruthy();
});
