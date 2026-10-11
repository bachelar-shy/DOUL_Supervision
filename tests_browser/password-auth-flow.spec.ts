import { expect, test, type Page } from "@playwright/test";

async function configurePasswordMode(page: Page, authentication = "local-password-pinned-rs256") {
  await page.route("**/api/health", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ mode: "staging", adapters: { authentication } }),
  }));
}

const session = {
  accessToken: "test.synthetic.token",
  projectId: "synthetic-project",
  actor: { partyId: "synthetic-party", roleAssignmentId: "synthetic-role", actorGroup: "SUP", name: "Test Supervisor" },
  mode: "PASSWORD",
};

test("password mode rejects an external-mode API instead of exposing demo roles", async ({ page }) => {
  await configurePasswordMode(page, "pinned-rs256-access-token");
  await page.goto("/#/today");
  await expect(page.getByRole("alert")).toContainText("로그인 설정이 서버와 일치하지 않습니다");
  await expect(page.getByText("시험 사용자 역할")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "아이디" })).toHaveCount(0);
});

test("401 after password login returns to login with a lost-draft warning", async ({ page }) => {
  await configurePasswordMode(page);
  await page.route("**/api/auth/login", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/projects/*/workspace", route => route.fulfill({
    status: 401, contentType: "application/json",
    body: JSON.stringify({ code: "UNAUTHENTICATED", message: "Expired", failedGuards: [] }),
  }));
  await page.goto("/#/today");
  await page.getByRole("textbox", { name: "아이디" }).fill("testsupervisor");
  await page.getByLabel("비밀번호").fill("example-password-not-real");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByRole("alert")).toContainText("로그인 시간이 만료되었습니다");
  await expect(page.getByRole("textbox", { name: "아이디" })).toBeVisible();
  await expect(page.getByText("시험 사용자 역할")).toHaveCount(0);
});

test("failed logout warns that server revocation was not confirmed", async ({ page }) => {
  await configurePasswordMode(page);
  await page.route("**/api/auth/login", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/projects/*/workspace", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      project: { id: session.projectId, projectId: session.projectId, name: "Synthetic test project" },
      role: { id: session.actor.roleAssignmentId, actorGroup: "SUP" },
      items: [], audit: [], participants: [], formSchemas: [],
      context: { scope: { discipline: "architecture", packageId: "package", locationId: "location" } },
      demo: false,
    }),
  }));
  await page.route("**/api/auth/logout", route => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ code: "UNAVAILABLE", message: "Network", failedGuards: [] }),
  }));
  await page.goto("/#/today");
  await page.getByRole("textbox", { name: "아이디" }).fill("testsupervisor");
  await page.getByLabel("비밀번호").fill("example-password-not-real");
  await page.getByRole("button", { name: "로그인" }).click();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("alert")).toContainText("서버 로그아웃을 확인하지 못했습니다");
});

test("password screen labels use selected Vietnamese locale", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("doul.locale", "vi"));
  await configurePasswordMode(page);
  await page.goto("/#/today");
  await expect(page.getByRole("textbox", { name: "Tên đăng nhập" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Đăng nhập" })).toBeVisible();
});


test("password login binds the five field workflows to the authenticated supervisor role", async ({ page }) => {
  let projectDirectoryRequests = 0;
  await configurePasswordMode(page);
  await page.route("**/api/dev/projects", route => {
    projectDirectoryRequests++;
    return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/auth/login", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(session),
  }));
  await page.route("**/api/projects/*/workspace", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      project: { id: session.projectId, projectId: session.projectId, name: "Synthetic password-only project" },
      role: { id: session.actor.roleAssignmentId, actorGroup: "SUP" },
      items: [], audit: [], participants: [], formSchemas: [],
      context: { scope: { discipline: "structure", packageId: "package", locationId: "location" } },
      demo: false,
    }),
  }));
  await page.goto("/#/today");
  await page.getByRole("textbox", { name: "아이디" }).fill("testsupervisor");
  await page.getByLabel("비밀번호").fill("example-password-not-real");
  await page.getByRole("button", { name: "로그인" }).click();
  const sidebar = page.locator("aside.sidebar");
  for (const name of ["오늘", "현장기록", "도면조회", "검측·검수", "지적·시정조치", "감리보고"]) {
    await expect(sidebar.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(sidebar.getByText("공정·지연·회복", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("프로젝트 선택")).toHaveCount(0);
  await expect(page.getByLabel("시험 사용자 역할 선택")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  expect(projectDirectoryRequests).toBe(0);
});
