import { test, expect, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

async function expectTouchTarget(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, "interactive control should have a rendered hit area").not.toBeNull();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
}

for (const width of [390, 768, 1440]) {
  test(`responsive workspace ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await expect(
      page.getByText("우선 확인할 업무", { exact: true }),
    ).toBeVisible();
    for (const route of [
      "today",
      "inspections",
      "capture",
      "observations",
      "issues",
      "documents",
    ]) {
      await page.goto("/#/" + route);
      await expect(page.locator("h1")).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        )
        .toBeTruthy();
    }
    await page.goto("/");
    await expect(
      page.getByText("우선 확인할 업무", { exact: true }),
    ).toBeVisible();
    await mkdir(".local/screenshots", { recursive: true });
    await page.screenshot({
      path: `.local/screenshots/today-${width}.png`,
      fullPage: true,
    });
  });
}

test("mobile interactive controls keep 44px touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 840 });
  await page.goto("/#/inspections");
  await expect(page.locator("h1")).toBeVisible();

  await expectTouchTarget(
    page.getByRole("button", { name: "현장 촬영", exact: true }),
  );
  await expectTouchTarget(
    page.getByRole("button", { name: "메뉴 열기", exact: true }),
  );
  await expectTouchTarget(
    page.getByRole("combobox", { name: "개발 역할 선택" }),
  );
  await expectTouchTarget(page.locator(".bottom-nav button").first());

  await page
    .getByRole("button")
    .filter({ hasText: "경량벽체 은폐 전 검측" })
    .first()
    .click();
  await page
    .locator(".detail-pane")
    .getByRole("button", { name: "시작", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectTouchTarget(
    dialog.getByRole("button", { name: "대화상자 닫기", exact: true }),
  );
  await dialog
    .getByRole("button", { name: "대화상자 닫기", exact: true })
    .click();

  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBeTruthy();
});

test("register table header remains visible during long internal scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "개발 역할 선택" })
    .selectOption("ADM");
  await page.waitForResponse((response) =>
    response.url().endsWith("/workspace") && response.ok(),
  );
  await page.goto("/#/admin");
  const tableScroll = page.locator(".template-register .table-scroll");
  await expect(tableScroll).toBeVisible();

  await page.locator(".template-register tbody").evaluate((tbody) => {
    const row = tbody.children[0];
    if (!row) throw new Error("Expected at least one register row");
    for (let i = 0; i < 100; i += 1) {
      tbody.append(row.cloneNode(true));
    }
  });

  await expect
    .poll(() => tableScroll.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBeTruthy();

  await tableScroll.evaluate((element) => {
    element.scrollTop = Math.min(600, element.scrollHeight - element.clientHeight);
    element.dispatchEvent(new Event("scroll"));
  });

  const positions = await page.evaluate(() => ({
    containerTop: document
      .querySelector(".template-register .table-scroll")!
      .getBoundingClientRect().top,
    headerTop: document
      .querySelector(".template-register thead th")!
      .getBoundingClientRect().top,
  }));
  expect(Math.abs(positions.headerTop - positions.containerTop)).toBeLessThanOrEqual(2);
});

test("server command starts a scheduled inspection", async ({
  page,
  request,
}) => {
  const login = async (actorGroup: string) =>
    (await request.post("/api/dev/sessions", { data: { actorGroup } })).json();
  const con = await login("CON");
  const sup = await login("SUP");
  const headers = (s: any) => ({
    Authorization: "Bearer " + s.accessToken,
    "X-RoleAssignment-Id": s.actor.roleAssignmentId,
    "Idempotency-Key": randomUUID(),
  });
  const workspace = await (
    await request.get("/api/projects/" + con.projectId + "/workspace", {
      headers: headers(con),
    })
  ).json();
  const context = workspace.context;
  let r = await (
    await request.post("/api/projects/" + con.projectId + "/inspections", {
      headers: headers(con),
      data: {
        roleAssignmentId: con.actor.roleAssignmentId,
        clientObjectId: randomUUID(),
        payload: {
          ...context.scope,
          workName: "브라우저 검측 시작시험",
          selfInspectionComplete: true,
          precheck: {
            drawing: true,
            material: true,
            test: true,
            previous: true,
            change: true,
          },
          holdPoint: false,
          nextWorkAllowed: false,
          requirementRefs: [context.requirementRef],
          drawingRef: context.drawingRef,
          evidenceIds: [context.evidenceId],
        },
      },
    })
  ).json();
  for (const [command, s, payload] of [
    [
      "request",
      con,
      {
        requestedAt: new Date().toISOString(),
        requestedInspectionAt: new Date().toISOString(),
      },
    ],
    ["receive", sup, { receivedAt: new Date().toISOString() }],
    ["schedule", sup, { scheduledAt: new Date().toISOString() }],
  ] as const) {
    const response = await request.post(
      `/api/projects/${con.projectId}/inspections/${r.record.id}/${command}`,
      {
        headers: headers(s),
        data: {
          roleAssignmentId: s.actor.roleAssignmentId,
          expectedVersion: r.record.version,
          payload,
          evidenceIds: [context.evidenceId],
        },
      },
    );
    expect(response.ok()).toBeTruthy();
    r = await response.json();
  }
  await page.goto("/#/inspections");
  await page
    .getByRole("button")
    .filter({ hasText: "브라우저 검측 시작시험" })
    .last()
    .click();
  await page
    .locator(".detail-pane")
    .getByRole("button", { name: "시작", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "확인 후 실행" })
    .click();
  await expect(page.locator(".detail-head .badge")).toHaveText("진행 중");
});

test("contractor has no issue closure control", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "개발 역할 선택" })
    .selectOption("CON");
  await expect(
    page.getByText("시공사 작업공간", { exact: true }),
  ).toBeVisible();
  await page.waitForResponse((r) => r.url().endsWith("/workspace") && r.ok());
  await page.evaluate(() => {
    location.hash = "/issues";
  });
  await page
    .getByRole("button")
    .filter({ hasText: "벽체 치수 시정" })
    .first()
    .click();
  await expect(page.locator(".detail-pane")).toBeVisible();
  await expect(
    page
      .locator(".detail-pane")
      .getByRole("button", { name: "종결 검토·확정" }),
  ).toHaveCount(0);
});

test("pass cannot bypass release guards", async ({ page }) => {
  await page.goto("/#/inspections");
  await page
    .getByRole("button")
    .filter({ hasText: "천장 내부 종합검측" })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "후속공정 허용", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("아직 허용되지 않음", { exact: true }),
  ).toBeVisible();
});

test("owner and designer role surfaces", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByText("우선 확인할 업무", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "개발 역할 선택" })
    .selectOption("OWN");
  await expect(page.getByText("보고·결정 대기", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    location.hash = "/owner";
  });
  await expect(
    page.getByRole("button").filter({ hasText: "발주처 즉시보고" }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/screenshots/owner-web.png",
    fullPage: true,
  });
  await page
    .getByRole("combobox", { name: "개발 역할 선택" })
    .selectOption("DES");
  await expect(page.getByText("설계질의 대기", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    location.hash = "/rfis";
  });
  await page
    .getByRole("button")
    .filter({ hasText: "벽체 기준 치수 질의" })
    .first()
    .click();
  await expect(
    page.getByText("RFI 답변은 설계변경 승인이 아닙니다.", { exact: true }),
  ).toBeVisible();
});

test("draft document renders from versioned source", async ({ page }) => {
  await page.goto("/#/documents");
  await page.getByRole("button", { name: "초안 HTML 생성" }).click();
  await expect(page.getByTitle("문서 초안 미리보기")).toBeVisible();
  await expect(
    page.frameLocator("iframe").getByRole("heading", { level: 1 }),
  ).toContainText("발주처 즉시보고");
  await expect(
    page.getByRole("button", { name: "DOCX 연동 전" }),
  ).toBeDisabled();
  await page.screenshot({
    path: ".local/screenshots/document-web.png",
    fullPage: true,
  });
});

test("offline evidence stays local until explicit upload", async ({
  page,
  context,
}) => {
  await page.goto("/#/capture");
  await expect(
    page.getByText("현장 기록 가져오기", { exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole("alert")).toContainText("오프라인");
  await page
    .getByLabel("증빙 파일 선택")
    .setInputFiles({
      name: "offline-test.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await expect(
    page.locator(".pending-row").getByText("offline-test.png", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "서버 전송", exact: true }),
  ).toBeDisabled();
  await context.setOffline(false);
  await expect(
    page.getByRole("button", { name: "서버 전송", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "서버 전송", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("서버 해시 확인");
});
