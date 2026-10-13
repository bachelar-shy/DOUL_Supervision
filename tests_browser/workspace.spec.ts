import { selectCommandEvidence } from "./command-evidence-helper";
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
      "schedule",
      "safety",
      "owner",
      "documents",
      "registers",
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

test("schedule normalized source import preserves original Schedule v1 and Activity snapshots", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const title = `화면 원본입력 ${suffix}`;
  const scheduleNo = `UI-BL-${suffix}`;
  const criticalName = `Critical Activity ${suffix}`;
  const nextName = `Next Activity ${suffix}`;
  const source = {
    schedule: {
      scheduleNo,
      scheduleKind: "baseline",
      revision: "R0",
      sourceFormat: "normalized_json",
      sourceFileVersion: `ui-e2e-${suffix}`,
      dataDate: "2026-01-01T00:00:00Z",
      projectStartAt: "2026-01-01T00:00:00Z",
      contractualCompletionAt: "2026-12-31T00:00:00Z",
      forecastCompletionAt: "2026-12-31T00:00:00Z",
      wbsVersion: "1",
    },
    activities: [
      {
        data: {
          activityId: "A-100",
          wbsPath: "1",
          activityName: criticalName,
          plannedStartAt: "2026-01-01T00:00:00Z",
          plannedFinishAt: "2026-06-30T00:00:00Z",
          percentComplete: 0,
          totalFloat: 0,
          critical: true,
        },
        successorActivityIds: ["A-200"],
      },
      {
        data: {
          activityId: "A-200",
          wbsPath: "1.1",
          activityName: nextName,
          plannedStartAt: "2026-07-01T00:00:00Z",
          plannedFinishAt: "2026-12-31T00:00:00Z",
          percentComplete: 0,
          totalFloat: 10,
          critical: false,
        },
        predecessorActivityIds: ["A-100"],
      },
    ],
    criticalActivityId: "A-100",
  };

  await page.goto("/");
  const workspaceResponse = page.waitForResponse(
    (response) => response.url().endsWith("/workspace") && response.ok(),
  );
  await page
    .getByRole("combobox", { name: "시험 사용자 역할 선택" })
    .selectOption("CON");
  await workspaceResponse;
  await page.goto("/#/schedule");

  const importButton = page.getByRole("button", {
    name: "공정 자료 입력 양식 원본 입력",
    exact: true,
  });
  await expect(importButton).toBeEnabled();
  await importButton.click();

  const dialog = page.getByRole("dialog", { name: "공정 원본 입력" });
  await expect(dialog).toContainText(
    "확인된 공정 자료 파일",
  );
  await expect(dialog).toContainText(
    "XER / MSP / CSV 파일 직접 변환은 아직 지원하지 않습니다.",
  );
  await dialog.getByLabel("제목 *").fill(title);
  await dialog.getByLabel("공정 자료 파일").setInputFiles({
    name: `schedule-source-${suffix}.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source), "utf8"),
  });

  const preview = dialog.locator(
    '[data-ui-component="schedule-source-preview"]',
  );
  await expect(preview).toContainText("기준공정 원본");
  await expect(preview).toContainText(scheduleNo);
  await expect(preview).toContainText("2건");
  await expect(preview).toContainText("A-100");
  await expect(preview).toContainText("주공정");
  await expect(preview).toContainText("확인된 공정 자료 파일");
  await expect(preview).not.toContainText("normalized_json");

  await dialog.getByRole("button", { name: "원본 입력", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const sourceTab = page.getByRole("tab", { name: "원본입력", exact: true });
  await expect(sourceTab).toHaveAttribute("data-state", "active");
  const detail = page.locator(".detail-pane");
  await expect(detail).toContainText(title);
  await expect(detail).toContainText("보존 공정 원본 기록 제1차");
  await expect(detail).toContainText("공정 작업 확인 당시 기록");
  await expect(detail).toContainText(criticalName);
  await expect(detail).toContainText(nextName);
  await expect(detail).toContainText("확인된 공정 자료 파일");
  await expect(detail).not.toContainText("doul-normalized-json-v1");

  await page.getByRole("tab", { name: "기준공정", exact: true }).click();
  await page
    .getByRole("button")
    .filter({ hasText: title })
    .first()
    .click();
  await expect(page.locator(".detail-head")).toContainText(title);
  await expect(page.locator(".detail-section").last()).toContainText(
    "가능한 업무 처리",
  );
});

test.describe("today heading date", () => {
  test.use({ timezoneId: "Asia/Bangkok" });

  test("refreshes after local midnight without weather placeholder", async ({ page }) => {
    // The clock must remain frozen while the CI browser hydrates. Otherwise
    // a slow worker can cross midnight before the first assertion.
    const beforeMidnight = new Date("2026-10-06T16:59:55Z");
    await page.clock.install({ time: beforeMidnight });
    await page.clock.pauseAt(beforeMidnight);
    await page.goto("/#/today");
    const date = page.locator('[data-ui-component="today-date-context"]');
    await expect(date).toContainText("2026년 10월 6일");
    await expect(page.getByText("날씨 정보 미연동", { exact: true })).toHaveCount(0);
    await page.clock.fastForward(10_000);
    await expect(date).toContainText("2026년 10월 7일");
  });
});

test("DOUL component catalog is mounted on representative surfaces", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-ui-component="navigation"]')).toBeVisible();
  // The pre-work inspection-vs-release notice card was deliberately removed.
  await expect(page.locator('[data-ui-component="decision-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-ui-component="audit-timeline"]')).toBeVisible();

  await page.goto("/#/capture");
  const evidenceViewer = page.locator('[data-ui-component="evidence-viewer"]');
  await expect(evidenceViewer).toBeVisible();
  await evidenceViewer.getByRole("button").first().click();
  await expect(
    page.locator('[data-ui-component="evidence-detail-sheet"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();

  await page.goto("/#/inspections");
  await expect(page.locator('[data-ui-component="detail-pane"]')).toBeHidden();
  await page
    .getByRole("button")
    .filter({ hasText: "경량벽체 은폐 전 검측" })
    .first()
    .click();
  await expect(page.locator('[data-ui-component="detail-pane"]')).toBeVisible();
  const inspectionBoundary = page.locator('[data-ui-component="status-boundary-group"]');
  await expect(inspectionBoundary).toBeVisible();
  await expect(inspectionBoundary).toContainText("검측 판정");
  await expect(inspectionBoundary).toContainText("후속공정 허용");
  const actionGate = page.locator('[data-ui-component="action-gate"]');
  await expect(actionGate).toBeVisible();
  await expect(actionGate.locator("[data-command-availability]")).not.toHaveCount(0);

  await page.goto("/#/owner");
  await expect(
    page.locator('[data-ui-component="owner-governance-summary"]'),
  ).toBeVisible();
  await page
    .getByRole("button")
    .filter({ hasText: "발주처 즉시보고" })
    .first()
    .click();
  const ownerPanel = page.locator('[data-ui-component="owner-decision-panel"]');
  await expect(ownerPanel).toBeVisible();
  const ownerBoundary = ownerPanel.locator(
    '[data-ui-component="status-boundary-group"]',
  );
  await expect(ownerBoundary).toBeVisible();
  await expect(ownerBoundary).toContainText("수령·결정 진행 단계별 유의사항");
  await expect(ownerBoundary).toContainText("수령 확인");
  await expect(ownerBoundary).toContainText("결정 제출");

  await page.goto("/#/registers");
  await expect(page.locator('[data-ui-component="register-navigator"]')).toBeVisible();
  await expect(page.locator('[data-ui-component="filter-bar"]')).toBeVisible();
  await expect(page.locator('[data-ui-component="register-table"]')).toBeVisible();
  await page.getByRole("button", { name: "보기", exact: true }).first().click();
  await expect(page.locator('[data-ui-component="detail-drawer"]')).toBeVisible();
});

test("safety workspace keeps permit, stop, resume gate, and equipment states separate", async ({
  page,
}) => {
  await page.route("**/workspace", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.items = [
      {
        machine: "safety_permit",
        record: {
          id: "SP-UI-PW-001",
          projectId: body.project.id,
          version: 6,
          subtype: "SafetyPermit",
          status: "suspended",
          title: "브라우저 작업허가",
          evidenceIds: [],
          data: {
            permitNo: "PTW-PW-001",
            workType: "Hot Work",
            riskLevel: "high",
            workAuthorized: false,
            stopOrderRefs: [
              {
                objectType: "WorkItem",
                objectId: "STOP-UI-PW-001",
                version: 4,
              },
            ],
            blockedReasons: ["SAFETY_STOP_OPEN"],
          },
        },
        actions: [],
      },
      {
        machine: "safety_stop_order",
        record: {
          id: "STOP-UI-PW-001",
          projectId: body.project.id,
          version: 4,
          subtype: "SafetyStopOrder",
          status: "verification",
          title: "브라우저 작업중지",
          evidenceIds: [],
          data: {
            stopOrderNo: "STOP-PW-001",
            stopReason: "추락방지 조치 확인",
            resumeRequestAt: "2026-10-06T14:10:00+07:00",
            resumeGate: {
              causeIdentified: true,
              correctiveActionComplete: true,
              correctiveEvidencePresent: true,
              issueActionsVerified: true,
              reinspectionPassed: true,
              permitValid: true,
              methodStatementCurrent: true,
              riskAssessmentCurrent: true,
              equipmentReady: true,
              personnelQualified: true,
              controlMeasuresReady: true,
              environmentalConditionsReady: false,
              reportingObligationsSatisfied: true,
            },
          },
        },
        actions: [],
      },
      {
        machine: "safety_stop_order",
        record: {
          id: "STOP-UI-CMD",
          projectId: body.project.id,
          version: 1,
          subtype: "SafetyStopOrder",
          status: "issued",
          title: "중지 수령 시험",
          evidenceIds: [],
          data: {
            stopOrderNo: "STOP-PW-002",
            stopReason: "Command routing test",
          },
        },
        actions: [
          {
            command: "acknowledge_stop",
            to: "acknowledged",
            authority: "safety.stop.acknowledge",
            fields: [],
            requiresEvidence: false,
            ready: true,
            requiresInput: false,
            blockedReason: null,
            expectedVersion: 1,
          },
          {
            command: "lift_stop",
            to: "lifted",
            authority: "safety.stop_lift",
            fields: [],
            requiresEvidence: true,
            ready: true,
            requiresInput: false,
            blockedReason: null,
            expectedVersion: 1,
          },
        ],
      },
      {
        machine: "safety_equipment_inspection",
        record: {
          id: "SEI-UI-PW-001",
          projectId: body.project.id,
          version: 3,
          subtype: "SafetyEquipmentInspection",
          status: "result_pending",
          title: "브라우저 장비 안전검사",
          evidenceIds: [],
          data: {
            inspectionKind: "pre-use",
            equipmentAvailable: false,
            resultSummary: "점검 완료 · 판정 대기",
          },
        },
        actions: [],
      },
      ...body.items,
    ];
    await route.fulfill({ response, json: body });
  });

  await page.goto("/");
  await page
    .getByRole("combobox", { name: "시험 사용자 역할 선택" })
    .selectOption("CON");
  await page.waitForResponse((response) =>
    response.url().endsWith("/workspace") && response.ok(),
  );
  await page.goto("/#/safety");

  const workspace = page.locator('[data-ui-component="safety-workspace"]');
  await expect(workspace).toBeVisible();
  await expect(workspace.getByRole("tab")).toHaveCount(3);

  await page
    .getByRole("button")
    .filter({ hasText: "브라우저 작업허가" })
    .first()
    .click();
  const permitBoundary = page.locator(
    '[data-ui-component="status-boundary-group"]',
  );
  await expect(permitBoundary).toContainText("허가 상태");
  await expect(permitBoundary).toContainText("작업 허용");
  await expect(permitBoundary).toContainText("작업 미허용");
  await expect(permitBoundary).toContainText("연결 작업중지");

  await workspace.getByRole("tab", { name: "작업중지", exact: true }).click();
  await page
    .getByRole("button")
    .filter({ hasText: "브라우저 작업중지" })
    .first()
    .click();
  const resumeGate = page.locator('[data-ui-component="safety-resume-gate"]');
  await expect(resumeGate).toContainText("재개 진행 조건");
  await expect(resumeGate).toContainText("환경조건 적합");
  await expect(resumeGate).toContainText("미충족");

  let commandBody: any = null;
  await page.route("**/safety-stop-orders/STOP-UI-CMD/acknowledge-stop", async (route) => {
    commandBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        record: {
          id: "STOP-UI-CMD",
          projectId: "ignored",
          version: 2,
          subtype: "SafetyStopOrder",
          status: "acknowledged",
          data: {},
        },
      }),
    });
  });
  await page
    .getByRole("button")
    .filter({ hasText: "중지 수령 시험" })
    .first()
    .click();
  await page
    .locator('[data-ui-component="action-gate"]')
    .getByRole("button", { name: "중지 수령 확인", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "확인 후 실행", exact: true })
    .click();
  await expect.poll(() => commandBody?.expectedVersion).toBe(1);
  expect(commandBody.payload).toEqual({});
  expect(commandBody.evidenceIds).toEqual([]);

  let evidenceCommandBody: any = null;
  await page.route("**/safety-stop-orders/STOP-UI-CMD/lift-stop", async (route) => {
    evidenceCommandBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        record: {
          id: "STOP-UI-CMD",
          projectId: "ignored",
          version: 2,
          subtype: "SafetyStopOrder",
          status: "lifted",
          data: {},
        },
      }),
    });
  });
  await page
    .locator('[data-ui-component="action-gate"]')
    .getByRole("button", { name: "작업중지 해제", exact: true })
    .click();
  const evidenceDialog = page.getByRole("dialog");
  await evidenceDialog
    .getByRole("button", { name: "확인 후 실행", exact: true })
    .click();
  await expect(evidenceDialog.getByRole("alert")).toContainText(
    "현재 업무 단계의 근거 증빙을 선택하십시오.",
  );
  expect(evidenceCommandBody).toBeNull();
  await selectCommandEvidence(evidenceDialog,["EVD-COMMAND-001","EVD-COMMAND-002"]);
  await evidenceDialog
    .getByRole("button", { name: "확인 후 실행", exact: true })
    .click();
  await expect.poll(() => evidenceCommandBody?.evidenceIds).toEqual([
    "EVD-COMMAND-001",
    "EVD-COMMAND-002",
  ]);

  await workspace.getByRole("tab", { name: "장비 안전검사", exact: true }).click();
  await page
    .getByRole("button")
    .filter({ hasText: "브라우저 장비 안전검사" })
    .first()
    .click();
  const equipmentBoundary = page.locator(
    '[data-ui-component="status-boundary-group"]',
  );
  await expect(equipmentBoundary).toContainText("장비 사용 가능");
  await expect(equipmentBoundary).toContainText("사용 불가");
});

test("29 register projections support selection, filtering, and detail", async ({ page }) => {
  await page.goto("/#/registers");
  // This compact screen intentionally removes the duplicate register heading.
  // Assert the complete catalog through its accessible navigator instead.
  await expect(page.locator('[data-ui-component="register-navigator"]')).toBeVisible();
  await expect(page.locator('[data-ui-component="register-navigator"]').getByRole("tab", { name: "전체 29개", exact: true })).toBeVisible();
  await expect(page.locator('[data-ui-component="register-table"] tbody tr')).not.toHaveCount(0);

  await page.getByPlaceholder("제목, 상태, 위치, 번호 검색").fill("경량벽체");
  await expect(page.getByText("경량벽체 은폐 전 검측", { exact: true })).toBeVisible();

  const registerNavigator = page.locator('[data-ui-component="register-navigator"]');
  await registerNavigator
    .getByRole("tab", { name: "전체 29개", exact: true })
    .click();
  await expect(registerNavigator.getByRole("button", { name: / 열기$/ })).toHaveCount(
    29,
  );
  await expect(
    registerNavigator.locator('section[aria-labelledby^="register-group-"]'),
  ).toHaveCount(6);
  await registerNavigator
    .getByPlaceholder("관리대장 이름 또는 번호 검색")
    .fill("도면");
  const drawingRegister = registerNavigator.getByRole("button", {
    name: "04 도면·개정 열기",
    exact: true,
  });
  await drawingRegister.click();
  await expect(drawingRegister).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("도면 예시 A-201", { exact: true })).toBeVisible();
});

test("register entry adapts to the active human role without defining authority", async ({
  page,
}) => {
  await page.goto("/");
  const rolePicker = page.getByRole("combobox", { name: "시험 사용자 역할 선택" });
  const cases = [
    { role: "CON", label: "시공사", id: "11", name: "검측·검수" },
    { role: "OWN", label: "발주처", id: "22", name: "회의·발주처 보고·결정" },
    { role: "DES", label: "설계자", id: "13", name: "기술질의" },
    { role: "ADM", label: "관리자", id: "03", name: "인력·자격" },
  ] as const;

  for (const item of cases) {
    await rolePicker.selectOption(item.role);
    await expect(rolePicker).toHaveValue(item.role);
    await page.goto("/#/registers");

    const registerNavigator = page.locator(
      '[data-ui-component="register-navigator"]',
    );
    await expect(registerNavigator).toHaveAttribute("data-role-preset", item.label);
    await expect(
      registerNavigator.getByRole("button", {
        name: `${item.id} ${item.name} 열기`,
        exact: true,
      }),
    ).toHaveAttribute("aria-current", "page");
    await expect(registerNavigator).toContainText(
      "추천은 진입 편의용 · 실제 조회 범위는 업무 시스템 권한 기준",
    );
  }
});

test("stale register refresh cannot overwrite a newer register selection", async ({
  page,
}) => {
  let releaseRefresh!: () => void;
  let markRefreshStarted!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const refreshStarted = new Promise<void>((resolve) => {
    markRefreshStarted = resolve;
  });

  await page.goto("/#/registers");
  await expect(
    page.locator('[data-ui-component="register-table"] tbody tr'),
  ).not.toHaveCount(0);

  const refreshButton = page
    .locator('[data-ui-component="filter-bar"]')
    .getByRole("button", { name: "새로고침", exact: true });
  await expect(refreshButton).toBeEnabled();

  await page.route("**/registers/11", async (route) => {
    markRefreshStarted();
    await refreshGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          sourceDomainRefs: [
            {
              objectType: "Inspection",
              objectId: "STALE-REGISTER-11",
              version: 99,
            },
          ],
          data: {
            id: "STALE-REGISTER-11",
            projectId: "UI-RACE-TEST",
            version: 99,
            status: "scheduled",
            title: "STALE REGISTER 11 ROW",
          },
          calculated: {
            result_status: "pass",
            next_work_allowed: true,
          },
          unavailableFields: [],
        },
      ]),
    });
  });

  await refreshButton.click();
  await refreshStarted;

  const registerNavigator = page.locator('[data-ui-component="register-navigator"]');
  await registerNavigator
    .getByRole("tab", { name: "전체 29개", exact: true })
    .click();
  const drawingRegister = registerNavigator.getByRole("button", {
    name: "04 도면·개정 열기",
    exact: true,
  });
  await drawingRegister.click();
  await expect(page.getByText("도면 예시 A-201", { exact: true })).toBeVisible();

  const staleResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/registers/11") && response.status() === 200,
  );
  releaseRefresh();
  await staleResponse;

  await expect(drawingRegister).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("도면 예시 A-201", { exact: true })).toBeVisible();
  await expect(page.getByText("STALE REGISTER 11 ROW", { exact: true })).toHaveCount(
    0,
  );
});

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
    page.getByRole("combobox", { name: "시험 사용자 역할 선택" }),
  );
  await expectTouchTarget(page.locator(".bottom-nav button").first());

  await page
    .getByRole("button")
    .filter({ hasText: "경량벽체 은폐 전 검측" })
    .first()
    .click();
  await expectTouchTarget(
    page.locator(".detail-pane").getByRole("button", { name: "← 목록" }),
  );
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

  await page.goto("/#/capture");
  const mobileEvidence = page
    .locator('[data-ui-component="evidence-viewer"]')
    .getByRole("button")
    .first();
  await expectTouchTarget(mobileEvidence);
  await mobileEvidence.click();
  const evidenceSheet = page.locator('[data-ui-component="evidence-detail-sheet"]');
  await expect(evidenceSheet).toBeVisible();
  await expectTouchTarget(
    page.getByRole("button", { name: "닫기", exact: true }),
  );
  await expectTouchTarget(
    evidenceSheet.getByRole("tab", { name: "기본정보", exact: true }),
  );
  await page.getByRole("button", { name: "닫기", exact: true }).click();

  await page.goto("/#/registers");
  const registerNavigator = page.locator('[data-ui-component="register-navigator"]');
  await expect(registerNavigator).toBeVisible();
  await expectTouchTarget(
    registerNavigator.getByRole("tab", { name: "내 역할 추천", exact: true }),
  );
  await expectTouchTarget(
    registerNavigator.getByRole("button", {
      name: "11 검측·검수 열기",
      exact: true,
    }),
  );

  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBeTruthy();
});

test("mobile navigation follows the active role route map", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 840 });
  await page.goto("/");
  const mobileNav = page.locator('[data-ui-component="mobile-navigation"]');
  await expect(mobileNav).toBeVisible();
  await expect(mobileNav.getByRole("button")).toHaveCount(5);

  await page
    .getByRole("combobox", { name: "시험 사용자 역할 선택" })
    .selectOption("DES");
  await expect(mobileNav.getByRole("button", { name: "설계질의" })).toBeVisible();
  await expect(mobileNav.getByRole("button", { name: "문서" })).toBeVisible();
  await expect(mobileNav.getByRole("button", { name: "검측" })).toHaveCount(0);
  await mobileNav.getByRole("button", { name: "설계질의" }).click();
  await expect(page.locator("h1")).toHaveText("설계질의");

  await page
    .getByRole("combobox", { name: "시험 사용자 역할 선택" })
    .selectOption("ADM");
  await expect(mobileNav.getByRole("button", { name: "대장" })).toBeVisible();
  await expect(mobileNav.getByRole("button", { name: "권한" })).toBeVisible();
});

test("register table header remains visible during long internal scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "시험 사용자 역할 선택" })
    .selectOption("ADM");
  await page.waitForResponse((response) =>
    response.url().endsWith("/workspace") && response.ok(),
  );
  await page.goto("/#/registers");
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
    .getByRole("combobox", { name: "시험 사용자 역할 선택" })
    .selectOption("CON");
  await expect(page.getByRole("combobox", { name: "시험 사용자 역할 선택" })).toHaveValue("CON");
  await expect(page.locator("aside.sidebar")).toBeVisible();
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
  const releaseBoundary = page.locator(
    '[data-ui-component="status-boundary-group"]',
  );
  await expect(releaseBoundary).toContainText("후속공정 허용");
  await expect(releaseBoundary).toContainText("미허용");
  await expect(
    page
      .locator('[data-ui-component="action-gate"]')
      .getByText("선행조건 대기", { exact: true }),
  ).toBeVisible();
});

test("owner and designer role surfaces", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByText("우선 확인할 업무", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "시험 사용자 역할 선택" })
    .selectOption("OWN");
  await expect(page.getByText("보고·결정 대기", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    location.hash = "/owner";
  });
  await expect(
    page.locator('[data-ui-component="owner-governance-flow"]'),
  ).toContainText("보고 발행 → 수령 확인 → 결정·조치 → 이행 검증 → 종결");
  await expect(
    page.getByRole("button").filter({ hasText: "발주처 즉시보고" }).first(),
  ).toBeVisible();
  await page
    .getByRole("button")
    .filter({ hasText: "발주처 즉시보고" })
    .first()
    .click();
  const ownerPanel = page.locator('[data-ui-component="owner-decision-panel"]');
  await expect(ownerPanel).toContainText("수령 확인은 승인이나 결정이 아닙니다.");
  await expect(
    ownerPanel.getByRole("button", { name: "수령 확인", exact: true }),
  ).toBeVisible();
  await expect(
    ownerPanel.getByRole("button", { name: "결정 제출", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: ".local/screenshots/owner-web.png",
    fullPage: true,
  });
  await page
    .getByRole("combobox", { name: "시험 사용자 역할 선택" })
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
  await page.getByRole("button", { name: "초안 미리보기 생성" }).click();
  await expect(page.getByTitle("문서 초안 미리보기")).toBeVisible();
  await expect(
    page.frameLocator("iframe").getByRole("heading", { level: 1 }),
  ).toContainText("발주처 즉시보고");
  // The user may request a derivative after generating a snapshot.
  // An unconfigured renderer reports 501 when called, not via a disabled UI.
  await expect(page.getByRole("button", { name: "DOCX 다운로드" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "PDF 다운로드" })).toBeEnabled();
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
  await expect(page.locator(".offline-bar")).toContainText("오프라인");
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
    page.getByRole("button", { name: "업무 시스템 전송", exact: true }),
  ).toBeDisabled();
  await context.setOffline(false);
  await expect(
    page.getByRole("button", { name: "업무 시스템 전송", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "업무 시스템 전송", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("파일 무결성 확인 후 증빙을 등록했습니다.");

  const uploadedEvidence = page.getByRole("button", {
    name: "offline-test.png 상세보기",
    exact: true,
  }).last();
  await expect(uploadedEvidence).toBeVisible();
  await uploadedEvidence.click();

  const sheet = page.locator('[data-ui-component="evidence-detail-sheet"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("원본 증빙", { exact: true }).first()).toBeVisible();
  await expect(sheet.locator('img[alt="offline-test.png"]')).toBeVisible();
  await sheet.getByRole("tab", { name: "기술정보", exact: true }).click();
  await expect(sheet).toContainText(
    "d126d616641d42ac8b0a07ec302c9fa1ec049f86200931a0a60c8f3080284b77",
  );
  await page.getByRole("button", { name: "닫기", exact: true }).click();
});
