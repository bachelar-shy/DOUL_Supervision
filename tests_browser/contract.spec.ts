import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

type ActorGroup = "CON" | "SUP" | "OWN";

async function selectRole(page: Page, role: ActorGroup) {
  const route = new URL(page.url()).hash || "#/today";
  const picker = page.getByRole("combobox", { name: "개발 역할 선택" });
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
  const title = `계약통지 UI ${suffix}`;

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
  await submitDialog.getByLabel("명령 증빙 ID").fill(evidence);
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

test("Claim and EOT drafts use their real collections and server rejects owner claim drafting", async ({
  page,
}) => {
  await page.goto("/#/contract");
  await selectRole(page, "CON");

  const claimSuffix = randomUUID().slice(0, 8);
  const claimTitle = `클레임 UI ${claimSuffix}`;
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
  const eotTitle = `공기연장 UI ${eotSuffix}`;
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
  await page
    .getByRole("button", { name: "클레임 기록 추가", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "클레임 기록 추가" });
  await dialog.getByLabel("제목 *", { exact: true }).fill("발주처 권한경계");
  await dialog.getByLabel("클레임 번호 *", { exact: true }).fill("CL-OWN-403");
  const forbiddenResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/claims") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "기록 추가", exact: true }).click();
  expect((await forbiddenResponse).status()).toBe(403);
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog).toContainText("권한");
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
