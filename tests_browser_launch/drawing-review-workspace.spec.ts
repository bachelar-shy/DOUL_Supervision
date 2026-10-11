import { expect, test } from "@playwright/test";

test("오늘 화면에서 도면 검토 메뉴로 이동하고 도면 목록과 이동 도구를 제공한다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/today");
  await page.locator("aside.sidebar").getByText("도면조회", { exact: true }).click();
  await expect(page).toHaveURL(/#\/drawings$/);
  const review = page.locator('[data-ui-page="field-drawings"]');
  await expect(review).toBeVisible();
  await expect(review.getByRole("searchbox")).toBeVisible();
  await expect(review.getByText("도면의 승인 상태·개정·현장 배포 여부는 별도로 확인하십시오.")).toBeVisible();
  await expect(review.getByRole("button", { name: "마크업·지적사항" })).toBeVisible();
  await review.getByRole("button", { name: "마크업·지적사항" }).click();
  await expect(review.getByText("도면에서 저장된 마크업을 선택하면 연결된 지적사항과 시정조치를 확인할 수 있습니다.")).toBeVisible();
  await expect(review.locator('[data-testid="pdf-upload"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
