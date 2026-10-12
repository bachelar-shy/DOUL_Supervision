import { test, expect } from "@playwright/test";

async function openSampleAsAdministrator(page: import("@playwright/test").Page) {
  await page.goto("/#/today");
  const projects = page.getByLabel("프로젝트 선택");
  const narrow = (page.viewportSize()?.width ?? 1440) <= 620;
  if (narrow) await page.locator(".menu-toggle").click();
  await expect(projects).toBeVisible();
  await expect(projects.locator("option")).toHaveCount(2);
  await expect(page.locator("aside.sidebar .project-chip strong"))
    .not.toHaveText("시범현장", { timeout: 25_000 });
  await projects.selectOption({ label: "DOUL SAMPLE · WWT 공장 (합성 시험자료)" });
  await expect(page.locator("aside.sidebar .project-chip strong"))
    .toHaveText("DOUL SAMPLE · WWT 공장 (합성 시험자료)", { timeout: 30_000 });
  if (narrow && await page.locator(".sidebar.open").count()) {
    const close = page.locator("aside.sidebar .sidebar-close");
    await expect(close).toBeVisible();
    // Name is translated per locale: test its accessibility rather than an old Korean literal.
    await expect(close).toHaveAttribute("aria-label", /\S+/);
    await close.click();
    await expect(page.locator("aside.sidebar")).not.toHaveClass(/\bopen\b/);
  }
  await page.locator("header.topbar .role-picker select").last().selectOption("ADM");
  await page.goto("/#/admin");
  await expect(page.getByTestId("sample-usecase-panel")).toBeVisible({ timeout: 20_000 });
}

test("상시 샘플 프로젝트에서 15개 사례 조회·실행·프로젝트 격리", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await openSampleAsAdministrator(page);
  const panel = page.getByTestId("sample-usecase-panel");
  await expect(panel.locator('button[aria-pressed]')).toHaveCount(15);
  await expect(panel).toContainText("도면 24개");
  await expect(panel).toContainText("사진 파생뷰 60개");
  await panel.getByRole("button", { name: /UC-09/ }).click();
  await panel.getByRole("button", { name: "선택 사례 실행" }).click();
  await expect(panel.getByText("검증 결과: PASS")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("프로젝트 선택").selectOption({ label: "DOUL 시범현장 · 예시 데이터" });
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("긴 관리자 메뉴가 화면에 가려지지 않고 스크롤된다", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 780 });
  await page.goto("/#/today");
  await expect(page.getByLabel("프로젝트 선택")).toBeVisible();
  await expect(page.locator("aside.sidebar .project-chip strong"))
    .toHaveText("DOUL SAMPLE · WWT 공장 (합성 시험자료)", { timeout: 30_000 });
  // A role picker is available before the server has returned that role's
  // workspace. Wait for the authenticated ADM workspace before navigation.
  const administratorWorkspace = page.waitForResponse(async (response) => {
    if (!/\/projects\/[^/]+\/workspace(?:\?|$)/.test(response.url()) || response.status() !== 200) return false;
    const body = await response.json();
    return body?.role?.actorGroup === "ADM";
  }, { timeout: 30_000 });
  await page.locator("header.topbar .role-picker select").last().selectOption("ADM");
  await administratorWorkspace;
  const nav = page.locator("aside.sidebar nav");
  await expect(nav).toBeVisible();
  const metrics = await nav.evaluate(node => ({
    scroll: node.scrollHeight, client: node.clientHeight,
  }));
  // Full-featured mode scrolls to the lower roles. Field-core mode has
  // fewer visible modules so no scrolling is needed; both must be reachable.
  expect(metrics.scroll).toBeGreaterThanOrEqual(metrics.client);
  await nav.getByRole("button", { name: "프로젝트 설정" }).click();
  await expect(page.getByTestId("sample-usecase-panel")).toBeVisible({ timeout: 20_000 });
});

test("샘플 검증 패널은 모바일·태블릿·데스크톱에서 가로 넘침이 없다", async ({ page }) => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openSampleAsAdministrator(page);
    const panel = page.getByTestId("sample-usecase-panel");
    await expect(panel).toContainText("등록 사례");
    const geometry = await panel.evaluate(node => ({
      viewport: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth,
      panelWidth: node.getBoundingClientRect().width,
    }));
    expect(geometry.overflow, "document overflows at width " + width).toBeLessThanOrEqual(geometry.viewport + 2);
    expect(geometry.panelWidth).toBeLessThanOrEqual(width);
  }
});

test("모바일 드로어는 한·베·영에서 접근성 레이블로 닫을 수 있다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/#/today");
  const picker = page.locator("header.topbar .role-picker select").first();
  await expect(picker).toBeVisible();
  for (const lang of ["ko", "vi", "en"] as const) {
    await picker.selectOption(lang);
    await expect(picker).toHaveValue(lang);
    await page.locator(".menu-toggle").click();
    const sidebar = page.locator("aside.sidebar");
    await expect(sidebar).toHaveClass(/\bopen\b/);
    const close = sidebar.locator(".sidebar-close");
    await expect(close).toBeVisible();
    await expect(close).toHaveAttribute("aria-label", /\S+/);
    await close.click();
    await expect(sidebar).not.toHaveClass(/\bopen\b/);
  }
});
