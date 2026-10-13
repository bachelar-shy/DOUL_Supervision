import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

function onePagePdf(label: string): Buffer {
  const contents = "BT /F1 18 Tf 70 500 Td (" + label + ") Tj ET";
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length " + Buffer.byteLength(contents) + " >>\nstream\n" + contents + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [0];
  let offset = chunks[0].length;
  objects.forEach((body, i) => {
    offsets[i+1] = offset;
    const chunk = Buffer.from((i + 1) + " 0 obj\n" + body + "\nendobj\n");
    chunks.push(chunk); offset += chunk.length;
  });
  chunks.push(Buffer.from("xref\n0 6\n0000000000 65535 f \n"));
  for (let i = 1; i <= objects.length; i++)
    chunks.push(Buffer.from(String(offsets[i]).padStart(10, "0") + " 00000 n \n"));
  chunks.push(Buffer.from("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + offset + "\n%%EOF\n"));
  return Buffer.concat(chunks);
}

async function login(page: import("@playwright/test").Page, role: "CON"|"OWN") {
  await page.goto("/");
  const buttons = page.locator('[data-ui-component="test-role-login"]');
  await expect(buttons).toBeVisible();
  await buttons.locator('button[data-test-role="' + role + '"]').click();
  await expect(page.getByRole("button", {name:"로그아웃", exact:true})).toBeVisible();
}

test("drawing pin has replies, live Today link, clickable pinned thumbnail and colored catalog badges", async ({ page }) => {
  await login(page, "CON");
  await page.goto("/#/drawings");
  const view = page.locator('[data-ui-component="drawing-sheet-workspace"]');
  await expect(view).toBeVisible();
  const nonce = randomUUID().slice(0,8);
  const folder = "E2E-PIN-" + nonce;
  const issue = "E2E 실시간 방수 확인 " + nonce;
  const reply = "E2E 현장 확인 후 회신 " + nonce;
  await view.locator('input[type="file"]').setInputFiles({
    name: folder + ".pdf", mimeType:"application/pdf", buffer:onePagePdf("E2E-" + nonce),
  });
  const group = view.locator(".drawing-sheet-folder").filter({hasText:folder});
  await expect(group.locator(".drawing-sheet-card")).toHaveCount(1);
  await expect(group.locator(".drawing-sheet-card img")).toBeVisible({timeout:25_000});
  await group.locator(".drawing-sheet-card").click();
  const board = view.locator(".drawing-board-image-frame");
  await expect(board.locator("img")).toBeVisible();
  await view.getByRole("button", {name:"지적·이슈 핀 추가"}).click();
  const rect = await board.boundingBox();
  expect(rect).not.toBeNull();
  await board.click({position:{x:Math.round(rect!.width * .5), y:Math.round(rect!.height * .5)}});
  const form = view.getByRole("form", {name:"도면 마크업 핀 작성"});
  await form.getByRole("textbox", {name:"내용"}).fill(issue);
  await form.getByRole("button", {name:"핀 저장"}).click();
  await expect(view.locator(".drawing-sheet-marker.issue")).toHaveCount(1);

  await view.locator(".drawing-issue-row").filter({hasText:issue}).click();
  let dialog = view.getByRole("dialog", {name:/도면 이슈 상세/});
  await expect(dialog).toBeVisible();
  const thread = dialog.getByRole("region", {name:"도면 이슈 댓글과 답글"});
  await thread.getByRole("textbox", {name:"이슈 댓글 입력"}).fill("이슈 검토 요청 " + nonce);
  await thread.getByRole("button", {name:"댓글 등록"}).click();
  await expect(thread.getByText("이슈 검토 요청 " + nonce)).toBeVisible();
  await thread.getByRole("button", {name:"답글",exact:true}).first().click();
  await thread.getByRole("textbox", {name:"이슈 답글 입력"}).fill(reply);
  await thread.getByRole("button", {name:"답글 등록"}).click();
  await expect(thread.getByText(reply)).toBeVisible();
  const pinThumb = dialog.getByRole("button", {name:/도면 열기/});
  await expect(pinThumb.locator(".drawing-thumbnail-pin.issue")).toHaveCount(1);
  await pinThumb.click();
  await expect(dialog).toHaveCount(0);
  await expect(view).toHaveAttribute("data-view", "viewer");

  await page.goto("/#/today");
  const todayIssue = page.locator(".today-pin-activity-row").filter({hasText:issue});
  await expect(todayIssue).toBeVisible({timeout:15_000});
  await expect(todayIssue).toContainText("최근 답글: " + reply);
  await todayIssue.click();
  await expect(view).toHaveAttribute("data-view", "viewer");
  dialog = view.getByRole("dialog", {name:/도면 이슈 상세/});
  await expect(dialog).toBeVisible({timeout:15_000});
  await expect(dialog.getByText(issue)).toBeVisible();
  await expect(dialog.getByRole("button", {name:/도면 열기/})
    .locator(".drawing-thumbnail-pin.issue")).toHaveCount(1);
  await dialog.getByRole("button", {name:"이슈 상세 닫기"}).click();
  await view.getByRole("button", {name:"전체 도면"}).click();
  const card = view.locator(".drawing-sheet-folder").filter({hasText:folder})
    .locator(".drawing-sheet-card");
  await expect(card.locator(".drawing-pin-badge.issue")).toContainText("1");
  await expect(card.locator(".drawing-thumbnail-pin.issue")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);

  await page.getByRole("button", {name:"로그아웃",exact:true}).click();
  await login(page, "OWN");
  await page.goto("/#/today");
  const ownerRow = page.locator(".today-pin-activity-row").filter({hasText:issue});
  await expect(ownerRow).toBeVisible({timeout:15_000});
  await ownerRow.click();
  const ownerDetail = page.getByRole("dialog", {name:/도면 이슈 상세/});
  await expect(ownerDetail).toBeVisible();
  await expect(ownerDetail.getByText(reply)).toBeVisible();
  const ownerThread = ownerDetail.getByRole("region", {name:"도면 이슈 댓글과 답글"});
  await ownerThread.getByRole("textbox", {name:"이슈 댓글 입력"}).fill("발주처 회신 " + nonce);
  await ownerThread.getByRole("button", {name:"댓글 등록"}).click();
  await expect(ownerThread.getByText("발주처 회신 " + nonce)).toBeVisible();
  await ownerDetail.getByRole("button", {name:"이슈 상세 닫기"}).click();
  await expect(view.getByRole("button", {name:"지적·이슈 핀 추가"})).toHaveCount(0);
});
