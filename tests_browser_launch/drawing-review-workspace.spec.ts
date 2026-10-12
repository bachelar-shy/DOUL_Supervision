import { expect, test } from "@playwright/test";

test("오늘 화면에서 읽기 전용 도면조회로 이동하고 원본 선택·검색을 제공한다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/today");
  await page.locator("aside.sidebar").getByText("도면조회", { exact: true }).click();
  await expect(page).toHaveURL(/#\/drawings$/);
  const review = page.locator('[data-ui-page="field-drawings"]');
  await expect(review).toBeVisible();
  await expect(review.locator('[data-ui-component="drawing-sheet-workspace"]')).toBeVisible();
  await review.getByRole("searchbox", { name: "도면 검색" }).fill("WWT");
  await expect(review.getByRole("searchbox", { name: "도면 검색" })).toHaveValue("WWT");
  await review.getByRole("button", { name: "기존 PDF 검토" }).click();
  await expect(review.getByRole("heading", { name: "도면 PDF" })).toBeVisible();
  await expect(review.getByRole("combobox", { name: "PDF 원본 선택" })).toBeVisible();
  expect(errors).toEqual([]);
});
