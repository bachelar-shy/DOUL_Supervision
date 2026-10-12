import { expect, test } from "@playwright/test";

test("desktop field record intake uses a compact upload toolbar and right evidence rail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/capture");
  const layout = page.locator('[data-ui-template="capture"]');
  const upload = layout.locator('[data-ui-component="capture-upload-toolbar"]');
  await expect(upload).toBeVisible();
  const toolbar = await upload.boundingBox();
  expect(toolbar?.height ?? 0).toBeLessThan(140);

  const main = layout.locator(":scope > section.panel").first();
  const rail = layout.locator(":scope > .right-stack");
  const leftBox = await main.boundingBox();
  const rightBox = await rail.boundingBox();
  if (!leftBox || !rightBox) throw new Error("Capture panes are missing");
  expect(leftBox.width).toBeGreaterThan(rightBox.width);
  expect(rightBox.width).toBeLessThanOrEqual(340);
  expect(Math.abs(rightBox.x - leftBox.x - leftBox.width)).toBeLessThanOrEqual(16);
  expect(await rail.evaluate(node => getComputedStyle(node).overflowY)).toBe("auto");
  // The evidence rail must not float over the full-width analysis section.
  expect(await rail.evaluate(node => getComputedStyle(node).position)).toBe("relative");

  const inputs = upload.locator('input[type="file"]');
  await expect(inputs).toHaveCount(2);
  await expect(inputs.first()).toHaveAttribute("multiple", "");
  await page.screenshot({ path: "preview/screenshots/fieldwire-capture-desktop.png" });
});

test("phone field record intake keeps capture buttons full width and 44px tall", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/capture");
  const layout = page.locator('[data-ui-template="capture"]');
  const upload = layout.locator('[data-ui-component="capture-upload-toolbar"]');
  await expect(upload).toBeVisible();
  const labels = upload.locator(".upload-label");
  await expect(labels).toHaveCount(2);
  const bounds = await labels.evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }));
  expect(bounds.every(item => item.height >= 44)).toBe(true);
  expect(bounds.every(item => item.width >= 200)).toBe(true);
  const rail = layout.locator(":scope > .right-stack");
  expect(await rail.evaluate(node => getComputedStyle(node).position)).toBe("static");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  await page.screenshot({ path: "preview/screenshots/fieldwire-capture-phone.png" });
});
