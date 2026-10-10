import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

let apiPort = 0;
let apiOrigin = "";
let apiProcess: ChildProcess | undefined;
let fixtureDir: string | undefined;
let dropNextIssueAcknowledgement = false;
let failNextWorkspaceRefresh = false;
const issueRequests: Array<{ key: string | undefined; body: string | null }> = [];
const reviewMutations: string[] = [];
if (process.env.CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.CHROMIUM_PATH } });

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolvePromise); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve media fixture port");
  const port = address.port;
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return port;
}

test.beforeAll(async () => {
  apiPort = await availablePort();
  apiOrigin = `http://127.0.0.1:${apiPort}`;
  process.env.DOUL_API_ALLOWED_ORIGINS = `http://127.0.0.1:5184,${apiOrigin}`;
  fixtureDir = mkdtempSync(join(tmpdir(), "doul-media-ui-"));
  const python = process.env.DOUL_MEDIA_PYTHON ?? process.env.DOUL_TEST_PYTHON ?? resolve(process.cwd(), ".venv/bin/python");
  apiProcess = spawn(python, ["-m", "tests_browser.support.media_analysis_api_fixture", "--host", "127.0.0.1", "--port", String(apiPort), "--database", join(fixtureDir, "media.sqlite3")], { cwd: process.cwd(), stdio: "ignore" });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) throw new Error(`Media fixture API exited with ${apiProcess.exitCode}`);
    try { if ((await fetch(`${apiOrigin}/health`)).ok) return; } catch { /* wait for uvicorn startup */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error("Media fixture API did not become ready");
});

