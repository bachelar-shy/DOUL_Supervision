import { expect, test } from "@playwright/test";

test("full development navigation keeps a single Issues entry and no field-core aliases", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("doul.locale", "en"));
  await page.goto("/#/today");
  const menu = page.getByRole("navigation");
  // The dedicated field-core menu replaces (rather than duplicates) the
  // original detailed modules only when VITE_DOUL_UI_SCOPE=field-core.
  await expect(menu.getByRole("button", { name: /issues/i })).toHaveCount(1);
  await expect(menu.getByRole("button", { name: "Issues · Corrections" })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: "Drawings", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: "Drawings · Review", exact: true })).toHaveCount(1);
});
