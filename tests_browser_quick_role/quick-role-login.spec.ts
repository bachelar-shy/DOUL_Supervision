import { expect, test } from "@playwright/test";

const roles = [
  { id: "OWN", label: "발주처", admin: false },
  { id: "CON", label: "시공사", admin: false },
  { id: "SUP", label: "감리자", admin: false },
  { id: "ADM", label: "어드민", admin: true },
] as const;

for (const role of roles) {
  test(`${role.label} 버튼만으로 합성 테스트 메인 화면 진입 및 로그아웃`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    const chooser = page.locator('[data-ui-component="test-role-login"]');
    await expect(chooser).toBeVisible();
    await expect(chooser.getByRole("heading", { name: "테스트 역할 선택" })).toBeVisible();
    await expect(chooser.getByLabel("비밀번호", { exact: true })).toHaveCount(0);
    await expect(chooser.getByLabel("아이디", { exact: true })).toHaveCount(0);
    const buttons = chooser.locator("button[data-test-role]");
    await expect(buttons).toHaveCount(4);
    expect(await buttons.evaluateAll(items => items.map(el => el.getAttribute("data-test-role"))))
      .toEqual(["OWN", "CON", "SUP", "ADM"]);
    const button = chooser.locator(`button[data-test-role="${role.id}"]`);
    await expect(button).toContainText(role.label);
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await button.click();
    await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
    await expect(page.locator("aside.sidebar .project-chip")).toContainText("DOUL 테스트 프로젝트");
    await expect(page).toHaveURL(/#\/today$/);
    if (test.info().project.name === "phone") await page.locator(".menu-toggle").click();
    const nav = page.locator("aside.sidebar");
    if (role.admin) {
      await expect(nav.getByText("프로젝트 설정", { exact: true })).toBeVisible();
      await expect(nav.getByText("인원 추가 요청", { exact: true })).toHaveCount(0);
      await page.goto("/#/admin");
      await expect(page.getByRole("tab", { name: "인원 추가 요청 접수함", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "＋ 프로젝트 추가", exact: true })).toHaveCount(0);
    } else {
      await expect(nav.getByText("프로젝트 설정", { exact: true })).toHaveCount(0);
      await expect(nav.getByText("인원 추가 요청", { exact: true })).toBeVisible();
      await page.goto("/#/staff-requests");
      await expect(page.getByRole("form", { name: "인원 추가 요청 작성" })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await expect(page.locator('[data-ui-component="test-role-login"]')).toBeVisible();
  });
}
