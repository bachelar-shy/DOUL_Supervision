import { expect, test } from "@playwright/test";

test("safety connected trace follows a real visible stop order without issuing commands", async ({ page }) => {
  const pageErrors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && request.url().includes("/api/")) writes.push(request.method() + " " + request.url());
  });
  await page.goto("/#/safety");
  await expect(page.locator('[data-ui-component="safety-workspace"]')).toBeVisible();
  await page.getByRole("tab", { name: "작업중지", exact: true }).click();
  const stop = page.locator('[data-ui-component="safety-workspace"] .list-pane button').first();
  test.skip(!(await stop.count()), "No visible stop order fixture is available for this role.");
  await stop.click();
  await expect(page.locator('[data-ui-component="safety-connected"]')).toBeVisible();
  await expect(page.getByText("읽기 전용 조회 · 공식 상태 변경 없음", { exact: true })).toBeVisible();
  const traceRequests = page.locator('[data-ui-component="safety-connected"]');
  await expect(traceRequests.getByText(/원본 v\d+/).first()).toBeVisible();
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
});
