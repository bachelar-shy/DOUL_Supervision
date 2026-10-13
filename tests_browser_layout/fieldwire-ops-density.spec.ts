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
      const tabs = shell.locator('.operational-tabs-workspace .operational-toolbar-tabs > [data-slot="tabs-list"]').first();
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


test("operational list headers show only a localized count, not the selected tab title again", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [route, component] of [
    ["schedule", "schedule-workspace"],
    ["contract", "contract-workspace"],
    ["payment", "measurement-payment-workspace"],
    ["completion", "completion-handover-workspace"],
  ] as const) {
    await page.goto("/#/" + route);
    const list = page.locator('[data-ui-component="' + component + '"] .list-pane').first();
    await expect(list).toBeVisible();
    const listHead = list.locator(':scope > [data-ui-component="operational-list-head"]');
    await expect(listHead).toBeVisible();
    await expect(listHead.locator('[data-ui-component="list-record-count"]')).toBeVisible();
    await expect(listHead.getByRole("button").first()).toBeVisible();
    await expect(list.locator(':scope > .section-heading')).toHaveCount(0);
    const countLabel = (await list.locator('[data-ui-component="list-record-count"]').textContent())?.trim();
    expect(countLabel, route + ": real translated item count").toMatch(/\d/);
  }
});


test("operational list count and create action share one compact line at desktop and stay usable on phone", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [route, component] of [
      ["schedule", "schedule-workspace"],
      ["contract", "contract-workspace"],
      ["payment", "measurement-payment-workspace"],
      ["completion", "completion-handover-workspace"],
    ] as const) {
      await page.goto("/#/" + route);
      const head = page.locator('[data-ui-component="' + component + '"] [data-ui-component="operational-list-head"]').first();
      await expect(head).toBeVisible();
      const count = head.locator('[data-ui-component="list-record-count"]');
      const create = head.getByRole("button").first();
      await expect(count).toBeVisible();
      await expect(create).toBeVisible();
      const countBox = await count.boundingBox();
      const createBox = await create.boundingBox();
      expect(countBox && createBox, route + ": list header control geometry").toBeTruthy();
      if (width === 1440) {
        const countCenter = countBox!.y + countBox!.height / 2;
        const createCenter = createBox!.y + createBox!.height / 2;
        expect(Math.abs(countCenter - createCenter), route + ": count and create align").toBeLessThanOrEqual(9);
      } else {
        expect(createBox!.height, route + ": finger-sized create control").toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), route + ": page overflow").toBeLessThanOrEqual(2);
    }
  }
});


test("all operational menus keep their tabs and view controls on the same line", async ({ page }) => {
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const menu of menus) {
      await page.goto("/#/" + menu);
      const root = page.locator('[data-ui-component="' + (
        menu === "payment" ? "measurement-payment" : menu === "completion" ? "completion-handover" : menu
      ) + '-workspace"] .operational-tabs-workspace');
      await expect(root).toBeVisible();
      const tabs = root.locator('.operational-toolbar-tabs > [data-slot="tabs-list"]');
      const controls = root.locator(".doul-layout-controls");
      await expect(tabs).toBeVisible();
      const button = controls.locator('[data-layout-action="first"]');
      const mobileMode = controls.locator('[data-ui-component="mobile-view-mode"]');
      if (width >= 768) {
        await expect(button).toBeVisible();
        await expect(mobileMode).toBeHidden();
        const a = await tabs.boundingBox(), b = await button.boundingBox();
        expect(a && b, menu + ": tabs and action button mounted").toBeTruthy();
        expect(Math.abs(a!.y - b!.y), menu + ": same command row").toBeLessThanOrEqual(7);
      } else {
        await expect(mobileMode).toBeVisible();
        await expect(button).toBeHidden();
        const rect = await mobileMode.boundingBox();
        expect(rect!.height, menu + ": mobile touch height").toBeGreaterThanOrEqual(44);
        await mobileMode.selectOption("first");
        await expect(root).toHaveAttribute("data-view", "first");
        await mobileMode.selectOption("split");
      }
      const triggers = tabs.locator('[data-slot="tabs-trigger"]');
      const first = triggers.first();
      await expect(first).toBeVisible();
      await first.click();
      await expect(first).toHaveAttribute("data-state", "active");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), menu + ": no body overflow").toBeLessThanOrEqual(2);
    }
  }
});
