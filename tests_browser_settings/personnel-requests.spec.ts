import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, username: string, password: string) {
  await page.getByRole("textbox", { name: "아이디", exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
}

test("non-admin personnel request reaches only its project administrator and review is visible", async ({ page }) => {
  const username = "staff" + Date.now() + Math.floor(Math.random() * 10000);
  const password = "Synthetic-Password-34";
  const name = "추가감리자" + Date.now();
  await page.goto("/#/admin");
  await login(page, "operator", "Synthetic-Password-12");
  await page.goto("/#/admin");
  await page.getByRole("tab", { name: "로그인계정", exact: true }).click();
  const admin = page.getByRole("tabpanel", { name: "로그인계정", exact: true });
  await admin.getByRole("combobox", { name: "계정 역할", exact: true }).selectOption("SUP");
  await admin.getByRole("combobox", { name: "담당자·역할", exact: true })
    .selectOption({ label: "감리자 · 가상 감리책임자 · 기존 감리 회사" });
  await admin.getByLabel("로그인 아이디", { exact: true }).fill(username);
  await admin.getByLabel("초기 비밀번호", { exact: true }).fill(password);
  await admin.getByRole("button", { name: "계정 생성", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "로그인 계정을 등록했습니다" })).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();

  await login(page, username, password);
  await expect(page.locator("aside.sidebar").getByText("프로젝트 설정", { exact: true })).toHaveCount(0);
  await expect(page.locator("aside.sidebar").getByText("인원 추가 요청", { exact: true })).toHaveCount(1);
  await page.goto("/#/staff-requests");
  const requestPage = page.locator('[data-ui-component="personnel-requests"]');
  await expect(requestPage).toBeVisible();
  await expect(requestPage.getByRole("button", { name: "계정 생성", exact: true })).toHaveCount(0);
  await expect(requestPage.getByRole("button", { name: "＋ 프로젝트 추가", exact: true })).toHaveCount(0);
  const form = requestPage.getByRole("form", { name: "인원 추가 요청 작성" });
  await form.getByLabel("추가 요청 인원 이름", { exact: true }).fill(name);
  await form.getByLabel("소속 회사", { exact: true }).fill("테스트 감리회사");
  await form.getByLabel("요청 역할", { exact: true }).selectOption("SUP");
  await form.getByLabel("추가 요청 사유", { exact: true }).fill("프로젝트 인원 보강");
  const submit = form.getByRole("button", { name: "관리자에게 요청 보내기" });
  expect((await submit.boundingBox())?.height).toBeGreaterThanOrEqual(43.5);
  await submit.click();
  await expect(requestPage.getByRole("status").filter({ hasText: "관리자 접수함에 전달했습니다" })).toBeVisible();
  await expect(requestPage.getByText(name, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();

  await login(page, "operator", "Synthetic-Password-12");
  await page.goto("/#/admin");
  await page.getByRole("tab", { name: "인원 추가 요청 접수함", exact: true }).click();
  const inbox = page.locator('[data-ui-component="personnel-requests"]');
  await expect(inbox.getByText(name, { exact: false })).toBeVisible();
  await expect(inbox.getByText("관리자 검토 대기", { exact: true })).toBeVisible();
  await inbox.getByRole("button", { name: "승인 · 등록은 별도", exact: true }).click();
  await expect(inbox.getByRole("status").filter({ hasText: "요청을 승인했습니다" })).toBeVisible();
  await expect(inbox.locator("article").filter({ hasText: name }).getByText("관리자 승인 · 계정 미발급", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();

  await login(page, username, password);
  await page.goto("/#/staff-requests");
  await expect(page.locator('[data-ui-component="personnel-requests"]').locator("article").filter({ hasText: name }).getByText("관리자 승인 · 계정 미발급", { exact: true })).toBeVisible();
  await expect(page.locator("aside.sidebar").getByText("프로젝트 설정", { exact: true })).toHaveCount(0);
});
