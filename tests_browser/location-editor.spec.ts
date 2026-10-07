import { expect, test } from "@playwright/test";

test("ADM demo role can open the location editor", async ({ page }) => {
  await page.goto("/#/parallel-test");
  const rolePicker = page.getByRole("combobox", { name: "개발 역할 선택" });
  if (await rolePicker.inputValue() !== "ADM") {
    const workspace = page.waitForResponse(response =>
      response.url().endsWith("/workspace") && response.ok());
    await rolePicker.selectOption("ADM");
    await workspace;
  }
  await page.goto("/#/parallel-test");
  await expect(page.getByRole("tab", { name: "위치 계층", exact: true })).toBeVisible();
  const locations = page.waitForResponse(response =>
    response.url().includes("/parallel/locations") && response.request().method() === "GET");
  await page.getByRole("tab", { name: "위치 계층", exact: true }).click();
  await expect(page.getByRole("region", { name: "위치 편집" })).toBeVisible();
  const result = await locations;
  expect(result.status()).toBe(200);
  await expect(page.getByLabel("위치 이름")).toBeEditable();
  await expect(page.getByRole("button", { name: "변경 저장", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "하위 위치 추가", exact: true })).toBeEnabled();
});
