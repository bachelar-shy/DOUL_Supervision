import { expect, test } from "@playwright/test";

const workspaces = [
  { route: "safety", disclosure: "safety-create-disclosure", form: "safety-authoring-panel" },
  { route: "owner", disclosure: "owner-create-disclosure", form: "owner-decision-authoring" },
] as const;

for (const width of [390, 1440]) {
  test("safety and owner drafts open contextually after the record list at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const item of workspaces) {
      await page.goto("/#/" + item.route);
      const disclosure = page.locator('[data-ui-component="' + item.disclosure + '"]');
      const summary = disclosure.locator("summary");
      const form = disclosure.locator('[data-ui-component="' + item.form + '"]');
      const list = page.locator('[data-ui-component="resizable-workspace"] .record-row').first();
      await expect(summary).toBeVisible();
      await expect(disclosure).not.toHaveAttribute("open");
      await expect(form).toBeHidden();
      await expect(list, item.route + ": list stays available without opening form").toBeVisible();
      if (item.route === "safety") {
        const safetyList = page.locator('[data-ui-component="safety-workspace"] .list-pane');
        await expect(safetyList.locator(':scope > [data-ui-component="list-record-count"]')).toBeVisible();
        await expect(safetyList.locator(':scope > .section-heading')).toHaveCount(0);
      }
      const listRect = await list.boundingBox();
      expect(listRect?.y, item.route + ": list is in first viewport").toBeLessThan(800);
      await page.screenshot({
        path: "preview/screenshots/fieldwire-list-first-" + item.route + "-" + width + ".png",
        fullPage: false,
      });
      const touchHeight = await summary.evaluate(element => element.getBoundingClientRect().height);
      expect(touchHeight, item.route + ": usable summary target").toBeGreaterThanOrEqual(width < 768 ? 44 : 38);
      await summary.click();
      await expect(disclosure).toHaveAttribute("open", "");
      await expect(form).toBeVisible();
      const title = form.locator('input').first();
      await title.fill("화면 시험용 초안");
      await summary.click();
      await expect(form).toBeHidden();
      await summary.click();
      await expect(title).toHaveValue("화면 시험용 초안");
      const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(pageOverflow, item.route + ": no horizontal page overflow").toBeLessThanOrEqual(2);
    }
  });
}


test("Owner counters and process help are compact while keeping the report queue usable", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/owner");
    const summary = page.locator('[data-ui-component="owner-governance-summary"]');
    const cards = summary.locator(":scope > .panel");
    await expect(cards).toHaveCount(3);
    const flow = page.locator('[data-ui-component="owner-governance-flow"]');
    await expect(flow).not.toHaveAttribute("open");
    await expect(flow.locator("summary")).toBeVisible();
    const queue = page.locator('[data-ui-component="resizable-workspace"] .record-row').first();
    await expect(queue).toBeVisible();
    if (width < 768) {
      const positions = await cards.evaluateAll(items => items.map(item => item.getBoundingClientRect().top));
      expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(3);
      const rect = await summary.boundingBox();
      expect(rect!.height, "three counters fit a mobile status strip").toBeLessThanOrEqual(110);
      const y = (await queue.boundingBox())!.y;
      expect(y, "actual record is still in first viewport").toBeLessThan(800);
    }
    await flow.locator("summary").click();
    await expect(flow).toHaveAttribute("open", "");
    await expect(flow.locator(".owner-flow-content")).toBeVisible();
    await flow.locator("summary").click();
    await expect(flow).not.toHaveAttribute("open");
    expect(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(2);
  }
});

test("Today primary capture and inspection actions stay available in compact launcher", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/today");
    const row = page.locator('[data-ui-component="today-header-quick-actions"]');
    await expect(row).toBeVisible();
    await expect(row.getByRole("button").first()).toBeVisible();
    const bounds = await row.boundingBox();
    expect(bounds!.height, "quick create should not dominate first viewport").toBeLessThanOrEqual(width < 768 ? 120 : 100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(2);
  }
});
