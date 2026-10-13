import { expect, test } from "@playwright/test";

const implementationTerms = /EXPLAIN · VERIFY · RECORD|참조 계약 v|create:rfi|supervisor_review|\bProjection\b|\bAction Descriptor\b|\bresumeGate\b|\bDomainRef\b|개발 역할 선택|오프라인 명령 초안/;

test("Korean field workflows use consistent labels and retain official workflow boundaries", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#/today");
  await expect(page.getByLabel("시험 사용자 역할 선택")).toBeVisible();
  // Synthetic data is identified in project context, not by a full-width banner.
  await expect(page.locator(".project-chip")).toHaveAttribute("title", /합성 테스트 자료 · 실제 현장 증빙 아님/);
  await expect(page.locator(".demo-bar")).toHaveCount(0);
  for (const route of ["today", "inspections", "capture", "observations", "issues", "actions", "schedule", "contract", "payment", "completion", "safety", "owner", "rfis", "documents", "registers", "parallel-test"]) {
    await page.goto(`/#/${route}`);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(implementationTerms);
  }
  await page.goto("/#/registers");
  await expect(page.getByText("관리대장은 관련 업무의 처리 현황을 모아 보여줍니다. 기록 작성·승인·종결은 해당 업무 화면에서 수행하십시오.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Field location editor accepts drawing positions without raw JSON entry", async ({ page }) => {
  await page.goto("/#/parallel-test");
  const workspace = page.waitForResponse(response => response.url().endsWith("/workspace") && response.ok());
  await page.getByLabel("시험 사용자 역할 선택").selectOption("ADM");
  await workspace;
  await expect(page.getByLabel("시험 사용자 역할 선택")).toHaveValue("ADM");
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "위치 계층", exact: true }).click();
  const panel = page.getByRole("region", { name: "위치 편집" });
  await expect(panel.getByLabel("위치 구분명", { exact: true })).toBeVisible();
  await expect(panel.locator("textarea")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "도면 표시 위치 추가", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "도면 표시 위치 추가", exact: true }).click();
  await expect(panel.getByLabel("표시할 도면").last()).toBeVisible();
  await expect(panel.getByLabel("도면 쪽").last()).toHaveValue("1");
  await expect(panel.getByLabel("가로 표시 위치").last()).toHaveValue("0");
  await expect(panel.getByLabel("세로 표시 위치").last()).toHaveValue("0");
  // Leaving this local draft never writes to the official location record.
});
