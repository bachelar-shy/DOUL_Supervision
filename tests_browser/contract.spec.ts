import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

type ActorGroup = "CON" | "SUP" | "OWN";

async function selectRole(page: Page, role: ActorGroup) {
  const route = new URL(page.url()).hash || "#/today";
  const picker = page.getByRole("combobox", { name: "시험 사용자 역할 선택" });
  if ((await picker.inputValue()) !== role) {
    const response = page.waitForResponse(
      (value) => value.url().endsWith("/workspace") && value.ok(),
    );
    await picker.selectOption(role);
    await response;
  }
  await page.goto("/" + route);
}

async function evidenceId(request: APIRequestContext) {
  const sessionResponse = await request.post("/api/dev/sessions", {
    data: { actorGroup: "CON" },
  });
  expect(sessionResponse.status()).toBe(200);
  const session = await sessionResponse.json();
  const workspaceResponse = await request.get(
    `/api/projects/${session.projectId}/workspace`,
    {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "X-RoleAssignment-Id": session.actor.roleAssignmentId,
      },
    },
  );
  expect(workspaceResponse.status()).toBe(200);
  return (await workspaceResponse.json()).context.evidenceId as string;
}

async function createNotice(page: Page) {
  const suffix = randomUUID().slice(0, 8);
  const title = `계약통지 화면 ${suffix}`;

  await page.goto("/#/contract");
  await selectRole(page, "CON");
  await expect(
    page.locator('[data-ui-component="contract-workspace"]'),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "계약통지 기록 추가", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "계약통지 기록 추가" });
  await dialog.getByLabel("제목 *", { exact: true }).fill(title);
  await dialog
    .getByLabel("계약통지 번호 *", { exact: true })
    .fill(`NT-UI-${suffix}`);
  await dialog.getByLabel("계약사건 원본 *").selectOption({ index: 1 });
  await dialog.getByLabel("수신자 *").selectOption({ index: 1 });
  await dialog.getByLabel("통지 제목 *").fill("계약상 권리 보전 통지");

  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/contract-notices") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "기록 추가", exact: true }).click();
  const response = await createdResponse;
  expect(response.status()).toBe(201);
  const record = (await response.json()).record;
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".detail-head")).toContainText(title);
  await expect(
    page.locator('[data-ui-component="status-boundary-group"]'),
  ).toContainText("기한초과 위험");
  return { title, record };
}

test("Contract create affordance follows the server capability", async ({
  page,
}) => {
  await page.route("**/workspace", async (route) => {
    const response = await route.fetch();
    const workspace = await response.json();
    workspace.context.creationCapabilities = {
      ...(workspace.context.creationCapabilities || {}),
      contract_notice: {
        machine: "contract_notice",
        authority: "contract.notice.identify",
        status: "unauthorized",
        canCreate: false,
        reasons: ["NOT_AUTHORIZED"],
      },
    };
    await route.fulfill({ response, json: workspace });
  });

  await page.goto("/#/contract");
  const create = page.getByRole("button", {
    name: "계약통지 기록 추가",
    exact: true,
  });
  await expect(create).toBeDisabled();
  await expect(page.getByTestId("creation-capability-reason")).toContainText(
    "현재 역할은 초안을 작성할 권한이 없습니다.",
  );
  await create.click({ force: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Contract Notice creates, calculates due date, and submits through real API", async ({
  page,
  request,
}) => {
  const { title, record } = await createNotice(page);
  const evidence = await evidenceId(request);

  await selectRole(page, "SUP");
  await page
    .getByRole("button")
    .filter({ hasText: title })
    .first()
    .click();
  await page
    .getByRole("button", { name: "계약통지 기한 확인", exact: true })
    .click();

  const dueDialog = page.getByRole("dialog", {
    name: "계약통지 기한 확인",
  });
  await dueDialog
    .getByRole("textbox", { name: "공식 통지기한" })
    .fill(record.data.awareAt);

  const dueResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/${record.id}/calculate-notice-due`),
  );
  await dueDialog
    .getByRole("button", { name: "확인 후 실행", exact: true })
    .click();
  expect((await dueResponse).status()).toBe(200);
  await expect(page.locator(".detail-head .badge")).toContainText(
    "통지기한 확인",
  );

  await selectRole(page, "CON");
  await page
    .getByRole("button")
    .filter({ hasText: title })
    .first()
    .click();
  await page
    .getByRole("button", { name: "계약통지 제출", exact: true })
    .click();

  const submitDialog = page.getByRole("dialog", {
    name: "계약통지 제출",
  });
  await submitDialog.getByLabel("처리 근거 증빙번호").fill(evidence);
  const submitResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/${record.id}/submit-notice`),
  );
  await submitDialog
    .getByRole("button", { name: "확인 후 실행", exact: true })
    .click();
  const submitted = await submitResponse;
  expect(submitted.status()).toBe(200);
  const requestBody = submitted.request().postDataJSON();
  expect(requestBody.expectedVersion).toBe(2);
  expect(requestBody.evidenceIds).toEqual([evidence]);
  expect(submitted.request().headers()["idempotency-key"]).toBeTruthy();
  await expect(page.locator(".detail-head .badge")).toContainText("제출");
});

