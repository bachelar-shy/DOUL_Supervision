import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

function onePagePdf(label: string): Buffer {
  const body = "BT /F1 24 Tf 72 500 Td (" + label + ") Tj ET";
  const objects = new Map<number, string>([
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources " +
      "<< /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"],
    [4, "<< /Length " + Buffer.byteLength(body) + " >>\nstream\n" + body + "\nendstream"],
    [5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
  ]);
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [0];
  let length = chunks[0].length;
  for (let i = 1; i <= objects.size; i++) {
    offsets[i] = length;
    const chunk = Buffer.from(i + " 0 obj\n" + objects.get(i) + "\nendobj\n");
    chunks.push(chunk);
    length += chunk.length;
  }
  const xref = length;
  chunks.push(Buffer.from("xref\n0 6\n0000000000 65535 f \n"));
  for (let i = 1; i <= objects.size; i++)
    chunks.push(Buffer.from(String(offsets[i]).padStart(10, "0") + " 00000 n \n"));
  chunks.push(Buffer.from("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n"));
  return Buffer.concat(chunks);
}

async function openDrawings(page: Page, role: "ADM" | "OWN") {
  await page.goto("/");
  const login = page.locator('[data-ui-component="test-role-login"]');
  await expect(login).toBeVisible();
  await login.locator('button[data-test-role="' + role + '"]').click();
  await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
  await page.goto("/#/drawings");
  const workspace = page.locator('[data-ui-component="drawing-sheet-workspace"]');
  await expect(workspace).toBeVisible();
  return workspace;
}

async function createVersionSheet(page: Page, folder: string, drawingNumber: string, label: string) {
  const view = page.locator('[data-ui-component="drawing-sheet-workspace"]');
  await view.locator('input[type="file"]').setInputFiles({
    name: folder + ".pdf", mimeType: "application/pdf", buffer: onePagePdf(label),
  });
  const group = view.locator(".drawing-sheet-folder").filter({hasText: folder});
  await expect(group.locator(".drawing-sheet-card")).toHaveCount(1);
  await expect(group.locator(".drawing-sheet-card img")).toBeVisible({timeout: 25000});
  await group.locator(".drawing-sheet-card").click();
  await expect(view.locator(".drawing-board-image-frame img")).toBeVisible();
  await view.getByRole("button", {name: "정보 수정"}).click();
  const edit = view.getByRole("dialog", {name: "도면 정보 수정"});
  await edit.getByLabel("도면번호").fill(drawingNumber);
  await edit.getByLabel("도면명").fill("Revision " + label);
  await edit.getByRole("button", {name: "저장"}).click();
  await expect(view.locator(".drawing-board-current-label")).toContainText(drawingNumber);
  await view.getByRole("button", {name: "전체 도면"}).click();
}

test("original PDF versions require explicit matching and support authorized compare", async ({page}) => {
  const view = await openDrawings(page, "ADM");
  const nonce = randomUUID().slice(0, 8);
  const number = "RV-" + nonce.toUpperCase();
  const folderA = "REV-A-" + nonce;
  const folderB = "REV-B-" + nonce;
  await createVersionSheet(page, folderA, number, "A");
  await createVersionSheet(page, folderB, number, "B");

  await view.locator(".drawing-sheet-folder").filter({hasText: folderB})
    .locator(".drawing-sheet-card").click();
  await view.getByRole("button", {name: "도면 버전 관리"}).click();
  const dialog = view.getByRole("dialog", {name: "도면 개정 관리"});
  await expect(dialog).toBeVisible();
  const form = dialog.getByRole("form", {name: "이전 원본 도면 연결"});
  await expect(form).toBeVisible();
  await form.getByRole("combobox", {name: "이전 도면"}).selectOption({index: 1});
  await form.getByRole("textbox", {name: "이전 개정"}).fill("01");
  await form.getByRole("textbox", {name: "신규 개정"}).fill("02");
  await form.getByRole("textbox", {name: "개정 사유"}).fill("Revision A to B test");
  await form.getByRole("button", {name: "개정 이력 연결"}).click();
  await expect(dialog.getByText("개정 이력(미승인)이 연결되었습니다.")).toBeVisible();
  await expect(dialog.locator(".drawing-revision-older img")).toBeVisible({timeout: 20000});
  await expect(dialog.locator(".drawing-revision-newer img")).toBeVisible({timeout: 20000});
  await dialog.getByRole("button", {name: "겹쳐 보기"}).click();
  await expect(dialog.getByText(/기준점이 다른 도면/)).toBeVisible();
  await dialog.getByRole("slider").focus();
  await dialog.getByRole("slider").press("ArrowRight");
  await dialog.getByRole("button", {name: "도면 개정 관리 닫기"}).click();

  await page.getByRole("button", {name: "로그아웃", exact: true}).click();
  const ownerView = await openDrawings(page, "OWN");
  await ownerView.locator(".drawing-sheet-folder").filter({hasText: folderB})
    .locator(".drawing-sheet-card").click();
  await ownerView.getByRole("button", {name: "도면 버전 관리"}).click();
  const readOnly = ownerView.getByRole("dialog", {name: "도면 개정 관리"});
  await expect(readOnly.locator(".drawing-revision-list > button")).toHaveCount(1);
  await expect(readOnly.getByRole("form", {name: "이전 원본 도면 연결"})).toHaveCount(0);
  await expect(readOnly.locator(".drawing-revision-newer img")).toBeVisible({timeout: 20000});
});
