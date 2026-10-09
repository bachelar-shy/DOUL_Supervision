import { expect, test, type Page } from "@playwright/test";
import { formFieldLabels } from "@doul/localization";

async function chooseLanguage(page: Page, language: string) {
  await page.locator(".topbar .role-picker select").first().selectOption(language);
}

test("Mock document labels switch while form fields and entered values stay unchanged", async ({
  page,
}) => {
  await page.goto("/#/documents");
  const form = page.getByRole("combobox", { name: "문서 양식" });
  await expect(form).toHaveValue("FM-20");
  await expect(page.getByRole("heading", { name: "데이터 연결 문서" })).toBeVisible();

  const inputNames = await page.locator(".document-fields input").evaluateAll((items) =>
    items.map((item) => item.getAttribute("name")),
  );
  expect(inputNames).toContain("urgent.fact");
  const factInput = page.locator('input[name="urgent.fact"]');
  await factInput.fill("MOCK-SITE-FACT-001");

  let mutationRequests = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/")) {
      mutationRequests += 1;
    }
  });

  await chooseLanguage(page, "vi");
  await expect(page.locator("html")).toHaveAttribute("lang", "vi-VN");
  await expect(page.getByRole("heading", { name: "Tài liệu liên kết dữ liệu" })).toBeVisible();
  await expect(page.getByLabel(formFieldLabels["urgent.fact"].vi)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Chọn biểu mẫu tài liệu" })).toHaveValue("FM-20");
  await expect(factInput).toHaveValue("MOCK-SITE-FACT-001");
  expect(await page.locator(".document-fields input").evaluateAll((items) =>
    items.map((item) => item.getAttribute("name")),
  )).toEqual(inputNames);

  await chooseLanguage(page, "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("heading", { name: "Data-linked document" })).toBeVisible();
  await expect(page.getByLabel(formFieldLabels["urgent.fact"].en)).toBeVisible();
  await expect(factInput).toHaveValue("MOCK-SITE-FACT-001");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("heading", { name: "Data-linked document" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("doul.locale"))).toBe("en");

  await chooseLanguage(page, "ko");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
  await expect(page.getByLabel(formFieldLabels["urgent.fact"].ko)).toBeVisible();
  expect(mutationRequests).toBe(0);
});

test("Mock contract creation remains unavailable across locales without changing its capability", async ({
  page,
}) => {
  await page.goto("/#/contract");
  const surface = page.locator('[data-ui-page="contract"]');
  await expect(surface).toBeVisible();
  const createButton = surface.getByRole("button", { name: "계약통지 기록 추가", exact: true });
  const reason = surface.getByTestId("creation-capability-reason");
  await expect(createButton).toBeDisabled();
  await expect(reason).toContainText("UI Mock Preview");

  let mutationRequests = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/")) {
      mutationRequests += 1;
    }
  });
  const locale = page.locator(".topbar .role-picker select").first();
  for (const [language, label, reasonText, htmlLang] of [
    ["vi", "Thêm hồ sơ Thông báo hợp đồng", "UI Mock Preview", "vi-VN"],
    ["en", "Add Contract notice record", "UI Mock Preview", "en-US"],
    ["ko", "계약통지 기록 추가", "UI Mock Preview", "ko-KR"],
  ]) {
    await chooseLanguage(page, language);
    await expect(page.locator("html")).toHaveAttribute("lang", htmlLang);
    await expect(surface.getByRole("button", { name: label, exact: true })).toBeDisabled();
    await expect(reason).toContainText(reasonText);
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  }
  expect(mutationRequests).toBe(0);
});

test("Mock safety command availability and evidence source stay stable across locale changes", async ({
  page,
}) => {
  await page.goto("/#/safety");
  const safety = page.locator('[data-ui-component="safety-workspace"]');
  await safety.getByRole("tab", { name: /작업중지/ }).click();
  await safety.getByRole("button", { name: "추락방지시설 보완 작업중지" }).click();
  const actionGate = safety.locator('[data-ui-component="action-gate"]');
  const command = actionGate.locator('[data-command-availability]');
  await expect(command).toHaveAttribute("data-command-availability", "blocked");
  const commandButton = actionGate.getByRole("button", { name: /작업중지 해제/ });
  await expect(commandButton).toBeDisabled();
  const availabilityBefore = await command.getAttribute("data-command-availability");

  await page.goto("/#/capture");
  const row = page.locator('[data-ui-component="evidence-viewer"] button').first();
  await expect(row).toBeVisible();
  const rawTitle = await row.locator("strong").innerText();
  await row.click();
  const sheet = page.locator('[data-ui-component="evidence-detail-sheet"]');
  await expect(sheet).toBeVisible();
  const locale = page.locator(".topbar .role-picker select").first();

  let mutationRequests = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/")) {
      mutationRequests += 1;
    }
  });
  for (const [language, tab, idLabel, technicalTab, versionLabel, htmlLang] of [
    ["vi", "Nguồn gốc · Liên kết", "Mã minh chứng", "Thông tin kỹ thuật", "Phiên bản hồ sơ gốc", "vi-VN"],
    ["en", "Provenance · Links", "Evidence ID", "Technical details", "Source record version", "en-US"],
    ["ko", "출처·연결", "증빙 ID", "기술정보", "원본 기록 버전", "ko-KR"],
  ]) {
    await chooseLanguage(page, language);
    await expect(page.locator("html")).toHaveAttribute("lang", htmlLang);
    await expect(sheet.getByRole("heading").first()).toHaveText(rawTitle);
    await expect(sheet.getByRole("tab", { name: tab })).toBeVisible();
    await sheet.getByRole("tab", { name: tab }).click();
    const idValue = await sheet.getByText(idLabel, { exact: true }).locator("..")
      .locator("div").innerText();
    expect(idValue.trim()).not.toBe("");
    await sheet.getByRole("tab", { name: technicalTab }).click();
    await expect(sheet.getByText(versionLabel, { exact: true })).toBeVisible();
  }
  expect(availabilityBefore).toBe("blocked");
  expect(mutationRequests).toBe(0);
});

for (const width of [390, 768, 1440]) {
  test(`Mock localized capture and contract layouts fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 920 });
    await page.goto("/#/capture");
    const locale = page.locator(".topbar .role-picker select").first();
    for (const language of ["vi", "en", "ko"]) {
      await locale.selectOption(language);
      await expect(page.locator('[data-ui-page="capture"]')).toBeVisible();
      await expect.poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBeTruthy();
      await page.goto("/#/contract");
      await expect(page.locator('[data-ui-page="contract"]')).toBeVisible();
      await expect.poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBeTruthy();
      await page.goto("/#/capture");
    }
  });
}
