import { test, expect } from "@playwright/test";

test("work inbox shows server candidates and requires explicit confirmation before command execution", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#/work-inbox");
  await expect(page.getByTestId("work-inbox-actions")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "작업함을 불러오는 중" })).toHaveCount(0);
  const record = page.locator(".work-inbox-card").first();
  await expect(record).toBeVisible();
  await expect(record.getByText(/ID .*v\d+.*상태/)).toBeVisible();
  const action = record.locator(".work-inbox-candidate:not([disabled])").first();
  if (await action.count()) {
    let commandPosts = 0;
    page.on("request", request => { if (request.method() === "POST" && /commands|execute/.test(request.url())) commandPosts++; });
    await action.click();
    const modal = page.getByRole("dialog");
    await expect(modal.getByRole("button", { name: "확인 후 실행" })).toBeVisible();
    await expect(modal.getByRole("button", { name: "취소" })).toBeVisible();
    // Opening a candidate only opens the existing command form; it must not post a transition.
    expect(await page.evaluate(() => performance.getEntriesByType("resource").some(entry => /commands|execute/.test(entry.name)))).toBeFalsy();
    await modal.getByRole("button", { name: "취소" }).click();
    await expect(modal).toHaveCount(0);
    expect(commandPosts).toBe(0);
  }
  expect(errors).toEqual([]);
});
