import { expect, test } from "@playwright/test";

test("register menu keeps one visible title and moves directly to chooser, filters and table", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/registers");
    const root = page.locator('[data-ui-template="register"]');
    await expect(root).toBeVisible();
    await expect(page.locator(".main-shell main > .page-heading h1")).toBeVisible();
    await expect(root.locator(":scope > .section-heading")).toHaveCount(0);
    const notice = root.locator('[data-ui-component="register-context-strip"]');
    await expect(notice).toBeVisible();
    await expect(root.locator('[data-ui-component="register-navigator"]')).toBeVisible();
    const rect = await notice.boundingBox();
    expect(rect!.height, "compact read-only status line").toBeLessThanOrEqual(width < 768 ? 100 : 70);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
  }
});
