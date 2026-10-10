import { test, expect } from "@playwright/test";

test("work inbox shows server candidates and requires explicit confirmation before command execution", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "작업함", exact: true }).click();
  await expect(page.getByTestId("work-inbox-actions")).toBeVisible();
  await expect(page.locator(".work-inbox-actions [role=status]").filter({ hasText: "작업함을 불러오는 중" })).toHaveCount(0, { timeout: 15000 });
  const action = page.locator(".work-inbox-card .work-inbox-candidate:not([disabled])").first();
  await expect(action, "server must provide at least one ready or input-requiring command candidate").toBeVisible();
  const record = action.locator("xpath=ancestor::article[contains(@class, 'work-inbox-card')]");
  await expect(record.getByText(/기록번호 .*기록 제\d+차.*상태/)).toBeVisible();
  let transitionPosts = 0;
  const onRequest = (request: { method(): string; url(): string }) => {
    if (request.method() === "POST" && /\/api\/projects\/[^/]+\/[^/]+\/[^/]+\/[^/?]+$/.test(new URL(request.url()).pathname)) transitionPosts++;
  };
  page.on("request", onRequest);
  await action.click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("button", { name: "확인 후 실행" })).toBeVisible();
  await expect(modal.getByRole("button", { name: "취소" })).toBeVisible();
  // Opening a candidate only opens the existing command form; it must not post a transition.
  await expect.poll(() => transitionPosts).toBe(0);
  await modal.getByRole("button", { name: "취소" }).click();
    await expect(modal).toHaveCount(0);
  expect(transitionPosts).toBe(0);
  page.off("request", onRequest);
  expect(errors).toEqual([]);
});
