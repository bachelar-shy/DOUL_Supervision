import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

function makePdf(pages = 3): Buffer {
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [0];
  let position = chunks[0].length;
  const contents = new Map<number, string>();
  contents.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const ids: string[] = [];
  for (let index = 0; index < pages; index++) {
    const id = 3 + 2 * index;
    ids.push(id + " 0 R");
    contents.set(id, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] " +
      "/Resources << /Font << /F1 " + (3 + 2 * pages) + " 0 R >> >> /Contents " + (id + 1) + " 0 R >>");
    const text = "BT /F1 24 Tf 72 500 Td (DT-" + String(index + 1).padStart(2, "0") + ") Tj ET";
    contents.set(id + 1, "<< /Length " + Buffer.byteLength(text) + " >>\nstream\n" + text + "\nendstream");
  }
  contents.set(2, "<< /Type /Pages /Kids [" + ids.join(" ") + "] /Count " + pages + " >>");
  contents.set(3 + 2 * pages, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let n = 1; n <= contents.size; n++) {
    offsets[n] = position;
    const block = Buffer.from(n + " 0 obj\n" + contents.get(n) + "\nendobj\n");
    chunks.push(block); position += block.length;
  }
  const xrefPosition = position;
  chunks.push(Buffer.from("xref\n0 " + (contents.size + 1) + "\n0000000000 65535 f \n"));
  for (let n = 1; n <= contents.size; n++)
    chunks.push(Buffer.from(String(offsets[n]).padStart(10, "0") + " 00000 n \n"));
  chunks.push(Buffer.from("trailer\n<< /Size " + (contents.size + 1) +
    " /Root 1 0 R >>\nstartxref\n" + xrefPosition + "\n%%EOF\n"));
  return Buffer.concat(chunks);
}

async function login(page: Page, role: "ADM" | "CON" | "SUP" | "OWN") {
  await page.goto("/");
  const chooser = page.locator('[data-ui-component="test-role-login"]');
  await expect(chooser).toBeVisible();
  await chooser.locator('button[data-test-role="' + role + '"]').click();
  await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
  await page.goto("/#/drawings");
  await expect(page.locator('[data-ui-component="drawing-sheet-workspace"]')).toBeVisible();
}

