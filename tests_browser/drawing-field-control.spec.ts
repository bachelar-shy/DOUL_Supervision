import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { DomainRef, Workspace } from "../apps/web/src/data/ui-contract";

type AdminSession = {
  accessToken: string;
  projectId: string;
  actor: { partyId: string; roleAssignmentId: string };
};

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

test("registers a reviewed source Drawing into the server's field control projection", async ({ page, request }) => {
  const suffix = randomUUID().slice(0, 8);
  const drawingNo = `DES-${suffix}`;
  const drawingRevision = "R0";
  let adminSession: AdminSession | null = null;
  let workspace: Workspace | null = null;
  const adminSessionReady = new Promise<void>(resolve => {
    page.on("response", response => {
      if (response.url().endsWith("/dev/sessions") && response.request().method() === "POST"
        && (response.request().postData() || "").includes('"actorGroup":"ADM"')) {
        void response.json().then((value: AdminSession) => { adminSession = value; resolve(); }).catch(() => undefined);
      }
    });
  });
  const adminWorkspaceReady = new Promise<Workspace>(resolve => {
    page.on("response", response => {
      if (response.url().endsWith("/workspace") && response.ok()) {
        void response.json().then((data: Workspace) => {
          if (data.role.actorGroup === "ADM") { workspace = data; resolve(data); }
        }).catch(() => undefined);
      }
    });
  });

  await page.goto("/#/parallel-test");
  const rolePicker = page.getByRole("combobox", { name: "개발 역할 선택" });
  if (await rolePicker.inputValue() !== "ADM") await rolePicker.selectOption("ADM");
  await adminSessionReady;
  workspace = await adminWorkspaceReady;

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

  const session = adminSession!;
  const sourceResponse = await request.post(`/api/projects/${session.projectId}/parallel/drawing-sources`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "X-RoleAssignment-Id": session.actor.roleAssignmentId,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      objectId: randomUUID(),
      title: `DES field control source ${suffix}`,
      revision: drawingRevision,
      evidenceRef: { objectType: "Evidence", objectId: evidence.id, version: evidence.version },
      predecessorRef: null,
      requestReview: true,
    },
  });
  expect(sourceResponse.ok()).toBeTruthy();
  const source = await sourceResponse.json() as {
    drawing: { id: string; version: number; title?: string };
    binding: { id: string; drawingRef: DomainRef; evidenceRef: DomainRef };
    approval: { id: string; version: number; status?: string } | null;
  };
  expect(source.binding.drawingRef.objectId).toBe(source.drawing.id);
  expect(source.binding.evidenceRef).toEqual({ objectType: "Evidence", objectId: evidence.id, version: evidence.version });
  expect(source.approval, "source registration should create the canonical review Approval").toBeTruthy();

  const refreshedWorkspace = page.waitForResponse(response => response.url().endsWith("/workspace") && response.ok());
  await page.reload();
  workspace = await (await refreshedWorkspace).json() as Workspace;
  await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
  const recipient = workspace.participants.find(person => person.actorGroup === "CON");
  expect(recipient, "field register requires an active project recipient").toBeTruthy();

  const panel = page.getByTestId("drawing-field-management");
  await expect(panel).toBeVisible();
  await panel.getByLabel("연결된 PDF 도면").selectOption(source.binding.id);
  await panel.getByLabel("도면번호").fill(drawingNo);
  await panel.getByLabel("개정").fill(drawingRevision);
  await panel.getByLabel("용도").selectOption("construction");
  await panel.locator("label").filter({ hasText: recipient!.name }).locator('input[type="checkbox"]').first().check();
  await panel.getByLabel("연결 승인").selectOption(source.approval!.id);
  const registerResponse = page.waitForResponse(response => response.url().endsWith("/parallel/drawing-field-revisions")
    && response.request().method() === "POST");
  await panel.getByRole("button", { name: "현장 도면 기록 등록" }).click();
  const response = await registerResponse;
  expect(response.status()).toBe(201);
  const fieldRecord = await response.json() as {
    id: string; version: number; status: string; drawingRef: DomainRef;
    evidenceRef: DomainRef; approvalRef: DomainRef | null; drawingNo: string; revision: string;
    requiredRecipientPartyIds: string[]; changeRefs: DomainRef[]; currentForConstruction: boolean;
  };
  expect(fieldRecord.drawingNo).toBe(drawingNo);
  expect(fieldRecord.revision).toBe(drawingRevision);
  expect(fieldRecord.drawingRef).toEqual(source.binding.drawingRef);
  expect(fieldRecord.evidenceRef).toEqual(source.binding.evidenceRef);
  expect(fieldRecord.approvalRef).toEqual({ objectType: "Approval", objectId: source.approval!.id, version: source.approval!.version });
  expect(fieldRecord.requiredRecipientPartyIds).toContain(recipient!.partyId);
  expect(fieldRecord.changeRefs).toEqual([]);
  expect(fieldRecord.status).toBe("registered");
  expect(fieldRecord.currentForConstruction).toBe(false);
  await expect(panel.getByText(new RegExp(`${drawingNo} · 개정 ${drawingRevision}`))).toBeVisible();
  await expect(panel.getByText(/현장 사용 · 차단됨/)).toBeVisible();
});
