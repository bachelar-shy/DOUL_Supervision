import { expect, test } from "@playwright/test";

test("연결 복구 시 같은 역할의 현장사진 1회 재전송하고 원본은 확인 후 삭제", async ({ page, context }) => {
  test.setTimeout(120_000);
  const completed: string[] = [];
  page.on("response", response => {
    if (response.request().method() === "POST" &&
        /\/uploads\/[^/]+\/complete$/.test(new URL(response.url()).pathname) &&
        response.status() === 201) completed.push(response.url());
  });
  await page.goto("/#/capture");
  await page.getByRole("checkbox", { name: "연결 복구 시 미전송 자료 자동 전송" }).check();
  await context.setOffline(true);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRkQAAAAASUVORK5CYII=",
    "base64"
  );
  await page.locator(".capture-drop input[type='file'][multiple]").setInputFiles({
    name: "field-offline-reconnect.png", mimeType: "image/png", buffer: png,
  });
  await expect(page.locator(".pending-row")).toHaveCount(1, { timeout: 20_000 });
  expect(completed).toHaveLength(0);
  await context.setOffline(false);
  await expect(page.locator(".pending-row")).toHaveCount(0, { timeout: 60_000 });
  expect(completed).toHaveLength(1);
  await page.reload();
  await expect(page.locator(".pending-row")).toHaveCount(0);
  expect(completed).toHaveLength(1);
});
