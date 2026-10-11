import { expect, test } from "@playwright/test";
import { serializeDocumentTables } from "../apps/web/src/pages/DocumentTableEditor";

test("form sources are scoped to the chosen form and reset on change", async ({ page }) => {
  await page.goto("/#/owner");
  await page.getByRole("tab", { name: "감리 양식" }).click();
  const form = page.getByLabel("문서 양식");
  const source = page.getByLabel("문서 원본 선택");

  await form.selectOption("FM-21");
  await expect(source.locator('option[value="DEC-UI-001"]')).toHaveCount(1);
  await expect(source.locator('option[value="RPT-UI-001"]')).toHaveCount(0);
  await source.selectOption("DEC-UI-001");
  await form.selectOption("FM-20");
  await expect(source).toHaveValue("");
  await expect(source.locator('option[value="RPT-UI-001"]')).toHaveCount(1);
  await expect(source.locator('option[value="DEC-UI-001"]')).toHaveCount(0);

  await form.selectOption("FM-15");
  await expect(source.locator('option[value="RFI-UI-001"]')).toHaveCount(1);
  await form.selectOption("FM-13");
  await expect(source.locator('option[value="RPT-UI-001"]')).toHaveCount(0);
  await expect(source.locator('option[value="DEC-UI-001"]')).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("TypeError");
});

test("editable review-table fields are visible and retain entered values", async ({ page }) => {
  await page.goto("/#/owner");
  await page.getByRole("tab", { name: "감리 양식" }).click();
  await page.getByLabel("문서 양식").selectOption("FM-02");
  const table = page.locator(".document-editable-table");
  await expect(table).toBeVisible();
  await table.getByRole("textbox", { name: "review.design" }).fill("도면 변경부 확인");
  await table.getByRole("textbox", { name: "review.quality" }).fill("시험성적서 검토");
  await expect(table.getByRole("textbox", { name: "review.design" })).toHaveValue("도면 변경부 확인");
  await expect(table.getByRole("textbox", { name: "review.quality" })).toHaveValue("시험성적서 검토");
  await expect(page.getByRole("button", { name: "PDF 다운로드" })).toBeDisabled();
});

test("serialization preserves edited table values and complete columns", () => {
  const schema = { scalar_fields: {}, signature_roles: [], tables: [
    { path: "review", type: "review_table", columns: ["design", "quality"] },
    { path: "items", type: "repeat_table", columns: ["title", "note"] },
  ] };
  expect(serializeDocumentTables(schema, {
    review: { design: "검토 완료", quality: "보완 필요" },
    items: [{ title: "시험성적서", note: "첨부 2건" }],
  })).toEqual({
    review: { design: "검토 완료", quality: "보완 필요" },
    items: [{ title: "시험성적서", note: "첨부 2건" }],
  });
});
