import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { formFieldLabels } from "@doul/localization";

type Session = {
  accessToken: string;
  projectId: string;
  actor: { roleAssignmentId: string };
};

const locales = {
  ko: { html: "ko-KR", safetyTitle: "안전 기록 초안 작성", documentFact: formFieldLabels["inspection.no"].ko,
    signingRegion: "법적 서명", signerRole: "현재 서명 역할", method: "서명 방식", submit: "서명 검증 요청",
    refusal: "운영 서비스 연동 전입니다." },
  vi: { html: "vi-VN", safetyTitle: "Tạo bản nháp hồ sơ an toàn", documentFact: formFieldLabels["inspection.no"].vi,
    signingRegion: "Chữ ký pháp lý", signerRole: "Vai trò ký hiện tại", method: "Phương thức ký", submit: "Yêu cầu xác minh chữ ký",
    refusal: "Dịch vụ xử lý chưa được cấu hình." },
  en: { html: "en-US", safetyTitle: "Create a Safety draft", documentFact: formFieldLabels["inspection.no"].en,
    signingRegion: "Legal signature", signerRole: "Current signer role", method: "Signing method", submit: "Request signature verification",
    refusal: "The processing service is not configured." },
} as const;

async function chooseLocale(page: Page, language: "ko" | "vi" | "en") {
  await page.locator(".top-actions .role-picker select").first().selectOption(language);
  await expect(page.locator("html")).toHaveAttribute("lang", locales[language].html);
}

test("UI mock keeps Safety creation unavailable and exposes no signing action without an official final snapshot", async ({ page }) => {
  await page.goto("/#/safety");
  const safetyPanel = page.locator('[data-ui-component="safety-authoring-panel"]');
  await page.locator('[data-ui-component="safety-create-disclosure"] summary').click();
  await expect(safetyPanel).toBeVisible();
  for (const [language, createLabel] of [
    ["ko", "안전 초안 저장"], ["vi", "Lưu bản nháp an toàn"], ["en", "Save Safety draft"],
  ] as const) {
    await chooseLocale(page, language);
    await expect(safetyPanel.getByRole("button", { name: createLabel, exact: true })).toBeDisabled();
  }

  await page.goto("/#/documents");
  await chooseLocale(page, "ko");
  const signingKo = page.getByRole("region", { name: locales.ko.signingRegion });
  await expect(signingKo.getByText("서명할 최종 문서가 없습니다. 먼저 최종 문서를 생성하세요.", { exact: true })).toBeVisible();
  await expect(signingKo.getByRole("button", { name: locales.ko.submit })).toHaveCount(0);
  await chooseLocale(page, "vi");
  const signingVi = page.getByRole("region", { name: locales.vi.signingRegion });
  await expect(signingVi.getByText("Không có tài liệu cuối cùng để ký. Hãy tạo tài liệu cuối cùng trước.", { exact: true })).toBeVisible();
  await expect(signingVi.getByRole("button", { name: locales.vi.submit })).toHaveCount(0);
  await chooseLocale(page, "en");
  const signingEn = page.getByRole("region", { name: locales.en.signingRegion });
  await expect(signingEn.getByText("There are no final documents to sign. Create a final document first.", { exact: true })).toBeVisible();
  await expect(signingEn.getByRole("button", { name: locales.en.submit })).toHaveCount(0);
});
