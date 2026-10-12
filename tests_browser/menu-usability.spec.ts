import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Role = "SUP" | "CON" | "OWN" | "ADM" | "DES";
type MenuPlan = {
  roleMenus: Record<Role, { visibleRouteIds: string[]; mainTasks: Array<{ goal: string; routeId: string }> }>;
};
const plan = JSON.parse(readFileSync(resolve("app/reference/menu_usability_v1.json"), "utf8")) as MenuPlan;
const roleOrder: Role[] = ["SUP", "CON", "OWN", "ADM", "DES"];
const navSelector = 'aside.sidebar [data-ui-component="navigation"]';

async function openLegacyDrawingReview(page: Page) {
  // The new lightweight per-sheet workspace is the default. Preserve full
  // technical-review assertions via the explicit backwards-compatible entry.
  await expect(page.locator('[data-ui-component="drawing-sheet-workspace"]')).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "도면 검색" })).toBeVisible();
  await page.getByRole("button", { name: "기존 PDF 검토" }).click();
  await expect(page.locator('[data-ui-page="drawings"]')).toBeVisible();
}

async function selectRole(page: Page, role: Role) {
  if (role === "SUP") return;
  const response = page.waitForResponse(
    (item) => item.url().endsWith("/workspace") && item.status() === 200,
    { timeout: 20_000 },
  );
  await page.getByLabel("시험 사용자 역할 선택").selectOption(role);
  await response;
  await expect(page.getByLabel("시험 사용자 역할 선택")).toHaveValue(role);
  await expect(page.locator("main h1")).toBeVisible();
}

for (const role of roleOrder) {
  test("role " + role + " exposes an exact, task-oriented main menu", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto("/#/today");
    await selectRole(page, role);

    const nav = page.locator(navSelector);
    await expect(nav).toBeVisible();
    const expected = plan.roleMenus[role].visibleRouteIds;
    const actual = await nav.locator("button[data-route]").evaluateAll(
      (buttons) => buttons.map((button) => button.getAttribute("data-route")),
    );
    expect(actual, role + " navigation must match role route contract").toEqual(expected);
    await expect(nav.locator('button[aria-current="page"]')).toHaveCount(1);
    await expect(nav.locator('button[data-route="today"]')).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('button[data-route="drawings"]')).toHaveCount(1);
    await expect(nav.locator('button[data-route="documents"]')).toHaveCount(1);
    if (role !== "ADM") {
      await expect(nav.locator('button[data-route="admin"]')).toHaveCount(0);
    }
    if (role === "CON" || role === "DES") {
      await expect(nav.locator('button[data-route="owner"]')).toHaveCount(0);
    }
  });
}

test("field worker finds a drawing through one direct menu action, then switches viewer and comparison", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/today");
  const nav = page.locator(navSelector);
  const entry = nav.locator('button[data-route="drawings"]');
  await expect(entry).toContainText("도면 조회·검토");
  await entry.click();
  await expect(page).toHaveURL(/#\/drawings$/);
  await expect(entry).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-ui-component="drawing-sheet-workspace"]')).toBeVisible();
  await openLegacyDrawingReview(page);
  const view = page.getByRole("tab", { name: "PDF 도면 보기·마킹", exact: true });
  await expect(view).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("PDF 도면 보기", { exact: true })).toBeVisible();
  const compare = page.getByRole("tab", { name: "도면 개정 비교", exact: true });
  await compare.click();
  await expect(compare).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("도면 PDF 비교", { exact: true })).toBeVisible();
  await view.click();
  await expect(view).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".parallel-test-tabs [role=tab]")).toHaveCount(3);
  await expect(page.locator('[data-ui-page="drawings"]')).not.toContainText("미등록 파일 확인");
  expect(errors, "no browser crashes during drawing-tab switch").toEqual([]);
});

test("sidebar remains independently scrollable with all routes reachable on a short screen", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 520 });
  await page.goto("/#/today");
  for (const role of ["SUP", "ADM"] as Role[]) {
    await selectRole(page, role);
    const nav = page.locator(navSelector);
    await expect(nav).toHaveCSS("overflow-y", "auto");
    const dimensions = await nav.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      before: element.scrollTop,
    }));
    expect(dimensions.scrollHeight, "many routes should overflow in short viewport").toBeGreaterThan(dimensions.clientHeight);
    await nav.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => nav.evaluate((element) => element.scrollTop)).toBeGreaterThan(20);
    const last = nav.locator("button[data-route]").last();
    await expect(last).toBeInViewport();
    await last.click();
    await expect(last).toHaveAttribute("aria-current", "page");
    const lastRoute = await last.getAttribute("data-route");
    expect(lastRoute).toBeTruthy();
    await expect(page).toHaveURL(new RegExp("#/" + lastRoute + "$"));
    // The supervisor also retains the parallel-feature diagnostic menu,
    // even though staff requests are placed after it in the sidebar.
    await nav.locator('button[data-route="parallel-test"]').click();
    await expect(page).toHaveURL(/#\/parallel-test$/);
    await nav.locator('button[data-route="drawings"]').click();
    await expect(page).toHaveURL(/#\/drawings$/);
    await expect(nav.locator('button[data-route="drawings"]')).toHaveAttribute("aria-current", "page");
    const navBounds = await nav.boundingBox();
    expect(navBounds).not.toBeNull();
    expect(navBounds!.y + navBounds!.height).toBeLessThanOrEqual(520);
  }
});

