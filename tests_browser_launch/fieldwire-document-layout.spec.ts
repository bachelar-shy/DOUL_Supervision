import { expect, test } from "@playwright/test";

async function showEditor(page: import("@playwright/test").Page) {
  await page.goto("/#/owner");
  await page.getByRole("tab", { name: "감리 양식" }).click();
  const workspace = page.locator('[data-ui-template="document"]');
  await expect(workspace).toBeVisible();
  await expect(workspace.getByLabel("문서 양식")).toBeVisible();
  return workspace;
}

test("document editor stays left and A4 preview stays right with separate scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const workspace = await showEditor(page);
  const editor = workspace.locator(".editor-pane");
  const preview = workspace.locator(".preview-pane");
  const left = await editor.boundingBox();
  const right = await preview.boundingBox();
  if (!left || !right) throw new Error("Expected two document panes");
  expect(right.x, "preview starts after editor").toBeGreaterThan(left.x + left.width);
  expect(right.width, "preview takes more workspace width").toBeGreaterThan(left.width);
  expect(left.width, "editor remains wide enough for forms").toBeGreaterThan(290);
  expect(await editor.evaluate(node => getComputedStyle(node).overflowY)).toBe("auto");
  expect(await preview.evaluate(node => getComputedStyle(node).overflowY)).toBe("auto");
  expect(await preview.locator(".preview-header").evaluate(node => getComputedStyle(node).position)).toBe("sticky");
  const input = workspace.getByLabel("문서 양식");
  const box = await input.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(35);
  expect(box?.height ?? 999).toBeLessThanOrEqual(40);
  expect(await workspace.locator(".document-fields").evaluate(node => getComputedStyle(node).overflowY)).toBe("visible");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  await page.screenshot({ path: "preview/screenshots/fieldwire-document-desktop.png" });
});

test("document input and controls use finger-sized targets on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const workspace = await showEditor(page);
  const editor = workspace.locator(".editor-pane");
  const preview = workspace.locator(".preview-pane");
  await expect(editor).toBeVisible();
  await expect(preview).toBeVisible();
  for (const control of [
    workspace.getByLabel("문서 양식"),
    workspace.getByLabel("문서 원본 선택"),
    editor.getByRole("button", { name: "초안 미리보기 생성" }),
  ]) {
    const bounds = await control.boundingBox();
    expect(bounds?.height ?? 0, "phone authoring controls >=44px").toBeGreaterThanOrEqual(43.5);
  }
  const left = await editor.boundingBox();
  const right = await preview.boundingBox();
  if (!left || !right) throw new Error("Expected stacked mobile document panels");
  expect(right.y).toBeGreaterThan(left.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  await page.screenshot({ path: "preview/screenshots/fieldwire-document-phone.png" });
});
