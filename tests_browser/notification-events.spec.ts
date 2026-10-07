import { expect, test } from "@playwright/test";

test("notification read receipt survives reload without changing delivery status", async ({ page }) => {
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "알림", exact: true }).click();

  const unread = page.locator(".notification-events-list li.is-unread").first();
  await expect(unread).toBeVisible();
  const notificationId = await unread.getAttribute("data-notification-id");
  expect(notificationId).toBeTruthy();
  const row = page.locator(`[data-notification-id="${notificationId}"]`);
  const readResponse = page.waitForResponse((response) =>
    response.url().includes("/parallel/notifications/")
      && response.url().endsWith("/read")
      && response.request().method() === "POST",
  );
  await unread.getByRole("button", { name: "읽음으로 표시", exact: true }).click();
  const response = await readResponse;
  expect(response.status()).toBe(200);
  expect((await response.json()).isRead).toBe(true);
  await expect(row).toHaveClass(/is-read/);
  await expect(row).toContainText("앱에 저장됨 · queued");

  await page.reload();
  await page.getByRole("tab", { name: "알림", exact: true }).click();
  const restored = page.locator(`[data-notification-id="${notificationId}"]`);
  await expect(restored).toBeVisible();
  await expect(restored).toHaveClass(/is-read/);
  await expect(restored).toContainText("앱에 저장됨 · queued");
  await expect(restored.getByRole("button", { name: "읽음으로 표시", exact: true })).toHaveCount(0);
});
