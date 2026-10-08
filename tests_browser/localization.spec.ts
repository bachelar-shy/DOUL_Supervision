import { expect, test, type Page } from "@playwright/test";
import { formatDecimalExact } from "../apps/web/src/i18n/decimal-format";

async function chooseLanguage(page: Page, currentAria: string, language: string) {
  await page.getByRole("combobox", { name: currentAria }).selectOption(language);
}

test("Korean, Vietnamese and English field views switch without changing form identifiers", async ({
  page,
}) => {
  await page.goto("/#/documents");
  const form = page.getByRole("combobox", { name: "문서 양식" });
  await expect(form).toHaveValue("FM-20");
  await expect(page.getByRole("heading", { name: "데이터 연결 문서" })).toBeVisible();

  const keysBefore = await page.locator(".document-fields input").evaluateAll((items) =>
    items.map((item) => item.getAttribute("name")),
  );
  expect(keysBefore.length).toBeGreaterThan(5);
  expect(keysBefore).toContain("urgent.fact");
  const factInput = page.locator('input[name="urgent.fact"]');
  await factInput.fill("SITE-FACT-001");
  let renderRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && /documents|render/.test(request.url())) {
      renderRequests += 1;
    }
  });

  await chooseLanguage(page, "표시 언어 선택", "vi");
  await expect(page.locator("html")).toHaveAttribute("lang", "vi-VN");
  await expect(page.getByRole("heading", { name: "Tài liệu liên kết dữ liệu" })).toBeVisible();
  await expect(page.getByText("Tình hình khẩn cấp và sự việc", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Chọn biểu mẫu tài liệu" })).toHaveValue("FM-20");
  await expect(factInput).toHaveValue("SITE-FACT-001");
  expect(
    await page.locator(".document-fields input").evaluateAll((items) =>
      items.map((item) => item.getAttribute("name")),
    ),
  ).toEqual(keysBefore);

  await page.goto("/#/capture");
  const capture = page.locator('[data-ui-page="capture"]');
  await expect(capture.getByRole("heading", { name: "Nhập hồ sơ hiện trường" })).toBeVisible();
  await expect(capture.getByRole("heading", { name: "Minh chứng trên máy chủ" })).toBeVisible();
  await expect(capture.locator(".right-stack section.panel").nth(1).locator(".section-heading span")).toContainText(/mục/);
  await expect(capture.getByText(/chờ nộp/)).toBeVisible();

  await page.goto("/#/documents");
  await chooseLanguage(page, "Chọn ngôn ngữ hiển thị", "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("heading", { name: "Data-linked document" })).toBeVisible();
  await expect(page.getByText("Urgent facts", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Document form" })).toHaveValue("FM-20");
  expect(renderRequests).toBe(0);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("heading", { name: "Data-linked document" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("doul.locale"))).toBe("en");

  await chooseLanguage(page, "Select display language", "ko");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
  await expect(page.getByText("긴급 상황·사실관계", { exact: true })).toBeVisible();
});

for (const width of [390, 1440]) {
  test(`Localized capture/document layouts do not overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 920 });
    await page.goto("/#/capture");
    for (const [language, aria, title] of [
      ["vi", "표시 언어 선택", "Nhập hồ sơ hiện trường"],
      ["en", "Chọn ngôn ngữ hiển thị", "Import field records"],
      ["ko", "Select display language", "현장 기록 가져오기"],
    ]) {
      await chooseLanguage(page, aria, language);
      await expect(page.locator('[data-ui-page="capture"]').getByRole("heading", { name: title })).toBeVisible();
      await expect.poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBeTruthy();
      await page.goto("/#/documents");
      await expect(page.locator('[data-ui-page="documents"]')).toBeVisible();
      await expect.poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBeTruthy();
      await page.goto("/#/capture");
    }
  });
}


test("Contract notice editor translates in place without creating or changing a contract record", async ({
  page,
}) => {
  await page.goto("/#/contract");
  const surface = page.locator('[data-ui-page="contract"]');
  await expect(surface).toBeVisible();
  const add = surface.getByRole("button", { name: "계약통지 기록 추가", exact: true });
  await expect(add).toBeEnabled();
  await add.click();

  const dialog = page.locator('[role="dialog"].modal');
  await expect(dialog).toHaveAttribute("aria-label", "계약통지 기록 추가");
  await expect(dialog.getByText(/미리보기 모드에서는 입력 화면만 확인/)).toBeVisible();
  const titleInput = dialog.getByRole("textbox", { name: "제목 *", exact: true });
  const numberInput = dialog.getByRole("textbox", { name: "계약통지 번호 *", exact: true });
  await titleInput.fill("SITE-CONTRACT-001");
  await numberInput.fill("NT-001");

  let mutationRequests = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/")) mutationRequests += 1;
  });

  const locale = page.locator(".topbar .role-picker select").first();
  await locale.selectOption("vi");
  await expect(dialog).toHaveAttribute("aria-label", "Thêm hồ sơ Thông báo hợp đồng");
  await expect(dialog.locator("input").first()).toHaveValue("SITE-CONTRACT-001");
  await expect(dialog.locator("input").nth(1)).toHaveValue("NT-001");
  await expect(dialog.getByRole("button", { name: "Thêm hồ sơ" })).toBeDisabled();
  await expect(dialog.getByText(/Giao diện không quyết định thẩm quyền/)).toBeVisible();

  await locale.selectOption("en");
  await expect(dialog).toHaveAttribute("aria-label", "Add Contract notice record");
  await expect(dialog.getByRole("combobox", { name: "Original contract event *" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add record" })).toBeDisabled();
  await expect(dialog.locator("input").first()).toHaveValue("SITE-CONTRACT-001");

  await locale.selectOption("ko");
  await expect(dialog).toHaveAttribute("aria-label", "계약통지 기록 추가");
  await dialog.getByRole("button", { name: "대화상자 닫기" }).click();
  await surface.getByRole("tab", { name: "클레임", exact: true }).click();
  await expect(surface.getByRole("button", { name: "클레임 기록 추가" })).toBeVisible();
  await surface.getByRole("tab", { name: "공기연장(EOT)", exact: true }).click();
  await expect(surface.getByRole("button", { name: "공기연장(EOT) 기록 추가" })).toBeVisible();
  expect(mutationRequests).toBe(0);
});

test("Evidence summary, origin, and technical metadata translate without changing source evidence", async ({
  page,
}) => {
  await page.goto("/#/capture");
  await page.locator('[data-ui-component="evidence-viewer"]').getByRole("button").first().click();
  const sheet = page.locator('[data-ui-component="evidence-detail-sheet"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("판정 경계", { exact: true })).toBeVisible();
  await expect(sheet).toContainText("EVD-UI-001");

  const locale = page.locator(".topbar .role-picker select").first();
  await locale.selectOption("vi");
  await expect(page.locator("html")).toHaveAttribute("lang", "vi-VN");
  await expect(sheet.getByText("Ranh giới quyết định", { exact: true })).toBeVisible();
  await sheet.getByRole("tab", { name: "Nguồn gốc · Liên kết" }).click();
  await expect(sheet.getByText(/Hồ sơ này được lưu giữ dưới dạng gốc/)).toBeVisible();
  await sheet.getByRole("tab", { name: "Thông tin kỹ thuật" }).click();
  await expect(sheet.getByText("Phiên bản hồ sơ gốc", { exact: true })).toBeVisible();
  await expect(sheet).toContainText("EVD-UI-001");

  await locale.selectOption("en");
  await expect(sheet.getByRole("tab", { name: "Technical details" })).toBeVisible();
  await expect(sheet.getByText("Source record version", { exact: true })).toBeVisible();
  await sheet.getByRole("tab", { name: "Provenance · Links" }).click();
  await expect(sheet.getByText(/Derived images, transcripts and analysis results do not replace it/)).toBeVisible();

  await locale.selectOption("ko");
  await expect(sheet.getByRole("tab", { name: "출처·연결" })).toBeVisible();
  await expect(sheet).toContainText("EVD-UI-001");
});

test("Exact decimal formatting preserves large amounts and long fractional strings in Chromium", async ({
  page,
}) => {
  await page.goto("about:blank");
  const source = formatDecimalExact.toString();
  const output = await page.evaluate(({ functionSource }) => {
    const formatter = new Function(`return (${functionSource})`)() as (
      value: string,
      locale: string,
      currency?: string,
    ) => string;
    const amount = "9007199254740993.12345678901234567890";
    return {
      english: formatter(amount, "en-US", "USD"),
      korean: formatter(amount, "ko-KR", "USD"),
      vietnamese: formatter(amount, "vi-VN", "USD"),
      negativeZero: formatter("-0.00000000000000000012", "en-US", "USD"),
    };
  }, { functionSource: source });

  expect(output.english).toBe("$9,007,199,254,740,993.12345678901234567890");
  expect(output.korean).toBe("US$9,007,199,254,740,993.12345678901234567890");
  expect(output.vietnamese).toBe("9.007.199.254.740.993,12345678901234567890 US$");
  expect(output.negativeZero).toBe("-$0.00000000000000000012");
});

for (const width of [390, 1440]) {
  test("Contract and evidence details remain within viewport at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: 920 });
    await page.goto("/#/contract");
    const locale = page.locator(".topbar .role-picker select").first();
    for (const language of ["vi", "en", "ko"]) {
      await locale.selectOption(language);
      await expect(page.locator('[data-ui-page="contract"]')).toBeVisible();
      await expect.poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBeTruthy();
    }
    await page.goto("/#/capture");
    await page.locator('[data-ui-component="evidence-viewer"]').getByRole("button").first().click();
    const sheet = page.locator('[data-ui-component="evidence-detail-sheet"]');
    for (const language of ["vi", "en", "ko"]) {
      await locale.selectOption(language);
      await expect(sheet).toBeVisible();
      await expect.poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBeTruthy();
      await expect.poll(async () => {
        const box = await sheet.boundingBox();
        return box !== null && box.x + box.width <= width + 1;
      }).toBeTruthy();
    }
  });
}
