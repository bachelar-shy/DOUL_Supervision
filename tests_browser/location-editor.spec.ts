import { expect, test } from "@playwright/test";

test("ADM demo role creates and updates a persisted location", async ({ page }) => {
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
  const uniqueName = `브라우저 검증 위치 ${Date.now()}`;
  await page.getByLabel("위치 이름", { exact: true }).fill(uniqueName);
  await page.getByLabel("의미 앵커", { exact: true }).fill(`browser/${Date.now()}`);
  const createdResponse = page.waitForResponse(response => response.url().endsWith("/parallel/locations") && response.request().method() === "POST");
  await page.getByRole("button", { name: "하위 위치 추가", exact: true }).click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const createdId = (await created.json()).record.id;
  await expect(page.getByRole("navigation", { name: "위치 목록", exact: true }).getByRole("button", { name: new RegExp(uniqueName) })).toBeVisible();
  await expect(page.getByLabel("위치 이름", { exact: true })).toHaveValue(uniqueName);
  await page.getByLabel("위치 이름", { exact: true }).fill(`${uniqueName} 수정`);
  const editedResponse = page.waitForResponse(response => response.url().endsWith(`/parallel/locations/${createdId}`) && response.request().method() === "PUT");
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  const edited = await editedResponse;
  expect(edited.status()).toBe(200);
  expect((await edited.json()).record.version).toBe(2);
  await expect(page.getByLabel("위치 이름", { exact: true })).toHaveValue(`${uniqueName} 수정`);
  await page.reload();
  await page.getByRole("tab", { name: "위치 계층", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "위치 목록", exact: true }).getByRole("button", { name: new RegExp(uniqueName + " 수정") })).toBeVisible();
});
