import { expect, test } from "@playwright/test";

test("real API renders a source-bound draft and reports an absent PDF exporter clearly", async ({ page }) => {
  await page.goto("/#/documents");
  await expect(page.getByLabel("문서 양식")).toBeVisible();
  await page.getByLabel("문서 양식").selectOption("FM-20");
  const source = page.getByLabel("문서 원본 선택");
  const options = await source.locator("option").evaluateAll(nodes =>
    nodes.map(node => (node as HTMLOptionElement).value).filter(Boolean));
  expect(options.length, "At least one accessible Report source").toBeGreaterThan(0);
  await source.selectOption(options[0]);
  const expected = page.waitForResponse(response =>
    response.request().method() === "POST" && /\/forms\/FM-20\/preview$/.test(new URL(response.url()).pathname));
  await page.getByRole("button", { name: "초안 미리보기 생성" }).click();
  const response = await expected;
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.getByRole("button", { name: "PDF 다운로드" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "DOCX 다운로드" })).toBeEnabled();

  // The ordinary development API has no document exporter configured. The
  // UI must not claim a legal PDF or create fabricated bytes in this case.
  const derivative = page.waitForResponse(response =>
    response.request().method() === "GET" && /\/documents\/[^/]+\/exports\/pdf$/.test(new URL(response.url()).pathname));
  await page.getByRole("button", { name: "PDF 다운로드" }).click();
  const downloadResult = await derivative;
  expect(downloadResult.status()).toBe(501);
  await expect(page.getByRole("alert")).toContainText("PDF/DOCX 출력 엔진이 설치되지 않았습니다.");
});
