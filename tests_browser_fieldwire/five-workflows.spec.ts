import { expect, test } from "@playwright/test";

test("현장사진 목록·검색과 오프라인 업무함 진입", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", e => pageErrors.push(e.message));
  await page.goto("/#/capture");
  const library = page.getByRole("region", { name: "현장사진 라이브러리" });
  await expect(library).toBeVisible();
  await expect(library.getByRole("searchbox", { name: "사진 검색" })).toBeVisible();
  await library.getByRole("searchbox", { name: "사진 검색" }).fill("검측");
  await expect(library.getByRole("searchbox", { name: "사진 검색" })).toHaveValue("검측");
  await library.getByRole("searchbox", { name: "사진 검색" }).fill("");
  const outer = page.locator("details").filter({ has: page.locator(".fw-offline-queue") });
  if (await outer.count()) {
    await outer.locator("summary").first().click();
    await expect(page.getByRole("region", { name: "현장 오프라인 작업함" })).toBeVisible();
  }
  expect(pageErrors).toEqual([]);
});

test("공사구역 트리·검측 체크리스트·업무별 대화", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", e => pageErrors.push(e.message));
  await page.goto("/#/today");
  const rolePicker = page.locator("header.topbar .role-picker select").last();
  await expect(rolePicker).toBeVisible();
  await rolePicker.selectOption("ADM");
  await page.goto("/#/admin");
  await expect(page.getByRole("region", { name: "공사구역 관리" })).toBeVisible();
  await expect(page.getByRole("tree", { name: "공사구역 목록" })).toBeVisible();
  await rolePicker.selectOption("SUP");
  await page.goto("/#/inspections");
  const record = page.locator(".record-list button").first();
  await expect(record).toBeVisible();
  await record.click();
  const checklistSummary = page.locator("details > summary").filter({ hasText: "공통 검측 체크리스트" }).first();
  await checklistSummary.click();
  await expect(page.getByRole("region", { name: "공통 검측 체크리스트" })).toBeVisible();
  const discussionSummary = page.locator("details > summary").filter({ hasText: "업무별 대화" }).first();
  await discussionSummary.click();
  const discussion = page.getByRole("region", { name: "업무별 대화" });
  await expect(discussion).toBeVisible();
  await discussion.getByRole("textbox", { name: "업무 댓글 입력" }).fill("Fieldwire 유사 현장 협업 브라우저 테스트");
  await discussion.getByRole("button", { name: "댓글 등록" }).click();
  await expect(discussion.getByRole("article").getByText("Fieldwire 유사 현장 협업 브라우저 테스트").first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});
