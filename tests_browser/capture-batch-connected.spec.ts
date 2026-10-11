import { expect, test } from "@playwright/test";

test("connected batch transfer creates two evidence originals and empties only confirmed local queue", async ({ page }) => {
  test.setTimeout(120_000);
  const completed: string[] = [];
  page.on("response", response => {
    if (response.request().method() === "POST" &&
        /\/uploads\/[^/]+\/complete$/.test(new URL(response.url()).pathname) &&
        response.status() === 201) completed.push(response.url());
  });
  await page.goto("/#/capture");
  const original = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRkQAAAAASUVORK5CYII=", "base64"
  );
  await page.getByLabel("증빙 파일 선택").setInputFiles([
    { name: "batch-evidence-a.png", mimeType: "image/png", buffer: original },
    { name: "batch-evidence-b.png", mimeType: "image/png", buffer: Buffer.concat([original, Buffer.from("different-evidence")]) },
  ]);
  await expect(page.getByText("기기 저장 · 제출 대기 2건")).toBeVisible();
  const send = page.getByRole("button", { name: "대기 파일 일괄 전송" });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText("기기 저장 · 제출 대기 0건")).toBeVisible({ timeout: 60_000 });
  expect(completed).toHaveLength(2);
  await page.reload();
  await expect(page.getByText("기기 저장 · 제출 대기 0건")).toBeVisible();
});