test("one PDF creates three independent thumbnail sheets and Fieldwire-like pane proportions", async ({ page }, testInfo) => {
  await login(page, "CON");
  const view = page.locator('[data-ui-component="drawing-sheet-workspace"]');
  await expect(view.getByRole("button", { name: "새 도면(PDF)" })).toBeVisible();
  const uniqueFolder = testInfo.project.name + "-3장-계단상세-" + randomUUID();
  await view.locator('input[type="file"]').setInputFiles({
    name: uniqueFolder + ".pdf", mimeType: "application/pdf", buffer: makePdf(3),
  });
  await expect(view.getByText(/PDF 3장이 분리 대상으로 등록되었습니다/)).toBeVisible();
  const folder = view.locator(".drawing-sheet-folder").filter({ hasText: uniqueFolder });
  await expect(folder).toBeVisible();
  await expect(folder.locator("button.drawing-sheet-card")).toHaveCount(3);
  await expect(folder.locator("button.drawing-sheet-card").first().locator("img")).toBeVisible({ timeout: 20000 });
  await folder.locator("button.drawing-sheet-card").nth(1).click();
  await expect(view).toHaveAttribute("data-view", "viewer");
  await expect(view.locator(".drawing-board-image-frame img")).toBeVisible({ timeout: 15000 });
  const rail = view.getByRole("complementary", { name: "현재 도면의 검측·현장상황·이슈" });
  await expect(rail).toBeVisible();
  const box = await rail.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(268);
  expect(box?.width).toBeLessThanOrEqual(testInfo.project.name === "phone" ? 282 : 272);
  const main = await view.locator(".drawing-sheet-board").boundingBox();
  expect(main?.width).toBeGreaterThan(testInfo.project.name === "phone" ? 320 : 600);
  await expect(view.getByRole("toolbar", { name: "도면 확대 및 마크업 도구" })).toBeVisible();
  await view.getByRole("button", { name: "확대", exact: true }).click();
  await view.getByRole("button", { name: "도면 맞춤" }).click();
  await view.getByRole("button", { name: "다음 도면" }).click();
  await expect(view.locator(".drawing-board-current-label")).toContainText("Sheet-003");
  await view.getByRole("button", { name: "이전 도면" }).click();
  await expect(view.locator(".drawing-board-current-label")).toContainText("Sheet-002");

  await view.getByRole("button", { name: "정보 수정" }).click();
  const modal = view.getByRole("dialog", { name: "도면 정보 수정" });
  await modal.getByLabel("도면번호").fill("DT-05A");
  await modal.getByLabel("도면명").fill("계단 2 상세도");
  await modal.getByRole("button", { name: "저장" }).click();
  await expect(view.locator(".drawing-board-current-label")).toContainText("DT-05A");
  await view.getByRole("button", { name: "지적·이슈 핀 추가" }).click();
  await view.locator(".drawing-board-image-frame").click({ position: { x: 280, y: 190 } });
  const form = view.getByRole("form", { name: "도면 마크업 핀 작성" });
  await expect(form.getByText("도면 위치 선택 완료", { exact: false })).toBeVisible();
  await form.getByRole("textbox", { name: "내용" }).fill("보 부위 간섭 확인 필요 - 합성 테스트");
  await form.getByRole("button", { name: "핀 저장" }).click();
  await expect(rail.locator(".drawing-issue-row")).toHaveCount(1);
  await expect(view.locator(".drawing-sheet-marker.issue")).toHaveCount(1);
  await rail.locator(".drawing-issue-row").click();
  await expect(view.getByRole("dialog", { name: /도면 이슈 상세/ })).toBeVisible();
  await view.getByRole("button", { name: "이슈 상세 닫기" }).click();
  await expect(view.locator(".drawing-sheet-marker.issue.active")).toHaveCount(1);

  // On the same sheet, inspection and site-status markers must appear beside the issue.
  for (const pinCase of [
    { button: "검측 핀 추가", label: "합성 검측 위치 확인", marker: "inspection" },
    { button: "현장상황 핀 추가", label: "합성 현장상황 위치 기록", marker: "site" },
  ]) {
    await view.getByRole("button", { name: pinCase.button }).click();
    const coordinate = pinCase.marker === "inspection" ? { x: 145, y: 105 } : { x: 220, y: 85 };
    await view.locator(".drawing-board-image-frame").click({ position: coordinate });
    const pinForm = view.getByRole("form", { name: "도면 마크업 핀 작성" });
    await expect(pinForm.getByText("도면 위치 선택 완료", { exact: false })).toBeVisible();
    await pinForm.getByRole("textbox", { name: "내용" }).fill(pinCase.label);
    await pinForm.getByRole("button", { name: "핀 저장" }).click();
    await expect(view.locator(".drawing-sheet-marker." + pinCase.marker)).toHaveCount(1);
    await expect(rail.locator(".drawing-issue-row").getByText(pinCase.label, { exact: true })).toBeVisible();
  }
  await expect(rail.locator(".drawing-issue-row")).toHaveCount(3);
  await rail.getByRole("button", { name: "검측 1" }).click();
  await expect(rail.locator(".drawing-issue-row")).toHaveCount(1);
  await rail.getByRole("button", { name: "전체 3" }).click();
  // A markup is a separate, durable overlay rather than an edit of the source PDF.
  await view.getByRole("button", { name: "사각형" }).click();
  const overlay = view.locator("svg.drawing-board-markup-layer");
  const dimensions = await overlay.boundingBox();
  expect(dimensions).not.toBeNull();
  if (!dimensions) throw new Error("Markup overlay bounds unavailable");
  await page.mouse.move(dimensions.x + dimensions.width * 0.2, dimensions.y + dimensions.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(dimensions.x + dimensions.width * 0.6, dimensions.y + dimensions.height * 0.5, {steps: 4});
  await page.mouse.up();
  await expect(view.locator(".drawing-markup-rail-count")).toContainText("1개");
  await expect(overlay.locator("g > rect")).toHaveCount(1);
  await view.getByRole("button", { name: "마크업 실행취소" }).click();
  await expect(view.locator(".drawing-markup-rail-count")).toContainText("0개");
  await view.getByRole("button", { name: "마크업 다시 실행" }).click();
  await expect(view.locator(".drawing-markup-rail-count")).toContainText("1개");

  // The revision cloud is a curved SVG path, not the former dashed rectangle.
  await view.getByRole("button", { name: "수정구름" }).click();
  await page.mouse.move(dimensions.x + dimensions.width * 0.15, dimensions.y + dimensions.height * 0.62);
  await page.mouse.down();
  await page.mouse.move(dimensions.x + dimensions.width * 0.54, dimensions.y + dimensions.height * 0.82, { steps: 7 });
  await page.mouse.up();
  await expect(view.locator(".drawing-markup-rail-count")).toContainText("2개");
  await expect(overlay.locator("g > path")).toHaveCount(1);
  const cloudPath = await overlay.locator("g > path").getAttribute("d");
  expect(cloudPath).toMatch(/Q [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+/);
  await view.getByRole("button", { name: "이동 도구" }).click();


  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "CON");
  await expect(view).toHaveAttribute("data-view", "catalog");
  await view.locator(".drawing-sheet-folder").filter({ hasText: uniqueFolder }).locator(".drawing-sheet-card").filter({ hasText: "DT-05A" }).click();
  await expect(view.locator(".drawing-markup-rail-count")).toContainText("2개");
  await expect(view.locator("svg.drawing-board-markup-layer g > path")).toHaveCount(1);
  await expect(rail.locator(".drawing-issue-row")).toHaveCount(3);
  for (const label of ["보 부위 간섭 확인 필요 - 합성 테스트", "합성 검측 위치 확인", "합성 현장상황 위치 기록"]) {
    await expect(rail.getByText(label, { exact: false })).toBeVisible();
  }
});

test("owner reads only the intended sheet but cannot upload or create issue", async ({ page }, testInfo) => {
  await login(page, "ADM");
  const view = page.locator('[data-ui-component="drawing-sheet-workspace"]');
  // Other browser cases intentionally retain their drawings. Identify only
  // the PDF uploaded by this case, not the full project's cumulative count.
  const folderName = testInfo.project.name + "-owner-permissions-" + randomUUID();
  await view.locator('input[type="file"]').setInputFiles({
    name: folderName + ".pdf", mimeType: "application/pdf", buffer: makePdf(1),
  });
  const folder = view.locator(".drawing-sheet-folder").filter({ hasText: folderName });
  await expect(folder.locator(".drawing-sheet-card")).toHaveCount(1);
  await expect(folder.locator(".drawing-sheet-card img")).toBeVisible({ timeout: 20000 });
  await folder.locator(".drawing-sheet-card").click();
  await expect(view.locator(".drawing-board-image-frame img")).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "OWN");
  await expect(view.getByRole("button", { name: "새 도면(PDF)" })).toHaveCount(0);
  const ownerFolder = view.locator(".drawing-sheet-folder").filter({ hasText: folderName });
  await expect(ownerFolder.locator(".drawing-sheet-card")).toHaveCount(1);
  await ownerFolder.locator(".drawing-sheet-card").click();
  await expect(view.getByRole("button", { name: "새 이슈 마크" })).toHaveCount(0);
  await expect(view.getByRole("button", { name: "지적·이슈 핀 추가" })).toHaveCount(0);
  await expect(view.locator(".drawing-board-image-frame img")).toBeVisible({ timeout: 15000 });
});

test("mobile 390px stays on sheet and opens issue panel", async ({ page }, testInfo) => {
  if (testInfo.project.name !== "phone") return;
  await login(page, "SUP");
  const view = page.locator('[data-ui-component="drawing-sheet-workspace"]');
  const folderName = "mobile-issue-rail-" + randomUUID();
  await view.locator('input[type="file"]').setInputFiles({
    name: folderName + ".pdf", mimeType: "application/pdf", buffer: makePdf(1),
  });
  const folder = view.locator(".drawing-sheet-folder").filter({ hasText: folderName });
  await expect(folder.locator(".drawing-sheet-card")).toHaveCount(1);
  await expect(folder.locator(".drawing-sheet-card img")).toBeVisible({ timeout: 20000 });
  await folder.locator(".drawing-sheet-card").click();
  await expect(view.locator(".drawing-board-tools")).toBeVisible();
  await view.getByRole("button", { name: "이슈 목록" }).click();
  await view.getByRole("button", { name: "이슈 목록" }).click();
  await expect(view.getByRole("complementary", { name: "현재 도면의 검측·현장상황·이슈" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
});
