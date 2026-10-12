import { expect, test, type Page } from "@playwright/test";
import { formatDecimalExact } from "../apps/web/src/i18n/decimal-format";
import { formFieldLabels } from "@doul/localization";

async function chooseLanguage(page: Page, currentAria: string, language: string) {
  await page.getByRole("combobox", { name: currentAria }).selectOption(language);
}

test("Korean, Vietnamese and English field views switch without changing form identifiers", async ({
  page,
}) => {
  await page.goto("/#/documents");
  const form = page.getByRole("combobox", { name: "문서 양식" });
  await expect(form).toHaveValue("FM-20");
  await expect(page.getByRole("heading", { name: "감리보고서·양식 작성" })).toBeVisible();

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
  await expect(page.getByLabel(formFieldLabels["urgent.fact"].vi)).toBeVisible();
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
  await expect(page.getByLabel(formFieldLabels["urgent.fact"].en)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Document form" })).toHaveValue("FM-20");
  expect(renderRequests).toBe(0);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("heading", { name: "Data-linked document" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("doul.locale"))).toBe("en");

  await chooseLanguage(page, "Select display language", "ko");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
  await expect(page.getByLabel(formFieldLabels["urgent.fact"].ko)).toBeVisible();
});

for (const width of [390, 768, 1440]) {
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
  await page.setViewportSize({ width: 390, height: 940 });
  await page.goto("/#/contract");
  const surface = page.locator('[data-ui-page="contract"]');
  await expect(surface).toBeVisible();
  const add = surface.getByRole("button", { name: "계약통지 기록 추가", exact: true });
  await expect(add).toBeEnabled();
  const createAction = surface.locator(".schedule-list-actions button");
  const createActionEnabled = await createAction.isEnabled();
  expect(createActionEnabled).toBe(true);
  await add.click();

  const dialog = page.locator('[role="dialog"].modal');
  await expect(dialog).toHaveAttribute("aria-label", "계약통지 기록 추가");
  await expect(dialog.getByText(/생성 권한과 범위는 제출 시 업무 시스템이 다시 검증/)).toBeVisible();
  const titleInput = dialog.getByRole("textbox", { name: "제목 *", exact: true });
  const numberInput = dialog.getByRole("textbox", { name: "계약통지 번호 *", exact: true });
  await titleInput.fill("SITE-CONTRACT-001");
  await numberInput.fill("NT-001");
  const submitButton = () => dialog.getByRole("button", { name: "기록 추가", exact: true });
  const submitEnabled = await submitButton().isEnabled();
  expect(submitEnabled).toBe(true);

  let mutationRequests = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/")) mutationRequests += 1;
  });

  const locale = page.locator(".topbar .role-picker select").first();
  await locale.selectOption("vi");
  await expect(dialog).toHaveAttribute("aria-label", "Thêm hồ sơ Thông báo hợp đồng");
  await expect(dialog.getByText(/Máy chủ sẽ kiểm tra lại quyền và phạm vi tại thời điểm nộp/)).toBeVisible();
  await expect(dialog.locator("input").first()).toHaveValue("SITE-CONTRACT-001");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  await expect(dialog.locator("input").nth(1)).toHaveValue("NT-001");
  await expect(dialog.getByRole("button", { name: "Thêm hồ sơ" })).toBeEnabled();
  expect(await createAction.isEnabled()).toBe(createActionEnabled);
  expect(await dialog.getByRole("button", { name: "Thêm hồ sơ" }).isEnabled()).toBe(submitEnabled);

  await locale.selectOption("en");
  await expect(dialog).toHaveAttribute("aria-label", "Add Contract notice record");
  await expect(dialog.getByText(/The server rechecks permissions and scope at submission/)).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Original contract event *" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add record" })).toBeEnabled();
  expect(await createAction.isEnabled()).toBe(createActionEnabled);
  expect(await dialog.getByRole("button", { name: "Add record" }).isEnabled()).toBe(submitEnabled);
  await expect(dialog.locator("input").first()).toHaveValue("SITE-CONTRACT-001");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();

  await locale.selectOption("ko");
  await expect(dialog).toHaveAttribute("aria-label", "계약통지 기록 추가");
  expect(await createAction.isEnabled()).toBe(createActionEnabled);
  expect(await submitButton().isEnabled()).toBe(submitEnabled);
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
  const evidenceRow = page.locator('[data-ui-component="evidence-viewer"] button').first();
  await expect(evidenceRow).toBeVisible();
  const rawTitle = await evidenceRow.locator("strong").innerText();
  await evidenceRow.click();
  const sheet = page.locator('[data-ui-component="evidence-detail-sheet"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("판정 경계", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("heading").first()).toHaveText(rawTitle);
  let mutationRequests = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/")) mutationRequests += 1;
  });

  const readFieldValue = async (label: string) =>
    sheet.getByText(label, { exact: true }).locator("..").locator("div").innerText();
  await sheet.getByRole("tab", { name: "출처·연결" }).click();
  const evidenceId = await readFieldValue("증빙 번호");
  expect(evidenceId.trim()).not.toBe("");
  await sheet.getByRole("tab", { name: "기술정보" }).click();
  const sourceVersion = await readFieldValue("원본 기록 작성 차수");

  const locale = page.locator(".topbar .role-picker select").first();
  await locale.selectOption("vi");
  await expect(page.locator("html")).toHaveAttribute("lang", "vi-VN");
  await expect(sheet.getByRole("heading").first()).toHaveText(rawTitle);
  await sheet.getByRole("tab", { name: "Thông tin cơ bản" }).click();
  await expect(sheet.getByText("Ranh giới quyết định", { exact: true })).toBeVisible();
  await sheet.getByRole("tab", { name: "Nguồn gốc · Liên kết" }).click();
  await expect(await readFieldValue("Mã minh chứng")).toBe(evidenceId);
  await expect(sheet.getByText(/Hồ sơ này được lưu giữ dưới dạng gốc/)).toBeVisible();
  await sheet.getByRole("tab", { name: "Thông tin kỹ thuật" }).click();
  await expect(sheet.getByText("Phiên bản hồ sơ gốc", { exact: true })).toBeVisible();
  await expect(await readFieldValue("Phiên bản hồ sơ gốc")).toBe(sourceVersion);

  await locale.selectOption("en");
  await expect(sheet.getByRole("heading").first()).toHaveText(rawTitle);
  await expect(sheet.getByRole("tab", { name: "Technical details" })).toBeVisible();
  await expect(sheet.getByText("Source record version", { exact: true })).toBeVisible();
  await expect(await readFieldValue("Source record version")).toBe(sourceVersion);
  await sheet.getByRole("tab", { name: "Provenance · Links" }).click();
  await expect(await readFieldValue("Evidence ID")).toBe(evidenceId);
  await expect(sheet.getByText(/Derived images, transcripts and analysis results do not replace it/)).toBeVisible();

  await locale.selectOption("ko");
  await expect(sheet.getByRole("heading").first()).toHaveText(rawTitle);
  await sheet.getByRole("tab", { name: "출처·연결" }).click();
  await expect(await readFieldValue("증빙 번호")).toBe(evidenceId);
  await sheet.getByRole("tab", { name: "기술정보" }).click();
  await expect(await readFieldValue("원본 기록 작성 차수")).toBe(sourceVersion);
  await expect(sheet.getByRole("tab", { name: "출처·연결" })).toBeVisible();
  expect(mutationRequests).toBe(0);
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

