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
  await expect(row).toContainText("앱에 저장됨 · 알림 등록");

  await page.reload();
  await page.getByRole("tab", { name: "알림", exact: true }).click();
  const restored = page.locator(`[data-notification-id="${notificationId}"]`);
  await expect(restored).toBeVisible();
  await expect(restored).toHaveClass(/is-read/);
  await expect(restored).toContainText("앱에 저장됨 · 알림 등록");
  await expect(restored.getByRole("button", { name: "읽음으로 표시", exact: true })).toHaveCount(0);
});

test("drawing impact notice shows server guidance with the original source", async ({ page }) => {
  await page.route("**/parallel/notifications", async route => {
    const response = await route.fetch();
    const data = await response.json();
    expect(data.items.length).toBeGreaterThan(0);
    data.items[0].drawingImpact = {
      incidentId: "display-fixture",
      drawingRef: { objectType: "InformationItem", objectId: "fixture", version: 1 },
      title: "도면 변경에 따른 업무 재확인",
      message: "구 개정 도면의 사용 조건이 변경되었습니다. 연결 업무를 확인하십시오.",
      reason: "FIELD_SOURCE_UNAVAILABLE", occurredAt: data.items[0].notification.dueAt,
    };
    await route.fulfill({ response, json: data });
  });
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "알림", exact: true }).click();
  await expect(page.getByText("도면 변경에 따른 업무 재확인", { exact: true })).toBeVisible();
  await expect(page.locator('[data-drawing-impact="display-fixture"]')).toContainText("연결 업무를 확인하십시오");
});
