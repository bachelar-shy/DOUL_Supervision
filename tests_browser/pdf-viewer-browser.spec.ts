import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

function twoPagePdf(): Buffer {
  const text1 = "BT /F1 24 Tf 72 720 Td (First drawing page) Tj ET";
  const text2 = "BT /F1 24 Tf 72 720 Td (Second drawing page) Tj ET";
  const streams = [text1, text2].map((text) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    streams[0],
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    streams[1],
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

test("uploads a PDF, renders and navigates pages, zooms, and reports a corrupt file", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "도면 작성 차수", exact: true }).click();
  const viewer = page.getByLabel("PDF 도면 보기");
  await expect(viewer).toBeVisible();

  await viewer.getByTestId("pdf-upload").setInputFiles({
    name: "browser-two-page.pdf",
    mimeType: "application/pdf",
    buffer: twoPagePdf(),
  });
  const firstCanvas = viewer.locator("canvas");
  await expect(firstCanvas).toHaveAttribute("aria-label", "PDF 페이지 1 / 2");
  await expect.poll(() => firstCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0)).toBe(true);

  await viewer.getByRole("button", { name: "다음 페이지" }).click();
  await expect(viewer.locator("canvas")).toHaveAttribute("aria-label", "PDF 페이지 2 / 2");
  await expect.poll(() => viewer.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0)).toBe(true);

  const sizeBeforeZoom = await viewer.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.width);
  await viewer.getByRole("button", { name: "확대" }).click();
  await expect(viewer.getByText("110%", { exact: true })).toBeVisible();
  await expect.poll(() => viewer.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(sizeBeforeZoom);

  await viewer.getByTestId("pdf-upload").setInputFiles({
    name: "corrupt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nnot-a-valid-pdf"),
  });
  await expect(viewer.getByRole("alert")).toContainText(/손상되었거나 올바른 PDF가 아닙니다/);
  expect(pageErrors).toEqual([]);

  await mkdir(".local/screenshots", { recursive: true });
  await page.screenshot({ path: ".local/screenshots/pdf-viewer-browser.png", fullPage: true });
});
