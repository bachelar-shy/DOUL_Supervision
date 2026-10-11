import { expect, test, type Page } from "@playwright/test";

async function metric(page: Page, selector: string, property: string): Promise<string> {
  return page.locator(selector).first().evaluate(
    (element, cssProperty) => getComputedStyle(element).getPropertyValue(cssProperty).trim(),
    property,
  );
}

test("Quiet Graphite A: 1440px tokens, 208/64 navigation and persisted collapse", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/today");
  await expect(page.locator(".app-shell")).toHaveAttribute("data-design-system", "quiet-graphite-a");
  expect(await metric(page, ".topbar", "height")).toBe("56px");
  expect(await metric(page, ".sidebar", "width")).toBe("208px");
  expect(await metric(page, ".main-shell", "margin-left")).toBe("208px");
  expect(await metric(page, ".page-heading h1", "font-size")).toBe("24px");
  expect(await metric(page, "body", "font-size")).toBe("14px");
  expect(await metric(page, ".sidebar", "background-color")).toBe("rgb(242, 244, 245)");
  await expect(page.locator(".sidebar nav button")).toHaveCount(6);
  await page.screenshot({ path: "preview/screenshots/06-quiet-graphite-1440.png", fullPage: true });

  await page.getByRole("button", { name: "왼쪽 메뉴 접기" }).click();
  expect(await metric(page, ".sidebar", "width")).toBe("64px");
  expect(await metric(page, ".main-shell", "margin-left")).toBe("64px");
  await expect(page.locator(".sidebar nav button").first()).toHaveAttribute("title", /.+/);
  await page.screenshot({ path: "preview/screenshots/07-quiet-graphite-collapsed.png", fullPage: true });
  await page.reload();
  expect(await metric(page, ".sidebar", "width")).toBe("64px");
  await page.getByRole("button", { name: "왼쪽 메뉴 펼치기" }).click();
  expect(await metric(page, ".sidebar", "width")).toBe("208px");
});

for (const width of [1024, 768, 390]) {
  test(`Quiet Graphite A: responsive layout at ${width}px, no clipped content`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#/today");
    await expect(page.locator(".page-heading h1")).toBeVisible();
    expect(await metric(page, ".topbar", "height")).toBe("56px");
    expect(await metric(page, ".page-heading h1", "font-size")).toBe("24px");
    expect(await metric(page, ".sidebar", "width")).toBe(width <= 390 ? "288px" : "64px");
    expect(await metric(page, ".main-shell", "margin-left")).toBe(width <= 390 ? "0px" : "64px");
    const pageWidth = await page.evaluate(() =>
      ({ viewport: window.innerWidth, bodyScroll: document.documentElement.scrollWidth }));
    expect(pageWidth.bodyScroll).toBeLessThanOrEqual(pageWidth.viewport + 2);
    if (width === 390) {
      const nav = page.locator(".bottom-nav button").first();
      await expect(nav).toBeVisible();
      const bounds = await nav.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      await page.locator(".topbar .menu-toggle").click();
      await expect(page.locator(".sidebar.open")).toBeVisible();
      await expect(page.locator(".sidebar nav button").first()).toBeVisible();
    }
    await page.screenshot({ path: `preview/screenshots/08-quiet-graphite-${width}.png`, fullPage: true });
  });
}

test("Quiet Graphite A controls stay labeled after language switch", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/today");
  await page.locator(".topbar .role-picker select").first().selectOption("vi");
  await page.getByRole("button", { name: "Thu gọn menu bên trái" }).click();
  await expect(page.getByRole("button", { name: "Mở rộng menu bên trái" })).toBeVisible();
});