test("Claim and EOT drafts follow server capabilities and the API rejects owner claim drafting", async ({
  page,
  request,
}) => {
  await page.goto("/#/contract");
  await selectRole(page, "CON");

  const claimSuffix = randomUUID().slice(0, 8);
  const claimTitle = `클레임 화면 ${claimSuffix}`;
  await page.getByRole("tab", { name: "클레임", exact: true }).click();
  await page
    .getByRole("button", { name: "클레임 기록 추가", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "클레임 기록 추가" });
  await dialog.getByLabel("제목 *", { exact: true }).fill(claimTitle);
  await dialog
    .getByLabel("클레임 번호 *", { exact: true })
    .fill(`CL-UI-${claimSuffix}`);
  const claimResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/claims") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "기록 추가", exact: true }).click();
  expect((await claimResponse).status()).toBe(201);
  await expect(page.locator(".detail-head")).toContainText(claimTitle);
  await expect(
    page.locator('[data-ui-component="status-boundary-group"]'),
  ).toContainText("원 청구액");

  const eotSuffix = randomUUID().slice(0, 8);
  const eotTitle = `공기연장 화면 ${eotSuffix}`;
  await page
    .getByRole("tab", { name: "공기연장(EOT)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "공기연장(EOT) 기록 추가", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "공기연장(EOT) 기록 추가" });
  await dialog.getByLabel("제목 *", { exact: true }).fill(eotTitle);
  await dialog
    .getByLabel("공기연장(EOT) 번호 *", { exact: true })
    .fill(`EOT-UI-${eotSuffix}`);
  const eotResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/eot-requests") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "기록 추가", exact: true }).click();
  expect((await eotResponse).status()).toBe(201);
  await expect(page.locator(".detail-head")).toContainText(eotTitle);
  await expect(
    page.locator('[data-ui-component="status-boundary-group"]'),
  ).toContainText("청구 일수");
  await expect(page.locator(".detail-pane")).toContainText(
    "공기연장 승인 자체는 기존 기준공정을 변경하지 않습니다.",
  );

  await selectRole(page, "OWN");
  await page.getByRole("tab", { name: "클레임", exact: true }).click();
  const ownerCreate = page.getByRole("button", {
    name: "클레임 기록 추가",
    exact: true,
  });
  await expect(ownerCreate).toBeDisabled();
  await expect(page.getByTestId("creation-capability-reason")).toContainText(
    "현재 역할은 초안을 작성할 권한이 없습니다.",
  );
  let uiClaimPosts = 0;
  const countUiClaimPosts = (url: URL, method: string) => {
    if (url.pathname.endsWith("/claims") && method === "POST") uiClaimPosts += 1;
  };
  page.on("request", (browserRequest) =>
    countUiClaimPosts(new URL(browserRequest.url()), browserRequest.method()),
  );
  await ownerCreate.click({ force: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(uiClaimPosts).toBe(0);

  // Exercise the server gate directly as well; hiding the form is only a
  // presentation affordance and does not replace the create authority check.
  const ownSessionResponse = await request.post("/api/dev/sessions", {
    data: { actorGroup: "OWN" },
  });
  expect(ownSessionResponse.status()).toBe(200);
  const ownSession = await ownSessionResponse.json();
  const ownWorkspaceResponse = await request.get(
    `/api/projects/${ownSession.projectId}/workspace`,
    {
      headers: {
        Authorization: `Bearer ${ownSession.accessToken}`,
        "X-RoleAssignment-Id": ownSession.actor.roleAssignmentId,
      },
    },
  );
  expect(ownWorkspaceResponse.status()).toBe(200);
  const ownWorkspace = await ownWorkspaceResponse.json();
  const forbiddenResponse = await request.post(
    `/api/projects/${ownSession.projectId}/claims`,
    {
      headers: {
        Authorization: `Bearer ${ownSession.accessToken}`,
        "Idempotency-Key": `CL-OWN-${randomUUID()}`,
      },
      data: {
        roleAssignmentId: ownSession.actor.roleAssignmentId,
        clientObjectId: randomUUID(),
        payload: {
          ...ownWorkspace.context.scope,
          title: "발주처 권한경계",
          data: { claimNo: "CL-OWN-403" },
        },
      },
    },
  );
  expect(forbiddenResponse.status()).toBe(403);
  expect((await forbiddenResponse.json()).code).toBe("NOT_AUTHORIZED");
});

for (const width of [390, 768, 1440]) {
  test(`Contract workspace responsive ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/#/contract");
    await expect(
      page.locator('[data-ui-component="contract-workspace"]'),
    ).toBeVisible();
    for (const tab of ["계약통지", "클레임", "공기연장(EOT)"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        )
        .toBeTruthy();
    }
  });
}
