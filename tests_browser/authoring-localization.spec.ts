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

async function login(request: APIRequestContext, actorGroup: string): Promise<Session> {
  const response = await request.post("/api/dev/sessions", { data: { actorGroup } });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

function auth(session: Session) {
  return { Authorization: `Bearer ${session.accessToken}`, "X-RoleAssignment-Id": session.actor.roleAssignmentId };
}

async function chooseLocale(page: Page, language: "ko" | "vi" | "en") {
  await page.locator(".top-actions .role-picker select").first().selectOption(language);
  await expect(page.locator("html")).toHaveAttribute("lang", locales[language].html);
}

test("connected authoring and document UI preserve drafts and source records across locales; missing verifier is refused in each locale", async ({ page, request }) => {
  const session = await login(request, "SUP");
  const workspaceResponse = await request.get(`/api/projects/${session.projectId}/workspace`, { headers: auth(session) });
  expect(workspaceResponse.status(), await workspaceResponse.text()).toBe(200);
  const initialWorkspace = await workspaceResponse.json();
  const officialSource = initialWorkspace.items.find((item: any) => item.machine === "inspection" && item.record.status === "passed");
  expect(officialSource, "the isolated demo API must provide one readable passed Inspection source").toBeTruthy();
  const originalSource = structuredClone(officialSource.record);
  const mutationRequests: string[] = [];
  page.on("request", (browserRequest) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(browserRequest.method()) && browserRequest.url().includes("/api/")) {
      mutationRequests.push(`${browserRequest.method()} ${browserRequest.url()}`);
    }
  });

  await page.goto("/#/safety");
  const safetyPanel = page.locator('[data-ui-component="safety-authoring-panel"]');
  await expect(safetyPanel).toBeVisible();
  const title = safetyPanel.getByLabel("기록 제목", { exact: true });
  const draftTitle = "Locale preservation only · SAFETY-DRAFT-LOCALIZATION";
  await title.fill(draftTitle);
  await safetyPanel.locator("textarea").first().fill("Entered once; no official record is submitted.");
  const writesBeforeLocaleChanges = mutationRequests.length;
  for (const language of ["vi", "en", "ko"] as const) {
    await chooseLocale(page, language);
    await expect(safetyPanel.getByRole("heading", { name: new RegExp(locales[language].safetyTitle) })).toBeVisible();
    await expect(safetyPanel.getByLabel(language === "ko" ? "기록 제목" : language === "vi" ? "Tiêu đề hồ sơ" : "Record title", { exact: true })).toHaveValue(draftTitle);
    await expect(safetyPanel.locator("textarea").first()).toHaveValue("Entered once; no official record is submitted.");
  }
  expect(mutationRequests.slice(writesBeforeLocaleChanges)).toEqual([]);
  await page.goto("/#/documents");
  const editor = page.locator("form.editor-pane");
  await expect(editor).toBeVisible();
  await editor.locator("select").nth(0).selectOption("FM-09");
  const sourceSelect = editor.locator("select").nth(1);
  await sourceSelect.selectOption(officialSource.record.id);
  await expect(sourceSelect).toHaveValue(officialSource.record.id);
  const languageSelect = editor.locator("select").nth(2);
  await languageSelect.selectOption("vi");
  const fact = "PRESERVED-FINAL-RENDER-INPUT";
  const factInput = editor.locator('input[name="inspection.no"]');
  await factInput.fill(fact);
  await editor.locator("select").nth(3).selectOption("final");
  for (const input of await editor.locator(".document-fields input").all()) {
    const name = await input.getAttribute("name");
    const type = await input.getAttribute("type");
    if (name === "inspection.no") continue;
    await input.fill(type === "datetime-local" ? "2026-10-08T12:00" : `LOCALIZATION-${name}`);
  }
  await editor.locator('select[name="result.next_work_allowed"]').selectOption("true");

  const beforeDocumentLocaleSwitch = mutationRequests.length;
  for (const language of ["ko", "vi", "en"] as const) {
    await chooseLocale(page, language);
    await expect(editor.locator("select").nth(0)).toHaveValue("FM-09");
    await expect(sourceSelect).toHaveValue(officialSource.record.id);
    await expect(factInput).toHaveValue(fact);
    await expect(editor.locator("label").filter({ hasText: locales[language].documentFact }).first()).toBeVisible();
    await expect(editor.locator("select").nth(3)).toHaveValue("final");
  }
  expect(mutationRequests.slice(beforeDocumentLocaleSwitch)).toEqual([]);
  const render = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/forms/FM-09/render"));
  await editor.getByRole("button", { name: "Generate final HTML snapshot", exact: true }).click();
  const renderResponse = await render;
  expect(renderResponse.status(), await renderResponse.text()).toBe(200);
  const snapshot = await renderResponse.json();
  expect(snapshot.status).toBe("final");

  const signing = page.getByRole("region", { name: locales.en.signingRegion });
  await expect(signing).toBeVisible();
  const signer = signing.getByLabel(locales.en.signerRole, { exact: true });
  const signerValue = "owner_side_supervisor";
  await expect(signer.locator(`option[value="${signerValue}"]`)).toHaveCount(1);
  await signer.selectOption(signerValue);
  await signing.getByLabel(locales.en.method, { exact: true }).selectOption("approved_e_signature");
  for (const language of ["ko", "vi", "en"] as const) {
    await chooseLocale(page, language);
    const localizedSigning = page.getByRole("region", { name: locales[language].signingRegion });
    await expect(localizedSigning.getByLabel(locales[language].signerRole, { exact: true })).toHaveValue(signerValue!);
    await expect(localizedSigning.getByLabel(locales[language].method, { exact: true })).toHaveValue("approved_e_signature");
    const refusal = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith(`/documents/${snapshot.id}/sign`));
    await localizedSigning.getByRole("button", { name: locales[language].submit, exact: true }).click();
    const refusalResponse = await refusal;
    expect(refusalResponse.status(), await refusalResponse.text()).toBe(501);
    expect((await refusalResponse.json()).code).toBe("ADAPTER_NOT_CONFIGURED");
    await expect(localizedSigning.getByRole("alert")).toHaveText(locales[language].refusal);
  }
  expect(mutationRequests.filter((entry) => /\/(commands|transitions)\//.test(entry))).toEqual([]);
  expect(mutationRequests.filter((entry) => entry.endsWith(`/documents/${snapshot.id}/sign`))).toHaveLength(3);

  const finalWorkspaceResponse = await request.get(`/api/projects/${session.projectId}/workspace`, { headers: auth(session) });
  expect(finalWorkspaceResponse.status()).toBe(200);
  const finalWorkspace = await finalWorkspaceResponse.json();
  const stillOriginal = finalWorkspace.items.find((item: any) => item.record.id === originalSource.id)?.record;
  expect(stillOriginal).toEqual(originalSource);
});

test("UI mock keeps Safety creation unavailable and exposes no signing action without an official final snapshot", async ({ page }) => {
  await page.goto("http://127.0.0.1:5194/#/safety");
  const safetyPanel = page.locator('[data-ui-component="safety-authoring-panel"]');
  await expect(safetyPanel).toBeVisible();
  for (const [language, createLabel] of [
    ["ko", "안전 초안 저장"], ["vi", "Lưu bản nháp an toàn"], ["en", "Save Safety draft"],
  ] as const) {
    await chooseLocale(page, language);
    await expect(safetyPanel.getByRole("button", { name: createLabel, exact: true })).toBeDisabled();
  }

  await page.goto("http://127.0.0.1:5194/#/documents");
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
