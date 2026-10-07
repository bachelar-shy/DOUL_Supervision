import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Workspace } from "../apps/web/src/data/ui-contract";

function pdfWithPages(count: number): Buffer {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const pageRefs: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    pageRefs.push(`${pageId} 0 R`);
    const text = `BT /F1 24 Tf 72 720 Td (Compare fixture page ${index + 1}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(text)} >>\\nstream\\n${text}\\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${count} >>`;
  let body = "%PDF-1.4\\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\\n${object}\\nendobj\\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "ascii");
  body += `xref\\n0 ${objects.length + 1}\\n0000000000 65535 f \\n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \\n`;
  body += `trailer\\n<< /Size ${objects.length + 1} /Root 1 0 R >>\\nstartxref\\n${xrefOffset}\\n%%EOF\\n`;
  return Buffer.from(body, "ascii");
}

test("compares two uploaded PDFs with independent page controls and no compare writes", async ({ page, baseURL }) => {
  let workspace: Workspace | undefined;
  let adminSession: { accessToken: string; projectId: string; actor: { roleAssignmentId: string } } | undefined;
  page.on("response", (response) => {
    if (response.url().endsWith("/dev/sessions") && response.request().method() === "POST") {
      const body = response.request().postData() || "";
      if (body.includes('"actorGroup":"ADM"')) void response.json().then((session) => { adminSession = session; }).catch(() => undefined);
    }
    if (response.url().endsWith("/workspace")) {
      void response.json().then((result: Workspace) => { if (result.role.actorGroup === "ADM") workspace = result; }).catch(() => undefined);
    }
  });

  await page.goto("/#/parallel-test");
  await page.getByLabel("개발 역할 선택").selectOption("ADM");
  await expect.poll(() => workspace?.role.actorGroup).toBe("ADM");
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
  const viewer = page.getByLabel("PDF 도면 뷰어");
  await expect(viewer).toBeVisible();

  const upload = async (filename: string, pages: number) => {
    const complete = page.waitForResponse((response) =>
      response.url().includes("/uploads/") && response.url().endsWith("/complete") && response.request().method() === "POST",
    );
    await viewer.getByTestId("pdf-upload").setInputFiles({ name: filename, mimeType: "application/pdf", buffer: pdfWithPages(pages) });
    const response = await complete;
    expect(response.ok()).toBeTruthy();
    return await response.json() as { id: string; version: number; projectId: string };
  };
  const onePage = await upload(`compare-one-${randomUUID()}.pdf`, 1);
  const twoPages = await upload(`compare-two-${randomUUID()}.pdf`, 2);
  const drawingRef = workspace!.context.drawingRef;
  expect(drawingRef?.objectType).toBe("InformationItem");
  const headers = {
    Authorization: "Bearer " + adminSession!.accessToken,
    "X-RoleAssignment-Id": adminSession!.actor.roleAssignmentId,
  };
  const createBinding = async (evidence: { id: string; version: number }) => {
    const response = await page.request.post(
      String(baseURL) + `/api/projects/${workspace!.project.id}/parallel/drawing-pdf-bindings`,
      {
        headers: { ...headers, "Idempotency-Key": randomUUID() },
        data: { drawingRef, evidenceRef: { objectType: "Evidence", objectId: evidence.id, version: evidence.version } },
      },
    );
    expect(response.ok()).toBeTruthy();
    return await response.json() as { id: string };
  };
  const leftBinding = await createBinding(onePage);
  const rightBinding = await createBinding(twoPages);

  const compareWrites: string[] = [];
  const listener = (request: import("@playwright/test").Request) => { if (request.method() === "POST") compareWrites.push(request.url()); };
  page.on("request", listener);
  await page.getByRole("tab", { name: "도면 비교", exact: true }).click();
  const compare = page.getByLabel("도면 PDF 비교");
  await expect(compare).toBeVisible();
  await compare.getByLabel("왼쪽 도면 연결").selectOption(leftBinding.id);
  await compare.getByLabel("오른쪽 도면 연결").selectOption(rightBinding.id);
  await expect(compare.getByLabel("왼쪽 PDF 페이지 1 / 1")).toBeVisible();
  await expect(compare.getByLabel("오른쪽 PDF 페이지 1 / 2")).toBeVisible();
  await expect.poll(() => compare.locator("canvas").evaluateAll((canvases: HTMLCanvasElement[]) =>
    canvases.length === 2 && canvases.every((canvas) => canvas.width > 0 && canvas.height > 0))).toBe(true);
  await compare.getByLabel("다음 페이지").nth(1).click();
  await expect(compare.getByLabel("오른쪽 PDF 페이지 2 / 2")).toBeVisible();
  await expect(compare.getByLabel("왼쪽 PDF 페이지 1 / 1")).toBeVisible();
  await compare.getByLabel("회전").first().click();
  await compare.getByLabel("확대").nth(1).click();
  await compare.getByLabel("맞춤").last().click();
  expect(compareWrites).toEqual([]);
  page.off("request", listener);
});