test.afterAll(async () => {
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill("SIGTERM");
    await new Promise<void>((done) => { const timeout = setTimeout(() => { apiProcess?.kill("SIGKILL"); done(); }, 3000); apiProcess?.once("exit", () => { clearTimeout(timeout); done(); }); });
  }
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

type Session = { projectId: string; accessToken: string; actor: { partyId: string; roleAssignmentId: string } };
const headers = (session: Session, idempotent = false) => ({
  Authorization: `Bearer ${session.accessToken}`,
  "X-RoleAssignment-Id": session.actor.roleAssignmentId,
  ...(idempotent ? { "Idempotency-Key": randomUUID() } : {}),
});

async function login(request: APIRequestContext, actorGroup: string): Promise<Session> {
  const response = await request.post(`${apiOrigin}/dev/sessions`, { data: { actorGroup } });
  const body = await response.text(); expect(response.status(), body).toBe(200); return JSON.parse(body) as Session;
}

async function api<T>(request: APIRequestContext, session: Session, path: string, body?: unknown, status = 200): Promise<T> {
  const response = body === undefined
    ? await request.get(`${apiOrigin}/projects/${session.projectId}${path}`, { headers: headers(session) })
    : await request.post(`${apiOrigin}/projects/${session.projectId}${path}`, { headers: headers(session, true), data: body });
  const text = await response.text(); expect(response.status(), `${path}: ${text}`).toBe(status); return JSON.parse(text) as T;
}

async function command(request: APIRequestContext, session: Session, collection: string, record: { id: string; version: number }, name: string, payload: Record<string, unknown> = {}, evidenceIds: string[] = []) {
  return api<{ record: { id: string; version: number } }>(request, session,
    `/${collection}/${record.id}/${name.replaceAll("_", "-")}`,
    { roleAssignmentId: session.actor.roleAssignmentId, expectedVersion: record.version, payload, evidenceIds }, 200);
}

async function routeApi(page: Page) {
  await page.route("**/*", async (route) => {
    const target = new URL(route.request().url());
    if (!target.pathname.startsWith("/api/")) return route.continue();
    target.pathname = target.pathname.replace(/^\/api(?=\/)/, "");
    target.hostname = "127.0.0.1"; target.port = String(apiPort);
    if (["POST", "PUT"].includes(route.request().method()) && (/\/observations\//.test(target.pathname) || /\/media-analysis-runs/.test(target.pathname))) {
      reviewMutations.push(`${route.request().method()} ${target.pathname}`);
    }
    if (route.request().method() === "GET" && target.pathname.endsWith("/workspace") && failNextWorkspaceRefresh) {
      failNextWorkspaceRefresh = false;
      await route.fulfill({ status: 502, body: "Synthetic workspace refresh failure after committed Issue" });
      return;
    }
    const response = await route.fetch({ url: target.toString() });
    if (route.request().method() === "POST" && /\/media-analysis-runs\/[^/]+\/issues$/.test(target.pathname)) {
      issueRequests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
      if (dropNextIssueAcknowledgement) {
        dropNextIssueAcknowledgement = false;
        await response.dispose();
        await route.fulfill({ status: 502, body: "Synthetic lost acknowledgement after the server committed the request" });
        return;
      }
    }
    await route.fulfill({ response });
  });
}

function localDateTime(date: Date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

test("Capture queues synthetic analysis, shows coverage, supports human confirm/reject, and issues only eligible confirmation", async ({ page, request }) => {
  test.setTimeout(120_000);
  await routeApi(page);
  const sup = await login(request, "SUP");
  const adm = await login(request, "ADM");
  const con = await login(request, "CON");
  const initial = await api<{ items: Array<{ machine: string; record: Record<string, unknown> }> }>(request, sup, "/workspace");
  const inspectionItem = initial.items.find((item) => item.machine === "inspection" && item.record.status === "scheduled");
  expect(inspectionItem, "fixture provides a synthetic scheduled inspection").toBeTruthy();
  const inspection = inspectionItem!.record as unknown as { id: string; version: number; requirementRefs: Array<{ objectType: string; objectId: string; version: number }>; evidenceIds: string[] };
  let changed = (await command(request, sup, "inspections", inspection, "start")).record;
  changed = (await command(request, sup, "inspections", changed, "submit_results", { checkResults: [{
    itemId: "dimension", requirementRef: inspection.requirementRefs[0], result: "fail", evidenceIds: inspection.evidenceIds,
    measuredValue: 88, unit: "mm",
  }] }, inspection.evidenceIds)).record;
  changed = (await command(request, sup, "inspections", changed, "fail", { failureReason: "Synthetic media browser acceptance fixture" }, inspection.evidenceIds)).record;

  await page.goto("/#/capture");
  await expect(page.getByTestId("media-analysis-panel")).toBeVisible();
  await expect(page.getByText(/Synthetic demo only|합성 데모 전용/)).toBeVisible();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64");
  await page.getByLabel("증빙 파일 선택").setInputFiles({ name: `synthetic-media-${randomUUID()}.png`, mimeType: "image/png", buffer: png });
  const uploadedResponse = page.waitForResponse((response) => response.url().includes("/uploads/") && response.url().endsWith("/complete") && response.request().method() === "POST");
  await page.getByRole("button", { name: "서버 전송", exact: true }).click();
  const uploaded = await uploadedResponse; expect(uploaded.status(), await uploaded.text()).toBe(201);
  const evidence = await uploaded.json() as { id: string; fileHash: string };

  const panel = page.getByTestId("media-analysis-panel");
  const runWritesBeforeRoleGate = reviewMutations.filter((entry) => entry.endsWith("/media-analysis-runs")).length;
  await page.getByLabel("개발 역할 선택").selectOption("CON");
  await page.goto("/#/capture");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("서버가 이 프로젝트의 미디어 분석 대기열을 활성화하지 않았습니다.")).toBeVisible();
  await expect(panel.getByLabel("원본 증빙", { exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "분석 요청", exact: true })).toBeDisabled();
  expect(reviewMutations.filter((entry) => entry.endsWith("/media-analysis-runs"))).toHaveLength(runWritesBeforeRoleGate);
  await page.getByLabel("개발 역할 선택").selectOption("SUP");
  await page.goto("/#/capture");
  await expect(panel).toBeVisible();
  await panel.getByLabel("원본 증빙", { exact: true }).selectOption(evidence.id);
  await expect(panel.getByRole("button", { name: "분석 요청", exact: true })).toBeEnabled();
  await panel.getByLabel("검측 연결 (Issue 생성 전 필수)", { exact: true }).selectOption(inspection.id);
  const queuedResponse = page.waitForResponse((response) => response.url().endsWith("/media-analysis-runs") && response.request().method() === "POST");
  await panel.getByRole("button", { name: "분석 요청", exact: true }).click();
  const queued = await queuedResponse; expect(queued.status(), await queued.text()).toBe(201);
  const run = await queued.json() as { id: string };
  const queuedReview = await api<{ sources: Array<{ id: string; mediaType: string }>; run: { record: { sourceEvidenceIds: string[] } } }>(request, sup, `/media-analysis-runs/${run.id}`);
  expect(queuedReview.sources.map((source) => source.id)).toEqual([evidence.id]);
  expect(queuedReview.run.record.sourceEvidenceIds).toEqual([evidence.id]);

  const unauthorizedQueue = await request.post(`${apiOrigin}/projects/${con.projectId}/media-analysis-runs`, {
    headers: headers(con, true), data: { roleAssignmentId: con.actor.roleAssignmentId, clientObjectId: randomUUID(), sourceEvidenceIds: [evidence.id], mode: "photo", languages: ["en"] },
  });
  expect([403, 404]).toContain(unauthorizedQueue.status());
  const unauthorizedIssueId = randomUUID();
  const unauthorizedIssue = await request.post(`${apiOrigin}/projects/${con.projectId}/media-analysis-runs/${run.id}/issues`, {
    headers: headers(con, true), data: { roleAssignmentId: con.actor.roleAssignmentId, issueObjectId: unauthorizedIssueId, actionObjectId: randomUUID(), observationIds: [randomUUID()], subtype: "NCR", title: "Unauthorized synthetic issue", actionTitle: "Unauthorized action", responsiblePartyId: con.actor.partyId, dueAt: new Date(Date.now() + 86_400_000).toISOString() },
  });
  expect([403, 404]).toContain(unauthorizedIssue.status());
  expect((await request.get(`${apiOrigin}/projects/${con.projectId}/issues/${unauthorizedIssueId}`, { headers: headers(sup) })).status()).toBe(404);

  const start = await request.post(`${apiOrigin}/dev/media-worker/projects/${sup.projectId}/runs/${run.id}/start`, { headers: headers(adm, true), data: {} });
  expect(start.status(), await start.text()).toBe(200);
  const outputs = [
    { description: "Synthetic visually grounded finding", claimSupport: "observed", channel: "visual" },
    { description: "Synthetic claim to reject", claimSupport: "observed", channel: "visual" },
    { description: "Synthetic inferred claim", claimSupport: "inferred", channel: "visual" },
    { description: "Synthetic unreviewed claim", claimSupport: "observed", channel: "visual" },
  ].map((candidate, index) => ({
    kind: "candidate", sourceEvidenceId: evidence.id, analysisRunId: run.id, ...candidate, confidence: 0.8 - index * 0.1,
    reviewFlags: ["synthetic_fixture", "human_confirmation_required"],
    grounding: [{ evidenceId: evidence.id, channel: candidate.channel, claimSupport: candidate.claimSupport }],
  }));
  const completion = await request.post(`${apiOrigin}/dev/media-worker/projects/${sup.projectId}/runs/${run.id}/complete`, {
    headers: headers(adm, true), data: { outputs, coverage: { sources: [{ sourceEvidenceId: evidence.id, analyzedRanges: [], missingRanges: [], audioProcessedRanges: [], complete: true }] }, completedAt: new Date().toISOString() },
  });
  expect(completion.status(), await completion.text()).toBe(200);

  await panel.getByLabel("분석 실행", { exact: true }).selectOption(run.id);
  await panel.getByRole("button", { name: "실행 새로고침", exact: true }).click();
  await expect(panel.getByText("Synthetic visually grounded finding", { exact: false })).toBeVisible();
  await expect(panel.getByText("Synthetic claim to reject", { exact: false })).toBeVisible();
  await expect(panel.getByText("Synthetic inferred claim", { exact: false })).toBeVisible();
  await expect(panel.getByText(/합성 데모 전용/)).toBeVisible();
  await expect(panel.locator("code").filter({ hasText: evidence.id }).first()).toBeVisible();
  await expect(panel.locator("code").filter({ hasText: evidence.fileHash }).first()).toBeVisible();
  await expect(panel.getByText("완료: 완료")).toBeVisible();
  await expect(panel.getByText("실행 상태: 분석 완료")).toBeVisible();
  await expect(panel.getByText("차단 사유: 사람이 관찰을 확인해야 합니다.")).toBeVisible();
  const beforeLocale = await api<{ candidates: Array<{ record: { id: string; version: number; status: string } }>; issueReadiness: { issueEligibleObservationIds: string[] } }>(request, sup, `/media-analysis-runs/${run.id}`);
  const mutationCountBeforeLocale = reviewMutations.length;
  await page.getByRole("combobox").first().selectOption("vi");
  await expect(panel.getByRole("heading", { name: "Phân tích media và người duyệt" })).toBeVisible();
  await expect(panel.getByText(evidence.fileHash, { exact: false })).toBeVisible();
  await expect(panel.getByText("Trạng thái: Đã phân tích xong")).toBeVisible();
  await expect(panel.getByText("Lý do chặn: Cần người xác nhận quan sát.")).toBeVisible();
  await page.getByRole("combobox").first().selectOption("en");
  await expect(panel.getByRole("heading", { name: "Media analysis and human review" })).toBeVisible();
  await expect(panel.getByText("Synthetic visually grounded finding", { exact: false })).toBeVisible();
  await expect(panel.locator("code").filter({ hasText: evidence.fileHash }).first()).toBeVisible();
  await expect(panel.getByText("Run status: Succeeded")).toBeVisible();
  await expect(panel.getByText("Blocked by: A person must confirm an observation.")).toBeVisible();
  const afterLocale = await api<{ candidates: Array<{ record: { id: string; version: number; status: string } }>; issueReadiness: { issueEligibleObservationIds: string[] } }>(request, sup, `/media-analysis-runs/${run.id}`);
  expect(afterLocale.candidates.map(({ record }) => [record.id, record.version, record.status])).toEqual(beforeLocale.candidates.map(({ record }) => [record.id, record.version, record.status]));
  expect(afterLocale.issueReadiness).toEqual(beforeLocale.issueReadiness);
  expect(reviewMutations).toHaveLength(mutationCountBeforeLocale);
  await page.getByRole("combobox").first().selectOption("ko");
  await expect(panel.getByRole("heading", { name: "미디어 분석 및 사람 검토" })).toBeVisible();

  const confirmedCard = panel.locator('[data-testid^="media-candidate-"]').filter({ hasText: "Synthetic visually grounded finding" });
  await confirmedCard.getByRole("button", { name: "검토 시작" }).click();
  await confirmedCard.getByRole("checkbox").check();
  await confirmedCard.locator("textarea").first().fill("SUP reviewed synthetic source image and location");
  const confirmButton = confirmedCard.getByRole("button", { name: "관찰 확인" });
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  const rejectedCard = panel.locator('[data-testid^="media-candidate-"]').filter({ hasText: "Synthetic claim to reject" });
  await rejectedCard.getByRole("button", { name: "검토 시작" }).click();
  await rejectedCard.locator("textarea").nth(1).fill("Synthetic fixture rejection path");
  const rejectButton = rejectedCard.getByRole("button", { name: "후보 반려" });
  await expect(rejectButton).toBeEnabled({ timeout: 10_000 });
  await rejectButton.click();
  const inferredCard = panel.locator('[data-testid^="media-candidate-"]').filter({ hasText: "Synthetic inferred claim" });
  await inferredCard.getByRole("button", { name: "검토 시작" }).click();
  await inferredCard.getByRole("checkbox").check();
  await inferredCard.locator("textarea").first().fill("SUP reviewed inferred synthetic claim");
  await inferredCard.getByRole("button", { name: "관찰 확인" }).click();

  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(32)]);
  await page.getByLabel("증빙 파일 선택").setInputFiles({ name: `synthetic-audio-${randomUUID()}.wav`, mimeType: "audio/wav", buffer: wav });
  const audioUploadWait = page.waitForResponse((response) => response.url().includes("/uploads/") && response.url().endsWith("/complete") && response.request().method() === "POST");
  await page.getByRole("button", { name: "서버 전송", exact: true }).click();
  const audioUpload = await audioUploadWait; expect(audioUpload.status(), await audioUpload.text()).toBe(201);
  const audio = await audioUpload.json() as { id: string };
  const indexed = await request.post(`${apiOrigin}/dev/media-worker/projects/${sup.projectId}/evidence/${audio.id}/index`, {
    headers: headers(adm, true), data: { durationMs: 1000, framePtsMs: [], metadata: { codec: "synthetic-test-wave", sampleRate: 16000 } },
  });
  expect(indexed.status(), await indexed.text()).toBe(200);
  await panel.getByLabel("원본 증빙", { exact: true }).selectOption(audio.id);
  await expect(panel.getByLabel("분석 모드", { exact: true })).toHaveValue("audio");
  await panel.getByLabel("검측 연결 (Issue 생성 전 필수)", { exact: true }).selectOption(inspection.id);
  const audioQueuedWait = page.waitForResponse((response) => response.url().endsWith("/media-analysis-runs") && response.request().method() === "POST");
  await panel.getByRole("button", { name: "분석 요청", exact: true }).click();
  const audioQueued = await audioQueuedWait; expect(audioQueued.status(), await audioQueued.text()).toBe(201);
  const audioRun = await audioQueued.json() as { id: string };
  const audioStart = await request.post(`${apiOrigin}/dev/media-worker/projects/${sup.projectId}/runs/${audioRun.id}/start`, { headers: headers(adm, true), data: {} });
  expect(audioStart.status(), await audioStart.text()).toBe(200);
  const speechCandidate = { kind: "candidate", sourceEvidenceId: audio.id, analysisRunId: audioRun.id, description: "Synthetic speech-only claim", confidence: 0.7,
    reviewFlags: ["synthetic_fixture", "human_confirmation_required"], grounding: [{ evidenceId: audio.id, channel: "speech", claimSupport: "reported" }] };
  const audioComplete = await request.post(`${apiOrigin}/dev/media-worker/projects/${sup.projectId}/runs/${audioRun.id}/complete`, {
    headers: headers(adm, true), data: { outputs: [speechCandidate], coverage: { sources: [{ sourceEvidenceId: audio.id, analyzedRanges: [], missingRanges: [], audioProcessedRanges: [{ startMs: 0, endMs: 1000 }], complete: true }] }, completedAt: new Date().toISOString() },
  });
  expect(audioComplete.status(), await audioComplete.text()).toBe(200);
  await panel.getByLabel("분석 실행", { exact: true }).selectOption(audioRun.id);
  await panel.getByRole("button", { name: "실행 새로고침", exact: true }).click();
  const speechCard = panel.locator('[data-testid^="media-candidate-"]').filter({ hasText: "Synthetic speech-only claim" });
  await speechCard.getByRole("button", { name: "검토 시작" }).click();
  await speechCard.getByRole("checkbox").check();
  await speechCard.locator("textarea").first().fill("SUP reviewed synthetic speech statement");
  await speechCard.getByRole("button", { name: "관찰 확인" }).click();
  await expect(panel.getByText("비음성 증거로 관찰을 뒷받침해야 합니다.")).toBeVisible();
  await expect(panel.getByTestId("media-issue-authoring")).toHaveCount(0);
  const speechReview = await api<{ candidates: Array<{ record: { id: string } }> }>(request, sup, `/media-analysis-runs/${audioRun.id}`);
  const ineligibleIssueId = randomUUID();
  const speechIssue = await request.post(`${apiOrigin}/projects/${sup.projectId}/media-analysis-runs/${audioRun.id}/issues`, {
    headers: headers(sup, true), data: { roleAssignmentId: sup.actor.roleAssignmentId, issueObjectId: ineligibleIssueId, actionObjectId: randomUUID(), observationIds: [speechReview.candidates[0].record.id], subtype: "NCR", title: "Synthetic speech-only Issue must fail", actionTitle: "Blocked synthetic action", responsiblePartyId: con.actor.partyId, dueAt: new Date(Date.now() + 86_400_000).toISOString() },
  });
  expect(speechIssue.status(), await speechIssue.text()).toBe(409);
  expect((await speechIssue.json()).code).toBe("CLAIM_UNCORROBORATED");
  expect((await request.get(`${apiOrigin}/projects/${sup.projectId}/issues/${ineligibleIssueId}`, { headers: headers(sup) })).status()).toBe(404);

  await panel.getByLabel("원본 증빙", { exact: true }).selectOption(audio.id);
  await expect(panel.getByLabel("분석 모드", { exact: true })).toHaveValue("audio");
  const incompleteQueuedWait = page.waitForResponse((response) => response.url().endsWith("/media-analysis-runs") && response.request().method() === "POST");
  await panel.getByRole("button", { name: "분석 요청", exact: true }).click();
  const incompleteQueued = await incompleteQueuedWait; expect(incompleteQueued.status(), await incompleteQueued.text()).toBe(201);
  const incompleteRun = await incompleteQueued.json() as { id: string };
  const incompleteStart = await request.post(`${apiOrigin}/dev/media-worker/projects/${sup.projectId}/runs/${incompleteRun.id}/start`, { headers: headers(adm, true), data: {} });
  expect(incompleteStart.status(), await incompleteStart.text()).toBe(200);
  const incompleteComplete = await request.post(`${apiOrigin}/dev/media-worker/projects/${sup.projectId}/runs/${incompleteRun.id}/complete`, {
    headers: headers(adm, true), data: { outputs: [], coverage: { sources: [{ sourceEvidenceId: audio.id, analyzedRanges: [{ startMs: 0, endMs: 500 }], missingRanges: [{ startMs: 500, endMs: 1000, reason: "synthetic fixture intentionally skipped tail" }], audioProcessedRanges: [{ startMs: 0, endMs: 500 }], complete: false }] }, completedAt: new Date().toISOString() },
  });
  expect(incompleteComplete.status(), await incompleteComplete.text()).toBe(200);
  await panel.getByLabel("분석 실행", { exact: true }).selectOption(incompleteRun.id);
  await panel.getByRole("button", { name: "실행 새로고침", exact: true }).click();
  await expect(panel.getByText("제안된 후보가 없습니다.")).toBeVisible();
  await expect(panel.getByText(/intentionally skipped tail/).first()).toBeVisible();
  await expect(panel.getByTestId("media-issue-authoring")).toHaveCount(0);

  await panel.getByLabel("분석 실행", { exact: true }).selectOption(run.id);
  await panel.getByRole("button", { name: "실행 새로고침", exact: true }).click();

  const issuePanel = panel.getByTestId("media-issue-authoring");
  await expect(issuePanel).toBeVisible();
  await expect(issuePanel.getByRole("checkbox")).toHaveCount(1);
  await issuePanel.getByRole("checkbox").check();
  await issuePanel.getByLabel("Issue 제목").fill("Synthetic media issue");
  await issuePanel.getByLabel("시정조치 제목").fill("Synthetic corrective action");
  await issuePanel.getByLabel("Issue 유형").selectOption("Defect");
  await expect(issuePanel.getByLabel("Issue 유형").locator("option:checked")).toHaveText("하자");
  await issuePanel.getByLabel("담당 시공사").selectOption({ index: 1 });
  await issuePanel.getByLabel("기한").fill(localDateTime(new Date(Date.now() + 7 * 86_400_000)));
  issueRequests.length = 0;
  dropNextIssueAcknowledgement = true;
  const issueResponse = page.waitForResponse((response) => /\/media-analysis-runs\/[^/]+\/issues$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
  await issuePanel.getByRole("button", { name: "선택 관찰로 Issue 생성" }).click();
  const dropped = await issueResponse; expect(dropped.status()).toBe(502);
  await expect(panel.getByRole("alert")).toBeVisible();
  const retryResponse = page.waitForResponse((response) => /\/media-analysis-runs\/[^/]+\/issues$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
  failNextWorkspaceRefresh = true;
  await issuePanel.getByRole("button", { name: "선택 관찰로 Issue 생성" }).click();
  const issued = await retryResponse; expect(issued.status(), await issued.text()).toBe(201);
  const issue = await issued.json() as { issue: { id: string; subtype: string; observationIds: string[] } };
  expect(issue.issue.observationIds).toHaveLength(1);
  expect(issue.issue.subtype).toBe("Defect");
  expect(issueRequests).toHaveLength(2);
  expect(issueRequests[1].key).toBe(issueRequests[0].key);
  expect(issueRequests[1].body).toBe(issueRequests[0].body);
  await expect(panel.getByTestId("media-issue-authoring")).toHaveCount(0);
  const persistedIssue = await api<{ id: string; subtype: string; evidenceIds?: string[] }>(request, sup, `/issues/${issue.issue.id}`);
  expect(persistedIssue.subtype).toBe("Defect");
  expect(persistedIssue.evidenceIds).toContain(evidence.id);
  await expect(panel.getByText(new RegExp(`Issue 생성 완료: ${issue.issue.id}`))).toBeVisible();
});
