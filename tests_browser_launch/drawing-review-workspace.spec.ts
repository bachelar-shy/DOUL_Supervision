import { expect, test } from "@playwright/test";

test("오늘 화면에서 읽기 전용 도면조회로 이동하고 원본 선택·검색을 제공한다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/today");
  await page.locator("aside.sidebar").getByText("도면조회", { exact: true }).click();
  await expect(page).toHaveURL(/#\/drawings$/);
  const review = page.locator('[data-ui-page="field-drawings"]');
  await expect(review).toBeVisible();
  await expect(review.getByRole("searchbox")).toBeVisible();
  await expect(review.getByText("도면의 승인 상태·개정·현장 배포 여부는 별도로 확인하십시오.")).toBeVisible();
  await expect(review.getByRole("combobox", { name: "PDF 원본 선택" })).toBeVisible();
  await review.getByRole("searchbox").fill("WWT");
  await expect(review.getByRole("searchbox")).toHaveValue("WWT");
  await expect(review.locator('[data-testid="pdf-upload"]')).toHaveCount(0);
  await expect(review.locator(".pdf-markup-controls, .pdf-pin-controls")).toHaveCount(0);
  await expect(review.getByRole("tab", { name: "도면 관리" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