test("desktop route changes retain one active menu, matching the page title and history", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/#/today");
  const nav = page.locator(navSelector);
  for (const route of ["capture", "drawings", "inspections", "actions", "documents", "registers"]) {
    const button = nav.locator('button[data-route="' + route + '"]');
    const title = (await button.locator("span").innerText()).trim();
    await button.click();
    await expect(page).toHaveURL(new RegExp("#/" + route + "$"));
    await expect(page.locator("main h1")).toHaveText(title);
    await expect(button).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('button[aria-current="page"]')).toHaveCount(1);
  }
  await page.goBack();
  await expect(page).toHaveURL(/#\/documents$/);
  await expect(nav.locator('button[data-route="documents"]')).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(page).toHaveURL(/#\/registers$/);
  await expect(nav.locator('button[data-route="registers"]')).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(nav.locator('button[data-route="registers"]')).toHaveAttribute("aria-current", "page");
});

test("mobile drawer stays out of keyboard flow until open and supports scrolling, Escape and backdrop close", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto("/#/today");
  const sidebar = page.locator("aside.sidebar");
  const openButton = page.getByRole("button", { name: "메뉴 열기" });
  const mobileMore = page.locator('[data-ui-component="mobile-navigation"] button').last();
  await expect(sidebar).toHaveCSS("visibility", "hidden");
  await expect(openButton).toHaveAttribute("aria-expanded", "false");
  await expect(openButton).toHaveAttribute("aria-controls", "side-navigation");
  await expect(mobileMore).toHaveAttribute("aria-controls", "side-navigation");
  await openButton.focus();
  await page.keyboard.press("Enter");
  await expect(sidebar).toBeVisible();
  await expect(openButton).toHaveAttribute("aria-expanded", "true");
  const nav = page.locator(navSelector);
  const last = nav.locator("button[data-route]").last();
  await nav.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect(last).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveCSS("visibility", "hidden");
  await expect(openButton).toHaveAttribute("aria-expanded", "false");
  await mobileMore.click();
  await expect(sidebar).toHaveCSS("visibility", "visible");
  const drawing = nav.locator('button[data-route="drawings"]');
  await drawing.click();
  await expect(page).toHaveURL(/#\/drawings$/);
  await expect(sidebar).toHaveCSS("visibility", "hidden");
  await expect(mobileMore).toHaveAttribute("aria-expanded", "false");
  await mobileMore.click();
  await expect(sidebar).toHaveCSS("visibility", "visible");
  await page.locator(".sidebar-backdrop").click({ position: { x: 350, y: 160 } });
  await expect(sidebar).toHaveCSS("visibility", "hidden");
});

test("mobile menu buttons have accessible hit areas and drawing view is read-only for the owner", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto("/#/today");
  await selectRole(page, "OWN");
  const more = page.locator('[data-ui-component="mobile-navigation"] button').last();
  await more.click();
  const sidebar = page.locator("aside.sidebar");
  await expect(sidebar).toBeVisible();
  for (const control of [sidebar.locator('button[data-route="drawings"]'), sidebar.locator(".sidebar-close"), more]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    // Chromium may return 43.999984 for a CSS 44px hit target; tolerate sub-pixel float error only.
    expect(box!.height + 0.001).toBeGreaterThanOrEqual(44);
    expect(box!.width + 0.001).toBeGreaterThanOrEqual(44);
  }
  await sidebar.locator('button[data-route="drawings"]').click();
  await expect(page.locator('[data-ui-component="drawing-sheet-workspace"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "새 도면(PDF)" })).toHaveCount(0);
  await openLegacyDrawingReview(page);
  await expect(page.getByRole("tab", { name: "도면 등록·배포" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "도면 개정 비교" })).toHaveCount(1);
});

test("unauthorized deep links return to a canonical safe menu and do not expose admin UI", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/#/today");
  await selectRole(page, "CON");
  await page.evaluate(() => { location.hash = "#/admin"; });
  await expect(page).toHaveURL(/#\/today$/);
  const nav = page.locator(navSelector);
  await expect(nav.locator('button[data-route="admin"]')).toHaveCount(0);
  await expect(nav.locator('button[data-route="today"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator("main h1")).toHaveText("오늘");
  await expect(page.locator('[data-ui-page="admin"]')).toHaveCount(0);
});

test("changing UI language translates menu without changing its target route", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/#/drawings");
  await expect(page.locator('[data-ui-component="drawing-sheet-workspace"]')).toBeVisible();
  const localePicker = page.locator(".top-actions .role-picker select").first();
  await localePicker.selectOption("vi");
  await expect(page.locator(navSelector).locator('button[data-route="drawings"]')).toContainText("Xem · rà soát bản vẽ");
  await expect(page.locator("main h1")).toHaveText("Xem · rà soát bản vẽ");
  await expect(page).toHaveURL(/#\/drawings$/);
  await localePicker.selectOption("en");
  await expect(page.locator(navSelector).locator('button[data-route="drawings"]')).toContainText("Drawings · Review");
  await expect(page).toHaveURL(/#\/drawings$/);
  await localePicker.selectOption("ko");
  await expect(page.locator(navSelector).locator('button[data-route="drawings"]')).toContainText("도면 조회·검토");
  await expect(page).toHaveURL(/#\/drawings$/);
});
