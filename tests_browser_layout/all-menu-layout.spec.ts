import { expect, test, type Page } from "@playwright/test";

const allMenus = {
  ADM: [
    "today", "drawings", "inspections", "capture", "observations", "issues",
    "actions", "schedule", "contract", "payment", "completion", "safety",
    "owner", "documents", "registers", "rfis", "admin", "parallel-test",
  ],
  CON: [
    "today", "drawings", "inspections", "capture", "issues", "actions", "schedule",
    "contract", "payment", "completion", "safety", "documents", "registers",
    "rfis", "staff-requests",
  ],
  SUP: [
    "today", "drawings", "inspections", "capture", "observations", "issues",
    "actions", "schedule", "contract", "payment", "completion", "safety",
    "owner", "documents", "registers", "rfis", "staff-requests", "parallel-test",
  ],
  OWN: [
    "today", "drawings", "issues", "schedule", "contract", "payment", "completion",
    "owner", "documents", "registers", "staff-requests",
  ],
} as const;

async function enter(page: Page, role: keyof typeof allMenus) {
  await page.goto("/");
  const chooser = page.locator('[data-ui-component="test-role-login"]');
  await expect(chooser).toBeVisible();
  await chooser.locator('button[data-test-role="' + role + '"]').click();
  await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
  await expect(page.locator('.app-shell[data-layout-system="field-workspace"]')).toBeVisible();
}

for (const role of ["ADM", "CON", "SUP", "OWN"] as const) {
  test(role + " all original menus share the workspace layout", async ({ page }, testInfo) => {
    await enter(page, role);
    const sidebar = page.locator("#side-navigation");
    const main = page.locator('.main-shell main[data-ui-component="workspace-main"]');
    const navRoutes = await sidebar.locator('nav.doul-navigation > button[data-route]')
      .evaluateAll(items => items.map(item => item.getAttribute("data-route")));
    expect(navRoutes).toEqual(allMenus[role]);
    const shellColor = await sidebar.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(shellColor).toBe("rgb(43, 48, 54)");
    await expect(page.getByRole("searchbox", { name: "메뉴 및 업무 검색" })).toBeVisible();

    for (const route of allMenus[role]) {
      await page.evaluate(id => { location.hash = "#/" + id; }, route);
      await expect(page.locator('.app-shell[data-workspace-route="' + route + '"]')).toBeVisible();
      if (route === "drawings") {
        await expect(main.locator('[data-ui-component="drawing-sheet-workspace"] .drawing-sheet-commandbar')).toBeVisible();
      } else {
        await expect(main.locator(".page-heading h1")).toBeVisible();
      }
      await expect(sidebar.locator('nav.doul-navigation button[data-route="' + route + '"]'))
        .toHaveAttribute("aria-current", "page");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      expect(overflow, role + ":" + route + ": horizontal overflow at " + testInfo.project.name).toBe(false);
      const rect = await main.boundingBox();
      expect(rect?.width).toBeGreaterThan(testInfo.project.name === "phone" ? 320 : 900);
    }

    await page.evaluate(() => { location.hash = "#/inspections"; });
    if (allMenus[role].includes("inspections" as never)) {
      await expect(page.locator('[data-ui-component="workbench-list-toolbar"]')).toBeVisible();
      await expect(page.getByRole("searchbox", { name: "목록 검색" })).toBeVisible();
      await page.getByRole("searchbox", { name: "목록 검색" }).fill("NO-SUCH-RECORD");
      await expect(page.locator(".record-row")).toHaveCount(0);
    }
  });
}

test("global search opens the existing menu without changing route labels", async ({ page }) => {
  await enter(page, "CON");
  const search = page.getByRole("searchbox", { name: "메뉴 및 업무 검색" });
  await search.fill("검측");
  const results = page.locator(".workspace-search-results");
  await expect(results).toBeVisible();
  const inspection = results.locator("button").filter({ hasText: /검측/ }).first();
  await inspection.click();
  await expect(page.locator('.app-shell[data-workspace-route="inspections"]')).toBeVisible();
  await expect(page.locator(".workspace-search-results")).toHaveCount(0);
});

test("desktop density toggle persists and mobile menu still opens", async ({ page }, testInfo) => {
  await enter(page, "ADM");
  if (testInfo.project.name === "desktop") {
    const density = page.getByRole("button", { name: "화면 밀도 변경" });
    await expect(density).toHaveAttribute("aria-pressed", "true");
    await density.click();
    await expect(density).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".app-shell.is-compact")).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".app-shell.is-compact")).toHaveCount(0);
  } else {
    await page.getByRole("button", { name: "메뉴 열기" }).click();
    await expect(page.locator("#side-navigation")).toHaveClass(/open/);
    await expect(page.locator("#side-navigation").locator('button[data-route="admin"]')).toBeVisible();
  }
});
