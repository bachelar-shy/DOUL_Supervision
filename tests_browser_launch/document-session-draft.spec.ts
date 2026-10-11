import { expect, test } from "@playwright/test";

async function openFormEditor(page: import("@playwright/test").Page) {
  await page.goto("/#/owner");
  await page.getByRole("tab", { name: "감리 양식" }).click();
  await expect(page.getByLabel("문서 양식")).toBeVisible();
}

test("decision request form and its correct source remain after reload until user discards", async ({ page }) => {
  await openFormEditor(page);
  await page.getByLabel("문서 양식").selectOption("FM-21");
  await page.getByLabel("문서 원본 선택").selectOption("DEC-UI-001");
  await page.locator('input[name="decision.issue"]').fill("발주처 마감재 변경 승인 필요");
  await page.reload();
  await page.getByRole("tab", { name: "감리 양식" }).click();
  await expect(page.getByLabel("문서 양식")).toHaveValue("FM-21");
  await expect(page.getByLabel("문서 원본 선택")).toHaveValue("DEC-UI-001");
  await expect(page.locator('input[name="decision.issue"]')).toHaveValue("발주처 마감재 변경 승인 필요");
  await expect(page.locator(".document-session-draft-notice")).toContainText("이전 작성 내용을 복원했습니다");

  await page.getByRole("button", { name: "임시 작성 내용 삭제" }).click();
  await expect(page.getByLabel("문서 양식")).toHaveValue("FM-20");
  await page.reload();
  await page.getByRole("tab", { name: "감리 양식" }).click();
  await expect(page.getByLabel("문서 양식")).toHaveValue("FM-20");
});

test("entered construction review table survives reload and is never replaced with empty fields", async ({ page }) => {
  await openFormEditor(page);
  await page.getByLabel("문서 양식").selectOption("FM-02");
  await page.getByRole("textbox", { name: "review.design" }).fill("구조 상세 도면 검토");
  await page.getByRole("textbox", { name: "review.quality" }).fill("시공 전 시험성적서 제출");
  await page.reload();
  await page.getByRole("tab", { name: "감리 양식" }).click();
  await expect(page.getByLabel("문서 양식")).toHaveValue("FM-02");
  await expect(page.getByRole("textbox", { name: "review.design" })).toHaveValue("구조 상세 도면 검토");
  await expect(page.getByRole("textbox", { name: "review.quality" })).toHaveValue("시공 전 시험성적서 제출");
});
