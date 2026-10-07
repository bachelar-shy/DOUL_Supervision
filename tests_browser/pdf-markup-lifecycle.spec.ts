import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { DomainRef, Workspace } from "../apps/web/src/data/ui-contract";

function onePagePdf(): Buffer {
  const text = "BT /F1 24 Tf 72 720 Td (Markup integration drawing page) Tj ET";
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

test("edits and tombstones a rectangle memo while preserving its version history", async ({ page, baseURL }) => {
  let adminSession: { accessToken: string; projectId: string; actor: { roleAssignmentId: string } } | undefined;
  let adminWorkspace: Workspace | undefined;
  page.on("response", (response) => {
    if (response.url().endsWith("/dev/sessions") && response.request().method() === "POST") {
      const body = response.request().postData() || "";
      if (body.includes('"actorGroup":"ADM"')) void response.json().then((value) => { adminSession = value; }).catch(() => undefined);
    }
    if (response.url().endsWith("/workspace")) void response.json().then((value: Workspace) => {
      if (value.role.actorGroup === "ADM") adminWorkspace = value;
    }).catch(() => undefined);
  });
  const headers = () => {
    if (!adminSession) throw new Error("ADM session was not captured");
    return { Authorization: `Bearer ${adminSession.accessToken}`, "X-RoleAssignment-Id": adminSession.actor.roleAssignmentId };
  };
  const api = async (path: string) => page.request.get(`${baseURL}/api/projects/${adminWorkspace!.project.id}${path}`, { headers: headers() });

  await page.goto("/#/parallel-test");
  const rolePicker = page.getByLabel("개발 역할 선택");
  if (await rolePicker.inputValue() !== "ADM") await rolePicker.selectOption("ADM");
  await expect.poll(() => adminWorkspace?.role.actorGroup).toBe("ADM");
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
  const viewer = page.getByLabel("PDF 도면 뷰어");
  await expect(viewer).toBeVisible();

  let bindingsResponse = await api("/parallel/drawing-pdf-bindings");
  expect(bindingsResponse.ok()).toBeTruthy();
  let bindingsData = await bindingsResponse.json() as { items: Array<{ id: string; drawingRef: DomainRef; evidenceRef: DomainRef }> };
  if (bindingsData.items.length === 0) {
    const uploadDone = page.waitForResponse((response) => response.url().includes("/uploads/") && response.url().endsWith("/complete") && response.request().method() === "POST");
    await viewer.getByTestId("pdf-upload").setInputFiles({ name: `markup-${randomUUID()}.pdf`, mimeType: "application/pdf", buffer: onePagePdf() });
    const uploaded = await uploadDone;
    expect(uploaded.ok()).toBeTruthy();
    const evidence = await uploaded.json() as { id: string; version: number };
    const bindingPanel = page.getByRole("region", { name: "도면 PDF 연결" });
    const drawingRef = adminWorkspace!.context.drawingRef;
    await bindingPanel.getByLabel("도면 버전").selectOption(`${drawingRef.objectType}:${drawingRef.objectId}:${drawingRef.version}`);
    await bindingPanel.getByLabel("PDF 원본").selectOption(`Evidence:${evidence.id}:${evidence.version}`);
    const bindResponse = page.waitForResponse((response) => response.url().endsWith("/parallel/drawing-pdf-bindings") && response.request().method() === "POST");
    await bindingPanel.getByRole("button", { name: "선택한 버전 연결" }).click();
    expect((await bindResponse).status()).toBe(201);
    bindingsResponse = await api("/parallel/drawing-pdf-bindings");
    bindingsData = await bindingsResponse.json() as typeof bindingsData;
  }
  expect(bindingsData.items.length).toBeGreaterThan(0);
  const binding = bindingsData.items[0];
  const evidenceId = binding.evidenceRef.objectId;
  await viewer.getByLabel("PDF 원본 선택").selectOption(evidenceId);
  await expect(viewer.locator("canvas")).toHaveAttribute("aria-label", /PDF 페이지 1 \/ /);
  await expect.poll(() => viewer.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0)).toBe(true);

  const memo = `QA markup ${randomUUID()}`;
  await viewer.getByRole("button", { name: "사각형 메모 추가" }).click();
  const markupLayer = viewer.locator(".pdf-markup-layer");
  await markupLayer.scrollIntoViewIfNeeded();
  await expect(markupLayer).toHaveClass(/is-drawing/);
  await expect(viewer.getByRole("status", { name: "페이지를 표시하는 중…" })).toHaveCount(0);
  const box = await markupLayer.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.62, box!.y + box!.height * 0.48, { steps: 8 });
  await page.mouse.up();
  await expect(viewer.locator(".pdf-markup-shape.is-pending")).toBeVisible();
  await viewer.getByLabel("주석 메모").fill(memo);
  const postResponse = page.waitForResponse((response) => response.url().endsWith("/parallel/drawing-markups") && response.request().method() === "POST");
  await viewer.getByRole("button", { name: "주석 저장" }).click();
  const posted = await postResponse;
  expect(posted.status()).toBe(201);
  expect(posted.request().headers()["idempotency-key"]).toBeTruthy();
  expect(posted.request().postDataJSON()).toMatchObject({ bindingId: binding.id, page: 1, text: memo });
  const created = await posted.json() as { id: string; rect: { x1: number; y1: number; x2: number; y2: number } };
  expect(created.rect.x1).toBeLessThan(created.rect.x2);
  expect(created.rect.y1).toBeLessThan(created.rect.y2);

  const listResponse = await api(`/parallel/drawing-markups?bindingId=${encodeURIComponent(binding.id)}`);
  expect(listResponse.ok()).toBeTruthy();
  const markups = await listResponse.json() as { items: Array<{ id: string; text: string; bindingId: string }> };
  expect(markups.items).toContainEqual(expect.objectContaining({ id: created.id, text: memo, bindingId: binding.id }));
  await expect(viewer.getByRole("list", { name: "저장된 도면 주석" }).getByRole("button", { name: new RegExp(memo) })).toBeVisible();
  await viewer.getByRole("button", { name: "회전" }).click();
  await expect(viewer.getByLabel(`주석: ${memo}`)).toBeVisible();
  await viewer.getByLabel("PDF 원본 선택").selectOption("");
  await viewer.getByLabel("PDF 원본 선택").selectOption(evidenceId);
  await expect(viewer.getByRole("list", { name: "저장된 도면 주석" }).getByRole("button", { name: new RegExp(memo) })).toBeVisible();

  const reload = await api(`/parallel/drawing-markups/${created.id}`);
  expect(reload.ok()).toBeTruthy();
  expect(await reload.json()).toMatchObject({ id: created.id, bindingId: binding.id, page: 1, text: memo });

  await viewer.getByRole("list", { name: "저장된 도면 주석" }).getByRole("button", { name: new RegExp(memo) }).click();
  await expect(viewer.getByRole("button", { name: "주석 수정" })).toBeVisible();
  await viewer.getByRole("button", { name: "주석 수정" }).click();
  const revisedMemo = `${memo} revised`;
  await viewer.getByLabel("주석 메모").fill(revisedMemo);
  await viewer.getByLabel("주석 수정 사유").fill("clarified note");
  const putResponse = page.waitForResponse((response) => response.url().endsWith(`/parallel/drawing-markups/${created.id}`) && response.request().method() === "PUT");
  await viewer.getByRole("button", { name: "수정 저장" }).click();
  const put = await putResponse;
  expect(put.status()).toBe(200);
  expect(put.request().headers()["idempotency-key"]).toBeTruthy();
  expect(put.request().postDataJSON()).toMatchObject({ expectedVersion: 1, text: revisedMemo, reason: "clarified note" });
  expect(await put.json()).toMatchObject({ id: created.id, version: 2, text: revisedMemo });
  await expect(viewer.getByRole("button", { name: "주석 수정" })).toBeVisible();

  await viewer.getByRole("button", { name: /이력 보기/ }).click();
  await expect(viewer.getByRole("list", { name: "주석 이력" }).getByText(new RegExp(memo))).toBeVisible();
  await expect(viewer.getByRole("list", { name: "주석 이력" }).getByText(new RegExp(revisedMemo))).toBeVisible();
  await expect(viewer.getByRole("list", { name: "주석 이력" }).getByText(/clarified note/)).toBeVisible();
  await viewer.getByRole("button", { name: "주석 삭제" }).click();
  await viewer.getByLabel("주석 삭제 사유").fill("superseded drawing note");
  const deleteResponse = page.waitForResponse((response) => response.url().endsWith(`/parallel/drawing-markups/${created.id}`) && response.request().method() === "DELETE");
  await viewer.getByRole("button", { name: "삭제 확인" }).click();
  const deleted = await deleteResponse;
  expect(deleted.status()).toBe(200);
  expect(deleted.request().headers()["idempotency-key"]).toBeTruthy();
  expect(deleted.request().postDataJSON()).toMatchObject({ expectedVersion: 2, reason: "superseded drawing note" });
  expect(await deleted.json()).toMatchObject({ id: created.id, version: 3, deletedAt: expect.any(String), deleteReason: "superseded drawing note" });
  const tombstone = await api(`/parallel/drawing-markups/${created.id}`);
  expect(await tombstone.json()).toMatchObject({ id: created.id, deletedAt: expect.any(String) });
  const historyResponse = await api(`/parallel/drawing-markups/${created.id}/history`);
  expect((await historyResponse.json() as { items: unknown[] }).items).toHaveLength(3);
  const listAfterDelete = await api(`/parallel/drawing-markups?bindingId=${encodeURIComponent(binding.id)}`);
  expect((await listAfterDelete.json() as { items: Array<{ id: string }> }).items.some((item) => item.id === created.id)).toBe(false);

});
