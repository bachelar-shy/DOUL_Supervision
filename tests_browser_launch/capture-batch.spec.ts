import { expect, test } from "@playwright/test";

test("multi-select stages evidence originals, keeps them across reload, and skips duplicate content", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#/capture");
  const picker = page.getByLabel("증빙 파일 선택");
  await picker.setInputFiles([
    { name: "concrete-zone-a.jpg", mimeType: "image/jpeg", buffer: Buffer.from("test-photo-batch-a") },
    { name: "concrete-zone-b.jpg", mimeType: "image/jpeg", buffer: Buffer.from("test-photo-batch-b") },
  ]);
  await expect(page.getByText("concrete-zone-a.jpg", { exact: true })).toBeVisible();
  await expect(page.getByText("concrete-zone-b.jpg", { exact: true })).toBeVisible();
  await expect(page.getByText("기기 저장 · 제출 대기 2건")).toBeVisible();
  await expect(page.getByRole("button", { name: "대기 파일 일괄 전송" })).toBeDisabled(); // mock cannot issue

  await page.reload();
  await expect(page.getByText("기기 저장 · 제출 대기 2건")).toBeVisible();

  await picker.setInputFiles([
    { name: "same-content-renamed.jpg", mimeType: "image/jpeg", buffer: Buffer.from("test-photo-batch-a") },
  ]);
  await expect(page.getByRole("alert")).toContainText("동일 파일 1개");
  await expect(page.getByText("기기 저장 · 제출 대기 2건")).toBeVisible();
  await expect(page.getByText("same-content-renamed.jpg", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("rejects a selection of more than twenty files without staging a partial batch", async ({ page }) => {
  await page.goto("/#/capture");
  const files = Array.from({ length: 21 }, (_, n) => ({
    name: `too-many-${n}.jpg`, mimeType: "image/jpeg",
    buffer: Buffer.from(`test-photo-cap-${n}`),
  }));
  await page.getByLabel("증빙 파일 선택").setInputFiles(files);
  await expect(page.getByRole("alert")).toContainText("한 번에 최대 20개");
  await expect(page.getByText("기기 저장 · 제출 대기 0건")).toBeVisible();
});
