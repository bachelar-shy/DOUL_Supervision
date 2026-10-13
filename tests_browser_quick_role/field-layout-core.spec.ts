import { expect, test } from "@playwright/test";

const fieldMenus = {
  ADM: ["today", "capture", "drawings", "inspections", "corrections", "owner", "admin"],
  SUP: ["today", "capture", "drawings", "inspections", "corrections", "owner", "staff-requests"],
  CON: ["today", "capture", "drawings", "inspections", "corrections", "staff-requests"],
  OWN: ["today", "drawings", "corrections", "owner", "staff-requests"],
} as const;

for (const role of ["ADM", "SUP", "CON", "OWN"] as const) {
  test("original stage-one routes use shared Fieldwire-like layout: " + role, async ({ page }) => {
    await page.goto("/");
    await page.locator('button[data-test-role="' + role + '"]').click();
    await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
    const shell = page.locator('.app-shell[data-layout-system="field-workspace"]');
    await expect(shell).toBeVisible();
    await expect(page.locator('[data-ui-component="decision-panel"]')).toHaveCount(0);
    const nav = page.locator("#side-navigation nav.doul-navigation");
    expect(await nav.locator("button[data-route]").evaluateAll(nodes =>
      nodes.map(node => node.getAttribute("data-route")))).toEqual(fieldMenus[role]);
    await expect(page.getByRole("searchbox", { name: "메뉴 및 업무 검색" })).toBeVisible();

    for (const route of fieldMenus[role]) {
      await page.evaluate(value => { location.hash = "#/" + value; }, route);
      await expect(shell).toHaveAttribute("data-workspace-route", route);
      if (route === "drawings") await expect(page.locator('[data-ui-component="drawing-sheet-workspace"] .drawing-sheet-commandbar')).toBeVisible();
      else await expect(page.locator(".main-shell main .page-heading h1")).toBeVisible();
      await expect(nav.locator('button[data-route="' + route + '"]')).toHaveAttribute("aria-current", "page");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
    }
    if (fieldMenus[role].includes("inspections" as never)) {
      await page.evaluate(() => { location.hash = "#/inspections"; });
      await expect(page.locator('[data-ui-component="workbench-list-toolbar"]')).toBeVisible();
      await expect(page.getByRole("searchbox", { name: "목록 검색" })).toBeVisible();
    }
  });
}
