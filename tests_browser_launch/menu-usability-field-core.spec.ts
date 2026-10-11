import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Role = "SUP" | "CON" | "OWN" | "ADM" | "DES";
const menu = JSON.parse(readFileSync(resolve("app/reference/menu_usability_v1.json"), "utf8")) as {
  menuProfiles: { fieldCore: { navigationByRole: Record<Role, string[]> } };
};

for (const role of ["SUP", "CON", "OWN", "ADM", "DES"] as Role[]) {
  test("field-core launch navigation exposes only the expected tasks for " + role, async ({ page }) => {
    await page.goto("/#/today");
    if (role !== "SUP") await page.getByLabel("시험 사용자 역할 선택").selectOption(role);
    const nav = page.locator('aside.sidebar [data-ui-component="navigation"]');
    await expect(nav).toBeVisible();
    await expect(nav.locator("button[data-route]")).toHaveCount(menu.menuProfiles.fieldCore.navigationByRole[role].length);
    const actual = await nav.locator("button[data-route]").evaluateAll(
      (nodes) => nodes.map((node) => node.getAttribute("data-route")),
    );
    expect(actual, role + " should see only the stage-one field workflows").toEqual(
      menu.menuProfiles.fieldCore.navigationByRole[role],
    );
    await expect(nav.locator('button[data-route="drawings"]')).toHaveCount(1);
    await expect(nav.locator('button[data-route="parallel-test"]')).toHaveCount(0);
    await expect(nav.locator('button[data-route="payment"]')).toHaveCount(0);
    await expect(nav.locator('button[data-route="today"]')).toHaveAttribute("aria-current", "page");
  });
}

test("field-core drawing entry is read-only and does not expose development-only tools", async ({ page }) => {
  await page.goto("/#/today");
  const drawings = page.locator('aside.sidebar [data-ui-component="navigation"] button[data-route="drawings"]');
  await expect(drawings).toContainText("도면조회");
  await drawings.click();
  await expect(page).toHaveURL(/#\/drawings$/);
  await expect(drawings).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-ui-page="field-drawings"]')).toBeVisible();
  await expect(page.locator('[data-testid="pdf-upload"]')).toHaveCount(0);
  await expect(page.locator('[data-ui-page="drawings"]')).toHaveCount(0);
});

test("field-core menu can scroll on a low-height screen and navigation is safe", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 340 });
  await page.goto("/#/today");
  const nav = page.locator('aside.sidebar [data-ui-component="navigation"]');
  await expect(nav).toHaveCSS("overflow-y", "auto");
  const first = nav.locator("button[data-route]").first();
  const last = nav.locator("button[data-route]").last();
  await expect(first).toHaveCount(1);
  await nav.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(last).toBeInViewport();
  await last.click();
  await expect(last).toHaveAttribute("aria-current", "page");
});

test("field-core mobile menu opens by More, navigates, and closes safely", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 620 });
  await page.goto("/#/today");
  const sidebar = page.locator("aside.sidebar");
  await expect(sidebar).toHaveCSS("visibility", "hidden");
  const more = page.locator('[data-ui-component="mobile-navigation"] button').last();
  await expect(more).toHaveAttribute("aria-controls", "side-navigation");
  await more.click();
  await expect(sidebar).toHaveCSS("visibility", "visible");
  await sidebar.locator('button[data-route="drawings"]').click();
  await expect(page).toHaveURL(/#\/drawings$/);
  await expect(sidebar).toHaveCSS("visibility", "hidden");
  await expect(page.locator('[data-ui-page="field-drawings"]')).toBeVisible();
});

test("field-core unsupported URL returns to the permitted starting menu", async ({ page }) => {
  await page.goto("/#/schedule");
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.locator('aside.sidebar [data-ui-component="navigation"] button[data-route="today"]'))
    .toHaveAttribute("aria-current", "page");
  await expect(page.locator('aside.sidebar [data-ui-component="navigation"] button[data-route="schedule"]'))
    .toHaveCount(0);
});
