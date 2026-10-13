import { expect, test } from "@playwright/test";

// This checks our repeatable DOUL geometry, not a claim of Fieldwire pixel
// identity. Reference screenshots are reviewed separately before UI sign-off.
// Exclude drawings: the separate drawing implementation has its own owner and
// screenshot contract. Cover every other SUP-accessible full-workspace menu.
const routes = [
  "today", "inspections", "capture", "observations", "issues", "actions",
  "schedule", "contract", "payment", "completion", "safety", "owner",
  "documents", "registers", "rfis", "staff-requests",
] as const;

for (const width of [390, 768, 1024, 1440, 1920]) {
  test("non-drawing menus share one field workspace at " + width + "px", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto("/#/" + route);
      const shell = page.locator('.app-shell[data-layout-system="field-workspace"]');
      await expect(shell).toHaveAttribute("data-workspace-route", route);
      const topbar = await shell.locator(".topbar").boundingBox();
      const main = await shell.locator(".main-shell main").boundingBox();
      const header = await shell.locator(".main-shell main > .page-heading").boundingBox();
      if (!topbar || !main || !header) throw new Error(route + ": workspace boundary missing");
      expect(Math.abs(header.x - main.x), route + ": header alignment").toBeLessThanOrEqual(2);
      expect(header.width, route + ": full-width toolbar").toBeGreaterThan(main.width - 3);
      expect(topbar.height, route + ": compact global header").toBeGreaterThanOrEqual(width < 768 ? 90 : 47);
      expect(topbar.height, route + ": global header not oversized").toBeLessThanOrEqual(width < 768 ? 112 : 50);
      expect(header.height, route + ": page toolbar").toBeGreaterThanOrEqual(
        route === "today" ? 48 : width < 768 ? 53 : 60);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, route + ": horizontal overflow").toBeLessThanOrEqual(2);
      // Record screenshots of every non-drawing menu at both reference widths.
      // The artifact enables real visual comparison; geometry alone cannot
      // certify pixel parity with a third-party application.
      if (width === 390 || width === 1440) {
        await page.screenshot({
          path: "preview/screenshots/fieldwire-nondrawing-" + route + "-" + width + ".png",
          fullPage: false,
        });
      }
    }
  });
}


test("workbench menu has one visible heading and search/count in a single list toolbar", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["issues", "actions", "inspections", "rfis"]) {
      await page.goto("/#/" + route);
      const shell = page.locator('.app-shell[data-layout-system="field-workspace"]');
      await expect(shell.locator(".main-shell main > .page-heading h1")).toBeVisible();
      const workbench = shell.locator('[data-ui-template="workbench"]');
      await expect(workbench.locator(".list-pane > .section-heading")).toHaveCount(0);
      await expect(workbench.locator(".list-pane > h2.sr-only")).toHaveCount(1);
      await expect(workbench.locator(".workbench-list-toolbar")).toBeVisible();
      await expect(workbench.locator(".workbench-list-count")).toBeVisible();
      await expect(workbench.locator(".workbench-list-search input")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow, route + ": horizontal overflow").toBeLessThanOrEqual(2);
    }
  }
});

test("today has only one compact date and new-work toolbar", async ({ page }) => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/today");
    const heading = page.locator('.app-shell[data-workspace-route="today"] .main-shell main > .page-heading');
    const date = heading.locator('[data-ui-component="today-date-context"]');
    const actions = heading.locator('[data-ui-component="today-header-quick-actions"]');
    await expect(date).toBeVisible();
    await expect(actions).toBeVisible();
    await expect(actions.getByRole("button").first()).toBeVisible();
    await expect(page.locator('[data-ui-component="quick-create-launcher"]')).toHaveCount(0);
    await expect(heading.getByRole("button", { name: "새로고침" })).toHaveCount(0);
    await expect(heading.getByRole("button", { name: "현장 촬영" })).toHaveCount(0);
    // Semantics remain available to screen readers, but the duplicate title is not visible.
    await expect(heading.locator("h1")).toHaveText("오늘");
    if (width >= 768) {
      const a = await date.boundingBox(), b = await actions.boundingBox();
      if (!a || !b) throw new Error("Today date or actions missing");
      expect(Math.abs(a.y + a.height / 2 - b.y - b.height / 2)).toBeLessThanOrEqual(9);
    } else {
      const bounds = await actions.getByRole("button").first().boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
  }
});
