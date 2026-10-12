import { expect, test } from "@playwright/test";

test("감리자 첫 화면에는 현장기록·도면·검측·조치·보고만 보인다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#/today");
  const menu = page.locator("aside.sidebar");
  for (const name of ["오늘", "현장기록", "도면조회", "검측·검수", "지적·시정조치", "감리보고"]) {
    await expect(menu.getByText(name, { exact: true })).toBeVisible();
  }
  for (const name of ["공정·지연·회복", "안전·작업허가", "기성", "관리대장"]) {
    await expect(menu.getByText(name, { exact: true })).toHaveCount(0);
  }
  await page.goto("/#/schedule");
  await expect.poll(() => new URL(page.url()).hash).toBe("#/today");
  await expect(page.locator("main")).toContainText("오늘");
  expect(errors).toEqual([]);
});

test("도면조회는 별도 메뉴에서 개별 시트 목록과 기존 PDF 도구를 제공한다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#/drawings");
  await expect(page.locator('[data-ui-page="field-drawings"]')).toBeVisible();
  await expect(page.locator('[data-ui-component="drawing-sheet-workspace"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "기존 PDF 검토" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "도면 검색" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("시정조치와 보고에 필요한 화면은 각 한 메뉴의 하위 탭으로 이동한다", async ({ page }) => {
  await page.goto("/#/corrections");
  const sections = page.getByRole("tablist", { name: "지적·시정조치" });
  for (const name of ["현장 확인", "지적사항", "시정조치"]) {
    await expect(sections.getByRole("tab", { name })).toBeVisible();
  }
  await sections.getByRole("tab", { name: "시정조치" }).click();
  await expect(sections.getByRole("tab", { name: "시정조치" })).toHaveAttribute("aria-selected", "true");

  await page.goto("/#/owner");
  const reports = page.getByRole("tablist", { name: "감리보고" });
  await reports.getByRole("tab", { name: "감리 양식" }).click();
  await expect(reports.getByRole("tab", { name: "감리 양식" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-ui-page="documents"]')).toBeVisible();
});

test("시공사·발주처·관리자의 메뉴 범위는 서로 다르다", async ({ page }) => {
  await page.goto("/#/today");
  const menu = page.locator("aside.sidebar");
  const role = page.locator("header.topbar .role-picker select").last();
  await role.selectOption("CON");
  await expect(menu.getByText("지적·시정조치", { exact: true })).toBeVisible();
  await expect(menu.getByText("감리보고", { exact: true })).toHaveCount(0);
  await role.selectOption("OWN");
  await expect(menu.getByText("감리보고", { exact: true })).toBeVisible();
  await expect(menu.getByText("현장기록", { exact: true })).toHaveCount(0);
  await role.selectOption("ADM");
  await expect(menu.getByText("프로젝트 설정", { exact: true })).toBeVisible();
});
