import { expect, test } from "@playwright/test";

// Fieldwire-inspired operational tabs must remain one line, scroll in their
// own navigation strip, and never cause document-level horizontal overflow.
const menus = ["schedule", "safety", "contract", "payment", "completion"] as const;

for (const width of [390, 768, 1024, 1440]) {
  test("operational tab geometry and row density at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const menu of menus) {
      await page.goto("/#/" + menu);
      const shell = page.locator('.app-shell[data-layout-system="field-workspace"]');
      const tabs = shell.locator('[data-ui-component$="-workspace"] > [data-slot="tabs"] > [data-slot="tabs-list"]').first();
      await expect(tabs, menu + ": tab strip").toBeVisible();
      const geometry = await tabs.evaluate(element => {
        const r = element.getBoundingClientRect();
        const triggers = Array.from(element.querySelectorAll('[data-slot="tabs-trigger"]'));
        const top = triggers.map(trigger => trigger.getBoundingClientRect().top);
        return { height: r.height, top, overflowX: getComputedStyle(element).overflowX,
          scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
      });
      expect(geometry.top.length, menu + ": tabs present").toBeGreaterThan(1);
      expect(Math.max(...geometry.top) - Math.min(...geometry.top), menu + ": no wrapping").toBeLessThanOrEqual(2);
      expect(geometry.height, menu + ": compact tab navigation").toBeLessThanOrEqual(width < 768 ? 49 : 42);
      expect(geometry.overflowX, menu + ": locally scrollable").toBe("auto");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow, menu + ": page horizontal overflow").toBeLessThanOrEqual(2);
      if (menu === "payment" || menu === "completion") {
        const row = shell.locator(menu === "payment" ? ".payment-record-row" : ".completion-record-row").first();
        if (await row.count()) {
          await expect(row).toBeVisible();
          await expect(row).toHaveCSS("border-top-width", "0px");
        }
      }
    }
  });
}
