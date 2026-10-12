import { expect, test, type Page } from "@playwright/test";

async function computed(page: Page, selector: string, property: string) {
  return page.locator(selector).first().evaluate((element, key) =>
    getComputedStyle(element).getPropertyValue(key).trim(), property);
}

test("DOUL desktop controls keep Fieldwire density and DOUL brand", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/today");
  const shell = page.locator('.app-shell[data-layout-system="field-workspace"]');
  await expect(shell).toBeVisible();
  expect(await computed(page, ".sidebar", "width")).toBe("208px");
  expect(await computed(page, ".topbar", "height")).toBe("48px");
  expect(await computed(page, ".app-shell", "--fw-ui-control-height")).toBe("34px");
  expect(await computed(page, ".app-shell", "--fw-ui-primary")).toBe(
    await computed(page, ".app-shell", "--doul-color-brand"));
  expect(await computed(page, ".sidebar nav", "scrollbar-width")).toBe("thin");
});

test("DOUL plan workspace places compact commands within the shared frame", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/drawings");
  const workspace = page.locator('[data-ui-component="drawing-sheet-workspace"]');
  await expect(workspace).toBeVisible();
  await expect(workspace.locator(".drawing-sheet-commandbar")).toBeVisible();
  expect(parseFloat(await computed(page, ".drawing-sheet-commandbar", "min-height"))).toBe(46);
  expect(await computed(page, ".app-shell", "--fw-ui-tool-size")).toBe("34px");
  expect(await computed(page, ".app-shell", "--fw-ui-issue-rail")).toContain("clamp(");
  await expect(workspace.getByRole("searchbox", { name: "도면 검색" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
});

test("DOUL phone keeps larger action targets and task drawer geometry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/drawings");
  const workspace = page.locator('[data-ui-component="drawing-sheet-workspace"]');
  await expect(workspace).toBeVisible();
  expect(await computed(page, ".app-shell", "--fw-ui-control-height")).toBe("44px");
  expect(await computed(page, ".app-shell", "--fw-ui-tool-size")).toBe("36px");
  const viewButton = workspace.getByRole("button", { name: "썸네일 보기" });
  await expect(viewButton).toBeVisible();
  const bounds = await viewButton.boundingBox();
  expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
});
