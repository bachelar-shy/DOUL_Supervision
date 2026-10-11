import { expect, test } from "@playwright/test";

// This suite exercises the actual combined PR #169-173 source tree on the UI
// mock adapter, and captures screenshots for review. Not a production sign-off.
test("PR #169-173 field UI integrated showcase screenshots", async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/today");
  await expect(page.locator("main")).toBeVisible();
  await page.screenshot({ path: "preview/screenshots/01-today-desktop.png", fullPage: true });

  await page.goto("/#/owner");
  await page.getByRole("tab", { name: "감리 양식" }).click();
  await page.getByLabel("문서 양식").selectOption("FM-21");
  await page.getByLabel("문서 원본 선택").selectOption("DEC-UI-001");
  await page.locator('input[name="decision.issue"]').fill("발주처 승인 요청 시범 문구");
  await expect(page.locator('input[name="decision.issue"]')).toHaveValue("발주처 승인 요청 시범 문구");
  await page.screenshot({ path: "preview/screenshots/02-decision-form.png", fullPage: true });

  await page.getByLabel("문서 양식").selectOption("FM-02");
  await page.getByRole("textbox", { name: "review.design" }).fill("도면 적합성 확인");
  await page.getByRole("textbox", { name: "review.quality" }).fill("시험결과 첨부 필요");
  await page.screenshot({ path: "preview/screenshots/03-review-table.png", fullPage: true });

  await page.goto("/#/capture");
  await page.getByLabel("증빙 파일 선택").setInputFiles([
    { name: "zone-a-column.jpg", mimeType: "image/jpeg", buffer: Buffer.from("synthetic-evidence-demo-a") },
    { name: "zone-b-column.jpg", mimeType: "image/jpeg", buffer: Buffer.from("synthetic-evidence-demo-b") },
  ]);
  await expect(page.getByText("기기 저장 · 제출 대기 2건")).toBeVisible();
  await page.screenshot({ path: "preview/screenshots/04-batch-evidence.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/today");
  await page.screenshot({ path: "preview/screenshots/05-today-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});
