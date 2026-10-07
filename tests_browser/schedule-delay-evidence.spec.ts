import {
  test,
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";

type ActorGroup = "CON" | "SUP";

interface Session {
  accessToken: string;
  projectId: string;
  actor: {
    partyId: string;
    roleAssignmentId: string;
    actorGroup: string;
  };
}

interface Scope {
  packageId: string;
  locationId: string;
  discipline: string;
  responsibleOrganizationId: string;
}

interface Workspace {
  context: {
    scope: Scope;
    evidenceId: string;
  };
  items: Array<{
    machine: string;
    record: {
      id: string;
      version: number;
      title?: string;
      status?: string;
      schedule?: Record<string, unknown>;
    };
  }>;
}

interface RecordDTO {
  id: string;
  version: number;
  title?: string;
  status?: string;
  packageId?: string;
  locationId?: string;
  discipline?: string;
  responsibleOrganizationId?: string;
}

async function json<T>(response: APIResponse, status?: number): Promise<T> {
  const text = await response.text();
  if (status !== undefined) expect(response.status(), text).toBe(status);
  else expect(response.ok(), text).toBeTruthy();
  return JSON.parse(text) as T;
}

async function session(
  request: APIRequestContext,
  actorGroup: ActorGroup,
): Promise<Session> {
  return json<Session>(
    await request.post("/api/dev/sessions", { data: { actorGroup } }),
    200,
  );
}

function headers(value: Session, idempotent = false) {
  return {
    Authorization: `Bearer ${value.accessToken}`,
    "X-RoleAssignment-Id": value.actor.roleAssignmentId,
    ...(idempotent ? { "Idempotency-Key": randomUUID() } : {}),
  };
}

async function workspace(
  request: APIRequestContext,
  value: Session,
): Promise<Workspace> {
  return json<Workspace>(
    await request.get(`/api/projects/${value.projectId}/workspace`, {
      headers: headers(value),
    }),
    200,
  );
}

async function command(
  request: APIRequestContext,
  value: Session,
  collection: string,
  record: RecordDTO,
  name: string,
  payload: Record<string, unknown> = {},
): Promise<RecordDTO> {
  const response = await request.post(
    `/api/projects/${value.projectId}/${collection}/${record.id}/${name.replaceAll("_", "-")}`,
    {
      headers: headers(value, true),
      data: {
        roleAssignmentId: value.actor.roleAssignmentId,
        expectedVersion: record.version,
        payload,
        evidenceIds: [],
      },
    },
  );
  return (await json<{ record: RecordDTO }>(response, 200)).record;
}

async function createEffectiveBaseline(
  request: APIRequestContext,
  contractor: Session,
  supervisor: Session,
  scope: Scope,
): Promise<RecordDTO> {
  const suffix = randomUUID().slice(0, 8);
  const activityId = `A-${suffix}`;
  const source = {
    schedule: {
      scheduleNo: `BL-${suffix}`,
      scheduleKind: "baseline",
      revision: "B0",
      sourceFormat: "normalized_json",
      sourceFileVersion: `issue89-${suffix}`,
      dataDate: "2026-01-01T00:00:00Z",
      projectStartAt: "2026-01-01T00:00:00Z",
      contractualCompletionAt: "2026-12-31T00:00:00Z",
      forecastCompletionAt: "2026-12-31T00:00:00Z",
      calendars: [
        {
          calendarId: "STD",
          name: "Standard",
          timezone: "Asia/Ho_Chi_Minh",
          workingDays: [1, 2, 3, 4, 5],
          hoursPerDay: 8,
        },
      ],
      wbsVersion: "1",
      milestoneSet: [
        {
          milestoneId: "M1",
          name: "Completion",
          plannedAt: "2026-12-31T00:00:00Z",
          contractualAt: "2026-12-31T00:00:00Z",
        },
      ],
      scheduleQualitySummary: {
        contractDatesAligned: true,
        wbsComplete: true,
        activityIdsUnique: true,
        calendarsDefined: true,
        logicComplete: true,
        openEndsIdentified: true,
        constraintsReviewed: true,
        durationOutliersReviewed: true,
        criticalPathComputable: true,
        floatOutliersReviewed: true,
        interfacesReviewed: true,
        sourceFilePreserved: true,
      },
    },
    activities: [
      {
        data: {
          activityId,
          wbsPath: "1",
          activityName: `Critical ${suffix}`,
          plannedStartAt: "2026-01-01T00:00:00Z",
          plannedFinishAt: "2026-12-31T00:00:00Z",
          percentComplete: 0,
          totalFloat: 0,
          critical: true,
        },
      },
    ],
    criticalActivityId: activityId,
  };
  const sourceBytes = Buffer.from(JSON.stringify(source), "utf8");
  const checksum = createHash("sha256").update(sourceBytes).digest("hex");
  const uploadStart = await request.post(
    `/api/projects/${contractor.projectId}/uploads`,
    {
      headers: headers(contractor, true),
      data: {
        roleAssignmentId: contractor.actor.roleAssignmentId,
        captureId: randomUUID(),
        fileName: `baseline-${suffix}.json`,
        mimeType: "application/json",
        byteCount: sourceBytes.length,
        expectedHash: checksum,
        sourcePartyId: contractor.actor.partyId,
        mediaType: "document",
        discipline: scope.discipline,
        packageId: scope.packageId,
        locationId: scope.locationId,
      },
    },
  );
  const upload = await json<{ id: string }>(uploadStart, 201);

  await json(
    await request.put(
      `/api/projects/${contractor.projectId}/uploads/${upload.id}/chunks`,
      {
        headers: {
          ...headers(contractor, true),
          "Upload-Offset": "0",
          "Content-Type": "application/octet-stream",
        },
        data: sourceBytes,
      },
    ),
    200,
  );
  const evidence = await json<{ id: string; version: number }>(
    await request.post(
      `/api/projects/${contractor.projectId}/uploads/${upload.id}/complete`,
      {
        headers: headers(contractor, true),
        data: {
          roleAssignmentId: contractor.actor.roleAssignmentId,
          expectedHash: checksum,
        },
      },
    ),
    201,
  );

  const imported = await json<{ record: RecordDTO }>(
    await request.post(
      `/api/projects/${contractor.projectId}/schedule-source-imports`,
      {
        headers: headers(contractor, true),
        data: {
          roleAssignmentId: contractor.actor.roleAssignmentId,
          clientObjectId: randomUUID(),
          scope,
          title: `Issue 89 baseline ${suffix}`,
          sourceEvidenceRef: {
            objectType: "Evidence",
            objectId: evidence.id,
            version: evidence.version,
          },
          inputMode: "normalized_json",
          parserVersion: "doul-normalized-json-v1",
          schedule: {
            ...source.schedule,
            sourceFileRef: upload.id,
            sourceFileHash: checksum,
          },
          activities: source.activities.map((activity) => ({
            clientObjectId: randomUUID(),
            ...activity,
          })),
          criticalActivityId: source.criticalActivityId,
        },
      },
    ),
    201,
  );
  let baseline = imported.record;

  baseline = await command(
    request,
    contractor,
    "schedule-baselines",
    baseline,
    "submit_baseline",
  );
  baseline = await command(
    request,
    supervisor,
    "schedule-baselines",
    baseline,
    "receive_baseline",
  );
  baseline = await command(
    request,
    supervisor,
    "schedule-baselines",
    baseline,
    "start_baseline_review",
  );
  baseline = await command(
    request,
    supervisor,
    "schedule-baselines",
    baseline,
    "request_baseline_decision",
  );

  const approvalCreated = await json<{ record: RecordDTO }>(
    await request.post(
      `/api/projects/${contractor.projectId}/approvals`,
      {
        headers: headers(contractor, true),
        data: {
          roleAssignmentId: contractor.actor.roleAssignmentId,
          clientObjectId: randomUUID(),
          payload: {
            targetRef: {
              objectType: "InformationItem",
              objectId: baseline.id,
              version: baseline.version,
            },
            requestedBy: contractor.actor.partyId,
            approvalKind: "technical",
            ...scope,
          },
        },
      },
    ),
    201,
  );
  let approval = approvalCreated.record;
  approval = await command(
    request,
    supervisor,
    "approvals",
    approval,
    "review",
  );
  approval = await command(
    request,
    supervisor,
    "approvals",
    approval,
    "approve",
  );

  baseline = await command(
    request,
    supervisor,
    "schedule-baselines",
    baseline,
    "approve_baseline",
    {
      approvalRef: {
        objectType: "Approval",
        objectId: approval.id,
        version: approval.version,
      },
    },
  );
  baseline = await command(
    request,
    supervisor,
    "schedule-baselines",
    baseline,
    "activate_baseline",
  );
  expect(baseline.status).toBe("effective");
  return baseline;
}

async function ensureSupervisor(page: Page) {
  await page.goto("/");
  const selector = page.getByRole("combobox", { name: "개발 역할 선택" });
  if ((await selector.inputValue()) !== "SUP") {
    const refreshed = page.waitForResponse(
      (response) => response.url().endsWith("/workspace") && response.ok(),
    );
    await selector.selectOption("SUP");
    await refreshed;
  }
}

test("Delay creation requires preserved Evidence and reaches the real Backend", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  const contractor = await session(request, "CON");
  const supervisor = await session(request, "SUP");
  expect(contractor.projectId).toBe(supervisor.projectId);
  const setupWorkspace = await workspace(request, supervisor);
  const rawScope = setupWorkspace.context.scope;
  const scope: Scope = {
    packageId: rawScope.packageId,
    locationId: rawScope.locationId,
    discipline: rawScope.discipline,
    responsibleOrganizationId: rawScope.responsibleOrganizationId,
  };
  const evidenceId = setupWorkspace.context.evidenceId;
  const baseline = await createEffectiveBaseline(
    request,
    contractor,
    supervisor,
    scope,
  );
  const baselineRef = JSON.stringify({
    objectType: "InformationItem",
    objectId: baseline.id,
    version: baseline.version,
  });

  await ensureSupervisor(page);
  await page.goto("/#/schedule");
  const surface = page.locator('[data-ui-component="schedule-workspace"]');
  await expect(surface).toBeVisible();
  await surface.getByRole("tab", { name: "지연사건", exact: true }).click();
  await surface
    .getByRole("button", { name: "공정 기록 추가", exact: true })
    .click();

  const dialog = page.getByRole("dialog", { name: "공정 기록 추가" });
  const evidenceSelect = dialog.getByLabel("근거 증빙", { exact: true });
  const submit = dialog.getByRole("button", { name: "기록 추가", exact: true });

  await expect(evidenceSelect).toBeVisible();
  await expect(dialog).toContainText(
    "지연사건은 서버에 보존된 근거 증빙을 선택해야 등록할 수 있습니다.",
  );
  await expect(submit).toBeDisabled();

  await evidenceSelect.selectOption(evidenceId);
  await dialog
    .locator("label")
    .filter({ hasText: "제목" })
    .locator("input")
    .fill("Evidence-backed Delay");
  await dialog
    .locator("label")
    .filter({ hasText: "지연사건 번호" })
    .locator("textarea")
    .fill(`DE-UI-${randomUUID().slice(0, 8)}`);
  await dialog
    .locator("label")
    .filter({ hasText: "지연 유형" })
    .locator("textarea")
    .fill("forecast_delay");
  await dialog
    .locator("label")
    .filter({ hasText: "관찰 시각" })
    .locator("textarea")
    .fill("2026-10-07T07:30:00+07:00");
  await dialog
    .locator("label")
    .filter({ hasText: "인지 시각" })
    .locator("textarea")
    .fill("2026-10-07T07:30:00+07:00");
  await dialog
    .locator("label")
    .filter({ hasText: "description" })
    .locator("textarea")
    .fill("Evidence-backed delay");
  await dialog
    .locator("label")
    .filter({ hasText: "기준공정 참조" })
    .locator("textarea")
    .fill(baselineRef);
  await dialog
    .locator("label")
    .filter({ hasText: "현재 공정 참조" })
    .locator("textarea")
    .fill(baselineRef);

  await expect(submit).toBeEnabled();
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/delay-events") &&
      response.request().method() === "POST",
  );
  await submit.click();
  const response = await createdResponse;
  expect(response.status()).toBe(201);
  const created = (await response.json()) as {
    record: {
      title: string;
      status: string;
      evidenceIds: string[];
      data: Record<string, unknown>;
    };
  };
  expect(created.record.evidenceIds).toEqual([evidenceId]);
  expect(created.record.data).not.toHaveProperty("evidenceIds");
  expect(created.record.status).toBe("observed");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".detail-head")).toContainText(
    "Evidence-backed Delay",
  );

  const invalidEvidence = randomUUID();
  const invalid = await request.post(
    `/api/projects/${supervisor.projectId}/delay-events`,
    {
      headers: headers(supervisor, true),
      data: {
        roleAssignmentId: supervisor.actor.roleAssignmentId,
        clientObjectId: randomUUID(),
        payload: {
          ...scope,
          title: "Invalid Evidence Delay",
          evidenceIds: [invalidEvidence],
          data: {
            delayEventNo: `DE-BAD-${randomUUID().slice(0, 8)}`,
            eventType: "forecast_delay",
            observedAt: "2026-10-07T07:30:00+07:00",
            knownAt: "2026-10-07T07:30:00+07:00",
            description: "invalid evidence probe",
            baselineScheduleRef: JSON.parse(baselineRef),
            currentScheduleRef: JSON.parse(baselineRef),
          },
        },
      },
    },
  );
  expect(invalid.status()).toBe(404);
  const invalidBody = (await invalid.json()) as { code: string };
  expect(invalidBody.code).toBe("OBJECT_NOT_FOUND");
});
