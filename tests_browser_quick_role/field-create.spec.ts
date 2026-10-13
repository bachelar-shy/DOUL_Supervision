import { expect, test, type Page } from "@playwright/test";

async function roleLogin(page: Page, role: "CON" | "SUP" | "ADM") {
  await page.goto("/");
  await expect(page.locator('[data-ui-component="test-role-login"]')).toBeVisible();
  await page.locator(`button[data-test-role="${role}"]`).click();
  await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
}

test("시공사 신규 현장기록 작성과 저장 및 검측 신규 버튼", async ({ page }) => {
  const title = "현장기록 기능 확인 " + Date.now();
  await roleLogin(page, "CON");
  const quick = page.locator('[data-ui-component="quick-create-launcher"]');
  await expect(quick.getByRole("button", { name: "＋ 신규 검측" })).toBeVisible();
  await expect(quick.getByRole("button", { name: "＋ 현장기록" })).toBeVisible();
  await quick.getByRole("button", { name: "＋ 현장기록" }).click();
  await expect(page).toHaveURL(/#\/capture$/);
  const field = page.locator('[data-ui-component="field-record-panel"]');
  await expect(field.getByRole("button", { name: "＋ 신규 현장기록" })).toBeVisible();
  const originalIntake = page.locator('[data-ui-component="capture-upload-toolbar"] .upload-label').first();
  await expect(originalIntake).toBeVisible();
  const chooseFile = page.waitForEvent("filechooser");
  await originalIntake.click();
  const filePicker = await chooseFile;
  expect(filePicker.isMultiple()).toBe(true);
  await field.getByRole("button", { name: "＋ 신규 현장기록" }).click();
  const form = field.getByRole("form", { name: "신규 현장기록 작성" });
  await expect(form).toBeVisible();
  await form.getByLabel("기록 제목").fill(title);
  await form.getByLabel("현장기록 내용").fill("현장 작업 진행 및 품질 확인 사항을 등록하는 테스트 초안");
  await form.getByRole("button", { name: "현장기록 초안 저장" }).click();
  await expect(field.getByRole("status").filter({ hasText: "현장기록 초안이 저장되었습니다" })).toBeVisible();
  await expect(field.getByText(title, { exact: true })).toBeVisible();
  await expect(field.getByText(/저장된 현장기록 · [1-9][0-9]*건/)).toBeVisible();

  await page.goto("/#/inspections");
  const entry = page.locator('[data-ui-component="new-inspection-entry"]');
  await expect(entry.getByRole("button", { name: "＋ 신규 검측" })).toBeVisible();
  await entry.getByRole("button", { name: "＋ 신규 검측" }).click();
  await expect(page.getByRole("form", { name: "자체검측 작성" })).toBeVisible();
  await expect(page.getByRole("button", { name: "자체검측 초안 저장" })).toBeVisible();
  await expect(page.getByText("검측에 사용할 수 있는 자료를 확인하는 중…")).toHaveCount(0, { timeout: 15000 });
  expect(await entry.locator("select").first().locator("option").count()).toBeGreaterThan(1);
  const inspection = page.getByRole("form", { name: "자체검측 작성" });
  const work = "새 검측 기능 확인 " + Date.now();
  await inspection.getByLabel("공종·작업명").fill(work);
  await inspection.locator("select").nth(0).selectOption({ index: 1 });
  await expect(inspection.locator("select").nth(1).locator("option")).not.toHaveCount(1, { timeout: 12000 });
  await inspection.locator("select").nth(1).selectOption({ index: 1 });
  await expect(inspection.locator("fieldset").nth(0).locator("input[type=checkbox]")).not.toHaveCount(0, { timeout: 12000 });
  await expect(inspection.locator("fieldset").nth(1).locator("input[type=checkbox]")).not.toHaveCount(0, { timeout: 12000 });
  await inspection.locator("fieldset").nth(0).locator("input[type=checkbox]").first().check();
  await inspection.locator("fieldset").nth(1).locator("input[type=checkbox]").first().check();
  await inspection.locator("fieldset").nth(2).locator("input[type=checkbox]").first().check();
  await inspection.getByRole("button", { name: "자체검측 초안 저장" }).click();
  await expect(page.getByRole("heading", { name: work, exact: true })).toBeVisible();

  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await roleLogin(page, "CON");
  await page.goto("/#/capture");
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});

test("감리자 검측 권한 설명과 시정조치 추가 진입", async ({ page }) => {
  await roleLogin(page, "SUP");
  await page.goto("/#/inspections");
  await expect(page.getByText("검측 신규 요청은 시공사에서 작성합니다", { exact: false })).toBeVisible();
  await expect(page.locator('[data-ui-component="new-inspection-entry"]')).toHaveCount(0);
  await page.goto("/#/corrections");
  await page.getByRole("tab", { name: "시정조치", exact: true }).click();
  const entry = page.locator('[data-ui-component="new-action-entry"]');
  await expect(entry.getByRole("button", { name: "＋ 신규 시정조치" })).toBeVisible();
  await entry.getByRole("button", { name: "＋ 신규 시정조치" }).click();
  await expect(page.locator('[data-ui-component="action-authoring-panel"]')).toBeVisible();
});

test("관리자 현장기록 추가와 검측 업무 안내", async ({ page }) => {
  await roleLogin(page, "ADM");
  await page.goto("/#/capture");
  await expect(page.getByRole("button", { name: "＋ 신규 현장기록" })).toBeVisible();
  await page.goto("/#/inspections");
  await expect(page.getByText("검측 신규 요청은 시공사에서 작성합니다", { exact: false })).toBeVisible();
  await page.goto("/#/admin");
  await expect(page.getByRole("button", { name: "＋ 프로젝트 추가", exact: true })).toHaveCount(0);
});
