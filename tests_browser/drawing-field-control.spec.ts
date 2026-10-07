import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { DomainRef, Workspace } from "../apps/web/src/data/ui-contract";

type Session = {
  accessToken: string;
  projectId: string;
  actor: { partyId: string; roleAssignmentId: string };
};
type FieldRecord = {
  id: string; version: number; status: string; drawingRef: DomainRef; evidenceRef: DomainRef;
  approvalRef: DomainRef | null; drawingNo: string; revision: string; requiredRecipientPartyIds: string[];
  changeRefs: DomainRef[]; currentForConstruction: boolean; fieldDistributionComplete?: boolean;
  receipts?: Array<{ recipientPartyId: string; deliveredAt: string | null; receivedAt: string | null }>;
};
type ApprovalRecord = { id: string; version: number; status: string; targetRef: DomainRef };

function onePagePdf(): Buffer {
  const text = "BT /F1 24 Tf 72 720 Td (Field control synthetic drawing) Tj ET";
  const stream = `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    stream, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n"; const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, "ascii")); body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}
function headers(session: Session, idempotent = false) {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    "X-RoleAssignment-Id": session.actor.roleAssignmentId,
    ...(idempotent ? { "Idempotency-Key": randomUUID() } : {}),
  };
}
async function responseJson<T>(response: APIResponse, status: number): Promise<T> {
  const text = await response.text();
  expect(response.status(), text).toBe(status);
  return JSON.parse(text) as T;
}
async function captureSession(page: Page, actorGroup: string): Promise<{ session: Session; workspace: Workspace }> {
  const ready = page.waitForResponse(response => response.url().endsWith("/dev/sessions")
    && response.request().method() === "POST"
    && (response.request().postData() || "").includes(`"actorGroup":"${actorGroup}"`));
  const workspaceReady = page.waitForResponse(async response => {
    if (!response.url().endsWith("/workspace") || !response.ok()) return false;
    try { return ((await response.json()) as Workspace).role.actorGroup === actorGroup; }
    catch { return false; }
  });
  await page.getByRole("combobox", { name: "개발 역할 선택" }).selectOption(actorGroup);
  const session = await responseJson<Session>(await ready, 200);
  const workspace = await responseJson<Workspace>(await workspaceReady, 200);
  expect(workspace.role.actorGroup).toBe(actorGroup);
  await page.goto("/#/parallel-test");
  return { session, workspace };
}
async function switchRole(page: Page, actorGroup: string): Promise<Workspace> {
  const picker = page.getByRole("combobox", { name: "개발 역할 선택" });
  if (await picker.inputValue() === actorGroup) {
    const response = page.waitForResponse(value => value.url().endsWith("/workspace") && value.ok());
    const result = await responseJson<Workspace>(await response, 200);
    expect(result.role.actorGroup).toBe(actorGroup);
    await page.goto("/#/parallel-test");
    return result;
  }
  const workspaceResponse = page.waitForResponse(async response => {
    if (!response.url().endsWith("/workspace") || !response.ok()) return false;
    try { return ((await response.json()) as Workspace).role.actorGroup === actorGroup; }
    catch { return false; }
  });
  await picker.selectOption(actorGroup);
  const data = await responseJson<Workspace>(await workspaceResponse, 200);
  expect(data.role.actorGroup).toBe(actorGroup);
  await page.goto("/#/parallel-test");
  return data;
}

test("publishes and distributes a reviewed source as a field controlled construction drawing", async ({ page, request }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const drawingNo = `DES-${suffix}`;
  const drawingRevision = "R0";

  await page.goto("/#/parallel-test");
  await captureSession(page, "DES");
  await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
  const viewer = page.getByLabel("PDF 도면 뷰어");
  const completed = page.waitForResponse(response => response.url().includes("/uploads/")
    && response.url().endsWith("/complete") && response.request().method() === "POST");
  await viewer.getByTestId("pdf-upload").setInputFiles({
    name: `drawing-field-${suffix}.pdf`, mimeType: "application/pdf", buffer: onePagePdf(),
  });
  const upload = await completed;
  expect(upload.ok()).toBeTruthy();
  const evidence = await upload.json() as { id: string; version: number };

  const sourcePanel = page.getByRole("region", { name: "도면 개정 등록" });
  await sourcePanel.getByLabel("새 도면 제목").fill(`DES field control source ${suffix}`);
  await sourcePanel.getByLabel("새 개정 번호").fill(drawingRevision);
  await sourcePanel.getByLabel("새 도면 PDF").selectOption(evidence.id);
  await expect(sourcePanel.getByLabel("등록 후 검토 요청")).toBeChecked();
  const sourceResponse = page.waitForResponse(response => response.url().endsWith("/parallel/drawing-sources")
    && response.request().method() === "POST");
  await sourcePanel.getByRole("button", { name: "새 개정 등록 검토" }).click();
  await page.getByRole("dialog", { name: "새 도면 개정 등록 확인" })
    .getByRole("button", { name: "확인 후 개정 등록" }).click();
  const sourceResult = await responseJson<{
    drawing: { id: string; version: number };
    binding: { id: string; drawingRef: DomainRef; evidenceRef: DomainRef };
    approval: ApprovalRecord | null;
  }>(await sourceResponse, 201);
  const source = sourceResult;
  expect(source.binding.drawingRef.objectId).toBe(source.drawing.id);
  expect(source.binding.evidenceRef).toEqual({ objectType: "Evidence", objectId: evidence.id, version: evidence.version });
  expect(source.approval, "DES source registration should create the canonical technical Approval").toBeTruthy();

  const { session: adminSession } = await captureSession(page, "ADM");
  let workspace = await responseJson<Workspace>(
    await request.get(`/api/projects/${adminSession.projectId}/workspace`, { headers: headers(adminSession) }),
    200,
  );
  await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
  const recipient = workspace.participants.find(person => person.actorGroup === "CON");
  expect(recipient, "field register requires an active construction recipient").toBeTruthy();

  const panel = page.getByTestId("drawing-field-management");
  await expect(panel).toBeVisible();
  await panel.getByLabel("연결된 PDF 도면").selectOption(source.binding.id);
  await panel.getByLabel("도면번호").fill(drawingNo);
  await panel.getByLabel("개정", {exact: true}).fill(drawingRevision);
  await panel.getByLabel("용도").selectOption("construction");
  await panel.locator("label").filter({ hasText: recipient!.name }).locator('input[type="checkbox"]').first().check();
  await panel.getByLabel("연결 승인").selectOption(source.approval!.id);
  const registerResponse = page.waitForResponse(response => response.url().endsWith("/parallel/drawing-field-revisions")
    && response.request().method() === "POST");
  await panel.getByRole("button", { name: "현장 도면 기록 등록" }).click();
  const fieldRecord = await responseJson<FieldRecord>(await registerResponse, 201);
  expect(fieldRecord.drawingNo).toBe(drawingNo);
  expect(fieldRecord.revision).toBe(drawingRevision);
  expect(fieldRecord.drawingRef).toEqual(source.binding.drawingRef);
  expect(fieldRecord.evidenceRef).toEqual(source.binding.evidenceRef);
  expect(fieldRecord.approvalRef).toEqual({ objectType: "Approval", objectId: source.approval!.id, version: source.approval!.version });
  expect(fieldRecord.requiredRecipientPartyIds).toContain(recipient!.partyId);
  expect(fieldRecord.changeRefs).toEqual([]);
  expect(fieldRecord.status).toBe("registered");
  expect(fieldRecord.currentForConstruction).toBe(false);
  const row = page.getByTestId(`drawing-field-record-${fieldRecord.id}`);
  await expect(row.getByText(/현장 사용 · 차단됨/)).toBeVisible();

  // The source creator remains DES; SUP reviews and approves the canonical Approval in the drawing workspace.
  await switchRole(page, "SUP");
  await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
  const approvalCard = page.getByTestId(`drawing-approval-${source.approval!.id}`);
  await expect(approvalCard).toBeVisible();
  const reviewResponse = page.waitForResponse(response => response.url().endsWith(`/approvals/${source.approval!.id}/review`)
    && response.request().method() === "POST");
  await approvalCard.getByRole("button", { name: "기술 검토 시작", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "확인 후 실행" }).click();
  expect((await reviewResponse).ok()).toBeTruthy();
  await expect(approvalCard).toContainText(/기술검토|검토 중/);
  const approveResponse = page.waitForResponse(response => response.url().endsWith(`/approvals/${source.approval!.id}/approve`)
    && response.request().method() === "POST");
  await approvalCard.getByRole("button", { name: "기술 승인", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "확인 후 실행" }).click();
  expect((await approveResponse).ok()).toBeTruthy();
  await expect(approvalCard).toContainText("승인됨");
  const approvedWorkspace = await responseJson<Workspace>(
    await request.get(`/api/projects/${adminSession.projectId}/workspace`, { headers: headers(adminSession) }),
    200,
  );
  const approvedApproval = approvedWorkspace.items.find(item => item.machine === "approval" && item.record.id === source.approval!.id);
  expect(approvedApproval).toBeTruthy();
  expect(approvedApproval!.record.status).toBe("approved");
  const approval = { id: source.approval!.id, version: approvedApproval!.record.version, status: String(approvedApproval!.record.status) };

  // Switch to ADM so its workspace contains the approved, current version of the exact drawing Approval.
  workspace = await switchRole(page, "ADM");
  await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
  const adminRow = page.getByTestId(`drawing-field-record-${fieldRecord.id}`);
  await expect(adminRow).toBeVisible();
  const basis = adminRow.getByLabel(`승인 근거 ${drawingNo}`);
  const option = basis.locator("option").filter({ hasText: approval.id });
  await expect(option).toContainText(`v${approval.version}`);
  await basis.selectOption(approval.id);
  const basisResponse = page.waitForResponse(response => response.url().endsWith(`/parallel/drawing-field-revisions/${fieldRecord.id}/commands`)
    && response.request().method() === "POST");
  await adminRow.getByRole("button", { name: "승인 근거 갱신" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "확인하고 요청" }).click();
  const basisUpdated = await responseJson<FieldRecord>(await basisResponse, 200);
  expect(basisUpdated.approvalRef).toEqual({ objectType: "Approval", objectId: approval.id, version: approval.version });
  expect(basisUpdated.currentForConstruction).toBe(false);

  // SUP authorizes the field issue only after the current technical Approval has been linked.
  await switchRole(page, "SUP");
  await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
  const supRow = page.getByTestId(`drawing-field-record-${fieldRecord.id}`);
  await expect(supRow.getByRole("button", { name: "현장 사용본 발행" })).toBeVisible();
  const releaseResponse = page.waitForResponse(response => response.url().endsWith(`/parallel/drawing-field-revisions/${fieldRecord.id}/commands`)
    && response.request().method() === "POST");
  await supRow.getByRole("button", { name: "현장 사용본 발행" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "확인하고 요청" }).click();
  const released = await responseJson<FieldRecord>(await releaseResponse, 200);
  expect(released.status).toBe("released");
  expect(released.currentForConstruction).toBe(false);

  // ADM records distribution; delivery is not treated as receipt.
  await switchRole(page, "ADM");
  await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
  const distributionRow = page.getByTestId(`drawing-field-record-${fieldRecord.id}`);
  const distributionCheckbox = distributionRow.locator("fieldset").filter({ hasText: "배포 대상 선택" }).getByRole("checkbox");
  await distributionCheckbox.check();
  const distributeResponse = page.waitForResponse(response => response.url().endsWith(`/parallel/drawing-field-revisions/${fieldRecord.id}/commands`)
    && response.request().method() === "POST");
  await distributionRow.getByRole("button", { name: "배포 기록" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "확인하고 요청" }).click();
  const distributed = await responseJson<FieldRecord>(await distributeResponse, 200);
  expect(distributed.receipts?.find(item => item.recipientPartyId === recipient!.partyId)?.deliveredAt).toBeTruthy();
  expect(distributed.receipts?.find(item => item.recipientPartyId === recipient!.partyId)?.receivedAt).toBeNull();
  expect(distributed.currentForConstruction).toBe(false);

  // Construction user records their own receipt, then the server marks the revision current for construction.
  await switchRole(page, "CON");
  await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
  const conRow = page.getByTestId(`drawing-field-record-${fieldRecord.id}`);
  const acknowledgeResponse = page.waitForResponse(response => response.url().endsWith(`/parallel/drawing-field-revisions/${fieldRecord.id}/commands`)
    && response.request().method() === "POST");
  await conRow.getByRole("button", { name: "수령 확인" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "확인하고 요청" }).click();
  const acknowledged = await responseJson<FieldRecord>(await acknowledgeResponse, 200);
  expect(acknowledged.fieldDistributionComplete).toBe(true);
  expect(acknowledged.currentForConstruction).toBe(true);
  expect(acknowledged.receipts?.find(item => item.recipientPartyId === recipient!.partyId)?.receivedAt).toBeTruthy();
  await expect(conRow.getByText(/현장 사용 · 가능 · 모든 필수 수령자가 수령 확인/)).toBeVisible();

  const historyResponse = await request.get(`/api/projects/${adminSession.projectId}/parallel/drawing-field-revisions/${fieldRecord.id}/history`, {
    headers: headers(adminSession),
  });
  const history = await responseJson<{ items: Array<{ event: string; actorPartyId: string }> }>(historyResponse, 200);
  const events = history.items.map(item => item.event);
  for (const event of ["registered", "update_basis", "release", "distribute", "acknowledge"]) expect(events).toContain(event);
  await expect(conRow.getByRole("button", { name: "변경 이력 보기" })).toBeVisible();
  await conRow.getByRole("button", { name: "변경 이력 보기" }).click();
  await expect(conRow.getByText("수령 확인", { exact: true })).toBeVisible();
});
