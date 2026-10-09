import { expect, test, type APIRequestContext } from "@playwright/test";
import { localDateTime } from "./support/local-datetime";
import { randomUUID } from "node:crypto";
import type { DomainRef, Workspace } from "../apps/web/src/data/ui-contract";

type Session = { accessToken: string; projectId: string; actor: { partyId: string; roleAssignmentId: string } };

function onePagePdf(): Buffer {
  const text = "BT /F1 24 Tf 72 720 Td (Synthetic markup issue drawing) Tj ET";
  const stream = `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    stream, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n"; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(body, "ascii")); body += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xrefOffset = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}
function headers(session: Session, idempotent = false) {
  return { Authorization: `Bearer ${session.accessToken}`, "X-RoleAssignment-Id": session.actor.roleAssignmentId,
    ...(idempotent ? { "Idempotency-Key": randomUUID() } : {}) };
}
async function api<T>(request: APIRequestContext, projectId: string, path: string, session: Session, data?: unknown, expected = 200): Promise<T> {
  const response = data === undefined ? await request.get(`/api/projects/${projectId}${path}`, { headers: headers(session) })
    : await request.post(`/api/projects/${projectId}${path}`, { headers: headers(session, true), data });
  const text = await response.text(); expect(response.status(), `${path}: ${text}`).toBe(expected);
  return JSON.parse(text) as T;
}
async function login(request: APIRequestContext, actorGroup: string) {
  const response = await request.post("/api/dev/sessions", { data: { actorGroup } });
  const text = await response.text(); expect(response.status(), text).toBe(200); return JSON.parse(text) as Session;
}
async function command(request: APIRequestContext, session: Session, collection: string, id: string,
  name: string, current: { id: string; version: number }, payload: Record<string, unknown> = {}, evidenceIds: string[] = []) {
  const value = await api<{ record: { id: string; version: number } }>(request, session.projectId,
    `/${collection}/${id}/${name.replaceAll("_", "-")}`, session,
    { roleAssignmentId: session.actor.roleAssignmentId, expectedVersion: current.version, payload, evidenceIds });
  return value.record;
}
async function failedInspection(request: APIRequestContext, con: Session, sup: Session, context: Workspace, evidenceRef: DomainRef, suffix: string) {
  const drawingRef = context.context.drawingRef as DomainRef;
  const requirementRef = context.context.requirementRef as DomainRef;
  const scope = context.context.scope;
  const evidenceId = evidenceRef.objectId;
  const now = Date.now(); const at = (delta: number) => new Date(now + delta).toISOString();
  let record = (await api<{ record: { id: string; version: number } }>(request, con.projectId, "/inspections", con, {
    roleAssignmentId: con.actor.roleAssignmentId, clientObjectId: randomUUID(), payload: { ...scope,
      workName: `Markup issue synthetic inspection ${suffix}`, selfInspectionComplete: true,
      precheck: { drawing: true, material: true, test: true, previous: true, change: true }, holdPoint: false,
      minimumQualificationRank: 1, nextWorkAllowed: false, requirementRefs: [requirementRef], drawingRef, evidenceIds: [evidenceId] },
  }, 201)).record;
  record = await command(request, con, "inspections", record.id, "request", record,
    { requestedAt: at(0), requestedInspectionAt: at(3_600_000), selfInspectionComplete: true,
      precheck: { drawing: true, material: true, test: true, previous: true, change: true }, drawingRef, requirementRefs: [requirementRef] }, [evidenceId]);
  record = await command(request, sup, "inspections", record.id, "receive", record, { receivedAt: at(0) }, [evidenceId]);
  record = await command(request, sup, "inspections", record.id, "schedule", record, { scheduledAt: at(0) }, [evidenceId]);
  record = await command(request, sup, "inspections", record.id, "start", record, {}, [evidenceId]);
  record = await command(request, sup, "inspections", record.id, "submit_results", record, { checkResults: [{ itemId: "dimension",
    requirementRef, result: "fail", evidenceIds: [evidenceId], measuredValue: 90, unit: "mm" }] }, [evidenceId]);
  record = await command(request, sup, "inspections", record.id, "fail", record, { failureReason: "Synthetic drawing markup issue fixture" }, [evidenceId]);
  const observation = (await api<{ record: { id: string; version: number } }>(request, sup.projectId, "/observations", sup, {
    roleAssignmentId: sup.actor.roleAssignmentId, clientObjectId: randomUUID(), payload: { ...scope, source: "supervisor",
      description: `Synthetic confirmed observation ${suffix}`, grounding: [{ evidenceId, channel: "visual", claimSupport: "observed" }], evidenceIds: [evidenceId] },
  }, 201)).record;
  let confirmed = await command(request, sup, "observations", observation.id, "begin_review", observation);
  confirmed = await command(request, sup, "observations", observation.id, "confirm", confirmed,
    { verificationNote: "Synthetic fixture observation confirmed" }, [evidenceId]);
  return { inspection: record, observation: confirmed };
}

test("registers an Issue and corrective Action from a selected saved markup after explicit confirmation", async ({ page, request }) => {
  const adm = await login(request, "ADM"); const con = await login(request, "CON"); const sup = await login(request, "SUP");
  expect(adm.projectId).toBe(con.projectId); expect(sup.projectId).toBe(con.projectId);
  const admWorkspace = await api<Workspace>(request, adm.projectId, "/workspace", adm);
  const conWorkspace = await api<Workspace>(request, con.projectId, "/workspace", con);
  const supWorkspace = await api<Workspace>(request, sup.projectId, "/workspace", sup);
  const draw = admWorkspace.context.drawingRef as DomainRef;
  expect(draw).toEqual(supWorkspace.context.drawingRef);
  expect(draw).toEqual(conWorkspace.context.drawingRef);
  const suffix = randomUUID().slice(0, 8); const markupText = `Synthetic issue annotation ${suffix}`;
  let bindingList = await api<{ items: Array<{ id: string; drawingRef: DomainRef; evidenceRef: DomainRef }> }>(request, adm.projectId,
    "/parallel/drawing-pdf-bindings", adm);
  let binding = bindingList.items.find(item => item.drawingRef.objectId === draw.objectId && item.drawingRef.version === draw.version);
  if (!binding) {
    await page.goto("/#/parallel-test");
    await page.getByLabel("개발 역할 선택").selectOption("ADM");
    await page.goto("/#/parallel-test");
    await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
    const viewer = page.getByLabel("PDF 도면 뷰어");
    const completed = page.waitForResponse(response => response.url().includes("/uploads/")
      && response.url().endsWith("/complete") && response.request().method() === "POST");
    await viewer.getByTestId("pdf-upload").setInputFiles({ name: `markup-issue-${suffix}.pdf`, mimeType: "application/pdf", buffer: onePagePdf() });
    const uploaded = await completed; expect(uploaded.ok()).toBeTruthy();
    const evidence = await uploaded.json() as { id: string; version: number };
    const bindingPanel = page.getByRole("region", { name: "도면 PDF 연결" });
    await bindingPanel.getByLabel("도면 버전").selectOption(`${draw.objectType}:${draw.objectId}:${draw.version}`);
    await bindingPanel.getByLabel("PDF 원본").selectOption(`Evidence:${evidence.id}:${evidence.version}`);
    const createdBinding = page.waitForResponse(response => response.url().endsWith("/parallel/drawing-pdf-bindings")
      && response.request().method() === "POST");
    await bindingPanel.getByRole("button", { name: "선택한 버전 연결" }).click();
    expect((await createdBinding).status()).toBe(201);
    bindingList = await api<{ items: Array<{ id: string; drawingRef: DomainRef; evidenceRef: DomainRef }> }>(request, adm.projectId,
      "/parallel/drawing-pdf-bindings", adm);
    binding = bindingList.items.find(item => item.drawingRef.objectId === draw.objectId && item.drawingRef.version === draw.version);
  }
  expect(binding, "API-backed scenario setup must produce an exact current Drawing/PDF binding").toBeTruthy();
  const markup = await api<{ id: string; version: number }>(request, adm.projectId, "/parallel/drawing-markups", adm, {
    bindingId: binding!.id, page: 1, rect: { x1: 80, y1: 120, x2: 240, y2: 280 }, text: markupText,
  }, 201);
  const sources = await failedInspection(request, con, sup, conWorkspace, binding!.evidenceRef, suffix);
  const issueTitle = `Markup Issue ${suffix}`; const actionTitle = `Markup correction ${suffix}`;
  const observedWrites: Array<{ url: string; body: unknown; key?: string }> = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", req => {
    if (req.method() === "POST" && req.url().includes(`/parallel/drawing-markups/${markup.id}/issues`)) {
      observedWrites.push({ url: req.url(), body: req.postDataJSON(), key: req.headers()["idempotency-key"] });
    }
  });
  await page.goto("/#/parallel-test");
  await page.getByLabel("개발 역할 선택").selectOption("SUP");
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
  const viewer = page.getByLabel("PDF 도면 뷰어");
  await viewer.getByLabel("PDF 원본 선택").selectOption(binding!.evidenceRef.objectId);
  const savedMarkup = viewer.getByLabel("저장된 도면 주석").getByRole("button", { name: new RegExp(markupText) });
  await expect(savedMarkup).toBeVisible();
  await savedMarkup.click();
  const panel = page.getByTestId("drawing-markup-issue");
  await expect(panel.getByText(markupText, { exact: true })).toBeVisible();
  await expect(panel.getByText(new RegExp(`${draw.objectId} · v${draw.version}`))).toBeVisible();
  await panel.getByLabel("실패 원 검측").selectOption(sources.inspection.id);
  await panel.getByLabel("확인된 관찰").selectOption(sources.observation.id);
  await panel.getByLabel("Issue 유형").selectOption("NCR");
  await panel.getByLabel("Issue 제목").fill(issueTitle);
  await panel.getByLabel("시정조치 제목").fill(actionTitle);
  await panel.getByLabel("담당자").selectOption(con.actor.partyId);
  await panel.getByLabel("기한").fill(await localDateTime(page, Date.now() + 86_400_000));
  await panel.getByRole("button", { name: "이슈 등록 검토" }).click();
  const dialog = page.getByRole("dialog", { name: "Issue 및 시정조치 등록 확인" });
  await expect(dialog.getByText(new RegExp(sources.inspection.id))).toBeVisible();
  await expect(dialog.getByText(new RegExp(sources.observation.id))).toBeVisible();
  expect(observedWrites).toEqual([]);
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toHaveCount(0);
  expect(observedWrites).toEqual([]);
  await panel.getByRole("button", { name: "이슈 등록 검토" }).click();
  const confirmedDialog = page.getByRole("dialog");
  const post = page.waitForResponse(response => response.url().includes(`/parallel/drawing-markups/${markup.id}/issues`) && response.request().method() === "POST");
  await confirmedDialog.getByRole("button", { name: "확인 후 Issue와 조치 등록" }).click();
  const response = await post;
  expect(response.status(), await response.text()).toBe(201);
  expect(observedWrites).toHaveLength(1);
  expect(observedWrites[0].key).toBeTruthy();
  expect(observedWrites[0].body).toMatchObject({ expectedMarkupVersion: markup.version,
    inspectionRef: { objectType: "Inspection", objectId: sources.inspection.id, version: sources.inspection.version },
    observationRefs: [{ objectType: "Observation", objectId: sources.observation.id, version: sources.observation.version }],
    responsiblePartyId: con.actor.partyId, title: issueTitle, actionTitle });
  const result = await response.json() as { issue: { id: string; title?: string; status?: string }; correctiveAction: { id: string; title?: string; status?: string } };
  await expect(panel.getByText(new RegExp(`Issue · .*${result.issue.id}`))).toBeVisible();
  await expect(panel.getByText(new RegExp(`시정조치 · .*${result.correctiveAction.id}`))).toBeVisible();
  expect(errors).toEqual([]);
});
