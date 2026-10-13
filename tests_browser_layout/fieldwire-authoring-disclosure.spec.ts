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
      const listRect = await list.boundingBox();
      expect(listRect?.y, item.route + ": list is in first viewport").toBeLessThan(800);
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