for (const width of [390, 768, 1440]) {
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

for (const width of [390, 768, 1440]) {
  test(`Localized field workspace keeps controls and headings in bounds at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000); // Fifteen real API-backed screens in each of three languages.
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/#/today");
    const locale = page.locator(".topbar .role-picker select").first();
    for (const language of ["ko", "vi", "en"] as const) {
      await locale.selectOption(language);
      await expect(page.locator("html")).toHaveAttribute("lang", { ko: "ko-KR", vi: "vi-VN", en: "en-US" }[language]);
      for (const route of ["today", "inspections", "capture", "observations", "issues", "actions", "schedule", "contract", "payment", "completion", "safety", "owner", "documents", "registers", "rfis"]) {
        await test.step(`${language}/${route}/${width}`, async () => {
          await page.goto("/#/" + route);
          if (route === "drawings") {
            await expect(page.locator('[data-ui-component="drawing-sheet-workspace"] .drawing-sheet-commandbar')).toBeVisible();
          } else {
            await expect(page.locator("main .page-heading h1")).toBeVisible();
          }
          const surface = route === "registers" ? '[data-ui-template="register"]' : `[data-ui-page="${route === "payment" ? "measurement-payment" : route === "completion" ? "completion-handover" : route}"]`;
          await expect(page.locator(surface)).toBeVisible();
          await expect(page.locator("html")).toHaveAttribute("lang", { ko: "ko-KR", vi: "vi-VN", en: "en-US" }[language]);
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), { message: `${language}/${route}: horizontal overflow` }).toBeTruthy();
          if (width === 390) {
            await expect(page.locator(".bottom-nav").getByRole("button", { name: { ko: "더보기", vi: "Thêm", en: "More" }[language], exact: true })).toBeVisible();
          }
          const defects = await page.locator("main").evaluate((main) => {
            const result: string[] = [];
            for (const element of main.querySelectorAll<HTMLElement>("button, input:not([type=hidden]), select, textarea, h1")) {
              const box = element.getBoundingClientRect();
              if (!box.width || !box.height || getComputedStyle(element).visibility === "hidden") continue;
              // Explicit scrolling tables preserve their columns within a scrollable viewport.
              let scrollContainer: HTMLElement | null = element.parentElement;
              while (scrollContainer && scrollContainer !== main && !["auto", "scroll"].includes(getComputedStyle(scrollContainer).overflowX)) scrollContainer = scrollContainer.parentElement;
              if (scrollContainer && scrollContainer !== main) continue;
              if (box.left < -1 || box.right > innerWidth + 1) result.push(`${element.tagName}: ${element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 60)} [${Math.round(box.left)},${Math.round(box.right)}]`);
            }
            const title = main.querySelector(".page-heading h1")?.getBoundingClientRect();
            for (const button of main.querySelectorAll(".heading-actions button")) {
              const box = button.getBoundingClientRect();
              if (title && box.width && Math.min(title.right, box.right) - Math.max(title.left, box.left) > 1 && Math.min(title.bottom, box.bottom) - Math.max(title.top, box.top) > 1) result.push("page title overlaps its action button");
            }
            return result;
          });
          expect(defects, `${language}/${route}: displaced or overlapping controls`).toEqual([]);
          if (width === 390 && ["capture", "payment", "completion"].includes(route)) {
            await page.screenshot({ path: testInfo.outputPath(`${language}-${route}-390.png`), fullPage: true });
          }
        });
      }
    }
  });
}
