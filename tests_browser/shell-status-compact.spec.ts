import { expect, test } from "@playwright/test";

test("synthetic provenance and offline tools do not take permanent workspace rows", async ({ page, context }) => {
  await page.goto("/#/today");
  const shell = page.locator('.app-shell[data-layout-system="field-workspace"]');
  const project = shell.locator(".project-chip");
  await expect(project).toBeVisible();
  await expect(project).toHaveAttribute("title", /합성 테스트 자료/);
  await expect(shell.locator(".demo-bar")).toHaveCount(0);
  await expect(shell.locator(".offline-bar")).toHaveCount(0);
  await expect(shell.locator('main > details.mb-3')).toHaveCount(0);

  const status = shell.locator('[data-ui-component="offline-status-toggle"]');
  const tools = shell.locator('[data-ui-component="offline-tools"]');
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("aria-expanded", "false");
  await expect(tools).toBeHidden();
  // Background syncing components must remain mounted while the flyout is hidden.
  await expect(tools.locator('.fw-offline-queue')).toHaveCount(1);
  await status.click();
  await expect(status).toHaveAttribute("aria-expanded", "true");
  await expect(tools).toBeVisible();
  await expect(tools.getByText("현장 오프라인 작업함", { exact: true })).toBeVisible();
  await tools.getByRole("button", { name: "저장 상태 닫기" }).click();
  await expect(tools).toBeHidden();
  await expect(tools.locator('.fw-offline-queue')).toHaveCount(1);

  await context.setOffline(true);
  await expect(status).toHaveAttribute("aria-label", /오프라인/);
  await expect(shell.locator(".offline-bar")).toHaveCount(0);
  await status.click();
  await expect(tools).toBeVisible();
  await expect(tools.getByText(/온라인 복구 후 자동 전송을 시도/)).toBeVisible();
  await context.setOffline(false);
  await expect(status).toHaveAttribute("aria-label", /온라인/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
});
