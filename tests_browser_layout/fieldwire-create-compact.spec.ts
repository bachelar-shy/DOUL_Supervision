import { expect, test } from "@playwright/test";

test("capture has a single record creation entry and two independent intake choices", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/capture");
    await expect(page.locator('[data-ui-component="field-record-create-actions"]')).toHaveCount(0);
    const author = page.locator('[data-ui-component="field-record-panel"]');
    await expect(author).toBeVisible();
    await expect(author.getByRole("button").first()).toBeVisible();
    const intake = page.locator('[data-ui-component="capture-upload-toolbar"]');
    await expect(intake).toBeVisible();
    await expect(intake.locator('input[type="file"]')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(2);
  }
});

test("document source, form, language and draft mode are one responsive metadata group", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/documents");
    const grid = page.locator('[data-ui-component="document-metadata-grid"]');
    await expect(grid).toBeVisible();
    const labels = grid.locator(":scope > label");
    await expect(labels).toHaveCount(4);
    const selects = grid.locator("select");
    await expect(selects).toHaveCount(4);
    const positions = await labels.evaluateAll(els => els.map(el => ({
      x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y,
    })));
    if (width >= 768) {
      expect(Math.abs(positions[0].y - positions[1].y), "first two controls share row").toBeLessThanOrEqual(3);
      expect(positions[0].x, "controls stay in separate columns").toBeLessThan(positions[1].x);
    } else {
      expect(positions[0].y, "mobile controls stack").toBeLessThan(positions[1].y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(2);
  }
});
