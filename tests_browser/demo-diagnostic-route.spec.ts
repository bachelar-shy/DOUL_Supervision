import { expect, test } from "@playwright/test";

// Synthetic integration fixtures use a deliberately unlisted diagnostic screen.
// This test is NOT field-UX acceptance and cannot authorize any server command.
test("demo role diagnostics require a direct link and never appear in role menus", async ({ page }) => {
  await page.goto("/#/today");
  for (const role of ["CON", "OWN", "DES"] as const) {
    const loaded = page.waitForResponse(async response => {
      if (!response.url().endsWith("/workspace") || !response.ok()) return false;
      const workspace = await response.json();
      return workspace.role?.actorGroup === role && workspace.demo === true;
    }, { timeout: 20_000 });
    await page.getByLabel("시험 사용자 역할 선택").selectOption(role);
    await loaded;
    await page.goto("/#/parallel-test");
    await expect(page.getByRole("heading", { name: "업무별 상세 확인" })).toBeVisible();
    await expect(page.locator('aside.sidebar [data-ui-component="navigation"] button[data-route="parallel-test"]'))
      .toHaveCount(0);
    await page.goto("/#/today");
  }
});
