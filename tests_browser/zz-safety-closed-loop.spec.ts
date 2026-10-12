import { selectCommandEvidence } from "./command-evidence-helper";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { commands, fields } from "../apps/web/src/labels";

type ActorGroup = "CON" | "SUP";
type Session = {
  accessToken: string;
  projectId: string;
  actor: { actorGroup: ActorGroup; partyId: string; roleAssignmentId: string };
};
type DomainRef = { objectType: string; objectId: string; version: number };
type RecordData = {
  id: string;
  version: number;
  title?: string;
  status: string;
  data?: Record<string, any>;
  [key: string]: any;
};

const readiness = {
  methodStatementCurrent: true,
  riskAssessmentCurrent: true,
  personnelQualified: true,
  equipmentReady: true,
  controlMeasuresReady: true,
  emergencyReady: true,
  environmentalConditionsReady: true,
  noBlockingSafetyIssue: true,
};

function headers(session: Session, key = randomUUID()) {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    "X-RoleAssignment-Id": session.actor.roleAssignmentId,
    "Idempotency-Key": key,
  };
}

async function jsonResponse<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>, expected: number): Promise<T> {
  const text = await response.text();
  expect(response.status(), text).toBe(expected);
  return JSON.parse(text) as T;
}

async function post<T>(
  request: APIRequestContext,
  projectId: string,
  session: Session,
  path: string,
  data: unknown,
  expected = 200,
  key = randomUUID(),
): Promise<T> {
  const response = await request.post(`/api/projects/${projectId}/${path}`, {
    headers: headers(session, key),
    data,
  });
  return jsonResponse<T>(response, expected);
}

async function login(request: APIRequestContext, role: ActorGroup): Promise<Session> {
  const response = await request.post("/api/dev/sessions", { data: { actorGroup: role } });
  return jsonResponse<Session>(response, 200);
}

async function createRecord(
  request: APIRequestContext,
  projectId: string,
  actor: Session,
  collection: string,
  scope: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<RecordData> {
  const result = await post<{ record: RecordData }>(request, projectId, actor, collection, {
    roleAssignmentId: actor.actor.roleAssignmentId,
    clientObjectId: randomUUID(),
    payload: { ...scope, ...payload },
  }, 201);
  return result.record;
}

async function apiCommand(
  request: APIRequestContext,
  projectId: string,
  actor: Session,
  collection: string,
  current: RecordData,
  command: string,
  payload: Record<string, unknown> = {},
  evidenceIds: string[] = [],
  expected = 200,
): Promise<RecordData> {
  const result = await post<{ record: RecordData }>(request, projectId, actor,
    `${collection}/${current.id}/${command.replaceAll("_", "-")}`, {
      roleAssignmentId: actor.actor.roleAssignmentId,
      expectedVersion: current.version,
      payload,
      evidenceIds,
    }, expected);
  return result.record;
}

async function chooseRole(page: Page, role: ActorGroup) {
  await page.goto("/#/safety");
  const picker = page.getByRole("combobox", { name: "시험 사용자 역할 선택" });
  if (await picker.inputValue() !== role) {
    const workspaceRefresh = page.waitForResponse(response => response.url().endsWith("/workspace") && response.ok());
    await picker.selectOption(role);
    await workspaceRefresh;
  }
  await page.goto("/#/safety");
  await expect(page.locator('[data-ui-component="safety-workspace"]')).toBeVisible();
}

const safetyTabs: Record<string, string> = {
  "safety-permits": "작업허가",
  "safety-stop-orders": "작업중지",
};

async function uiCommand(
  page: Page,
  projectId: string,
  actor: Session,
  collection: string,
  current: RecordData,
  command: string,
  payload: Record<string, unknown> = {},
  evidenceId?: string,
): Promise<RecordData> {
  await chooseRole(page, actor.actor.actorGroup);
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.getByRole("tab", { name: safetyTabs[collection], exact: true }).click();
  const workspace = page.locator('[data-ui-component="safety-workspace"]');
  const row = workspace.locator(".record-list").getByRole("button").filter({ hasText: current.title! }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(workspace.locator(".detail-head")).toContainText(current.title!);
  const label = commands[command] || command;
  await workspace.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: label });
  for (const [field, value] of Object.entries(payload)) {
    const name = fields[field] || field;
    const input = dialog.getByRole("combobox", { name, exact: true })
      .or(dialog.getByRole("textbox", { name, exact: true }))
      .or(dialog.getByRole("listbox", { name, exact: true }));
    await expect(input).toBeVisible();
    const tag = await input.evaluate(element => element.tagName);
    if (tag === "SELECT") {
      const multiple = await input.evaluate(element => (element as HTMLSelectElement).multiple);
      await input.selectOption(multiple && Array.isArray(value) ? value.map(ref => JSON.stringify(ref)) : typeof value === "object" ? JSON.stringify(value) : String(value));
    } else {
      await input.fill(typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }
  if (evidenceId) await selectCommandEvidence(dialog,[evidenceId]);
  const submitted = page.waitForResponse(response =>
    response.request().method() === "POST" &&
    response.url().endsWith(`/api/projects/${projectId}/${collection}/${current.id}/${command.replaceAll("_", "-")}`));
  await dialog.getByRole("button", { name: "확인 후 실행", exact: true }).click();
  const response = await submitted;
  const body = await jsonResponse<{ record: RecordData }>(response, 200);
  expect(response.request().postDataJSON().expectedVersion).toBe(current.version);
  expect(response.request().headers()["idempotency-key"]).toBeTruthy();
  await expect(dialog).toHaveCount(0);
  return body.record;
}

async function createPassedReverification(
  request: APIRequestContext,
  projectId: string,
  con: Session,
  sup: Session,
  context: Record<string, any>,
  title: string,
): Promise<RecordData> {
  const inspection = await createRecord(request, projectId, con, "inspections", context.scope, {
    workName: title,
    selfInspectionComplete: true,
    precheck: { drawing: true, material: true, test: true, previous: true, change: true },
    holdPoint: true,
    minimumQualificationRank: 1,
    nextWorkAllowed: false,
    requirementRefs: [context.requirementRef],
    drawingRef: context.drawingRef,
    evidenceIds: [context.evidenceId],
  });
  let current = await apiCommand(request, projectId, con, "inspections", inspection, "request", {
    requestedAt: new Date().toISOString(),
    requestedInspectionAt: new Date(Date.now() + 60_000).toISOString(),
    selfInspectionComplete: true,
    precheck: { drawing: true, material: true, test: true, previous: true, change: true },
    requirementRefs: [context.requirementRef],
    drawingRef: context.drawingRef,
  }, [context.evidenceId]);
  current = await apiCommand(request, projectId, sup, "inspections", current, "receive", { receivedAt: new Date().toISOString() });
  current = await apiCommand(request, projectId, sup, "inspections", current, "schedule", { scheduledAt: new Date().toISOString() });
  current = await apiCommand(request, projectId, sup, "inspections", current, "start");
  current = await apiCommand(request, projectId, sup, "inspections", current, "submit_results", {
    checkResults: [{
      itemId: "dimension",
      requirementRef: context.requirementRef,
      result: "pass",
      evidenceIds: [context.evidenceId],
      measuredValue: 120,
      unit: "mm",
    }],
  }, [context.evidenceId]);
  current = await apiCommand(request, projectId, sup, "inspections", current, "pass", {}, [context.evidenceId]);
  expect(current.status).toBe("passed");
  expect(current.resultStatus).toBe("pass");
  const release = await post<{ code: string }>(request, projectId, sup,
    `inspections/${current.id}/release-next-work`, {
      roleAssignmentId: sup.actor.roleAssignmentId,
      expectedVersion: current.version,
      payload: {},
      evidenceIds: [context.evidenceId],
    }, 409);
  expect(release.code).toBe("ACCEPTANCE_SIGNED");
  expect(current.nextWorkAllowed).toBe(false);
  return current;
}

test("Safety real API loop keeps Permit authorization, Stop Lift, and Permit resume distinct", async ({ page, request }) => {
  // This scenario performs multiple authenticated HTTP and UI transitions.
  // CI measured more than 30 seconds; keep each state/authority assertion intact.
  test.setTimeout(120000);
  const con = await login(request, "CON");
  const sup = await login(request, "SUP");
  expect(con.projectId).toBe(sup.projectId);
  const projectId = con.projectId;
  const contextResponse = await request.get(`/api/projects/${projectId}/workspace`, { headers: headers(con) });
  const context = (await jsonResponse<{ context: Record<string, any> }>(contextResponse, 200)).context;
  const suffix = randomUUID().slice(0, 8);
  const now = new Date(Date.now() - 60_000).toISOString();
  const validTo = new Date(Date.now() + 86_400_000).toISOString();
  const permitTitle = `AC-S-Safety permit ${suffix}`;
  const permit = await createRecord(request, projectId, con, "safety-permits", context.scope, {
    title: permitTitle,
    requirementRefs: [context.requirementRef],
    evidenceIds: [context.evidenceId],
    data: {},
  });
  let currentPermit = await uiCommand(page, projectId, con, "safety-permits", permit, "submit_permit", {
    permitNo: `PERMIT-${suffix}`,
    workType: "Elevated installation work",
    riskLevel: "high",
    responsiblePartyId: con.actor.partyId,
    safetyResponsiblePartyId: sup.actor.partyId,
    methodStatementRef: context.requirementRef,
    riskAssessmentRef: context.requirementRef,
    emergencyPlanRef: context.requirementRef,
    personnelQualificationRefs: [],
    equipmentRefs: [],
    validFrom: now,
    validTo,
    readiness,
    blockedReasons: [],
  }, context.evidenceId);
  currentPermit = await uiCommand(page, projectId, sup, "safety-permits", currentPermit, "receive_permit");
  currentPermit = await uiCommand(page, projectId, sup, "safety-permits", currentPermit, "accept_for_safety_review");
  currentPermit = await uiCommand(page, projectId, sup, "safety-permits", currentPermit, "request_prestart_verification", {
    safetyReviewComplete: true,
    readiness,
    reviewNotes: "Synthetic AC-S-01 pre-start review",
  });

  const prestartInspection = await createPassedReverification(request, projectId, con, sup, context, `AC-S-01 Prestart ${suffix}`);
  currentPermit = await uiCommand(page, projectId, sup, "safety-permits", currentPermit, "request_authorization", {
    prestartVerified: true,
    prestartVerificationRefs: [{ objectType: "Inspection", objectId: prestartInspection.id, version: prestartInspection.version }],
    readiness,
  }, context.evidenceId);
  currentPermit = await uiCommand(page, projectId, sup, "safety-permits", currentPermit, "authorize");
  expect(currentPermit.status).toBe("authorized");
  expect(currentPermit.data?.workAuthorized).toBe(false);
  currentPermit = await uiCommand(page, projectId, sup, "safety-permits", currentPermit, "activate", { readiness, blockedReasons: [] });
  expect(currentPermit.status).toBe("active");
  expect(currentPermit.data?.workAuthorized).toBe(true);

  const stopTitle = `AC-S-01 Stop ${suffix}`;
  const stopPayload = {
    roleAssignmentId: sup.actor.roleAssignmentId,
    clientObjectId: randomUUID(),
    payload: {
      ...context.scope,
      title: stopTitle,
      evidenceIds: [context.evidenceId],
      data: {
        stopOrderNo: `STOP-${suffix}`,
        stopScopeType: "permit",
        stopReason: "Uncontrolled fall hazard observed",
        hazardDescription: "Temporary edge protection was incomplete",
        observedAt: now,
        effectiveAt: now,
        affectedPermitRefs: [{ objectType: "WorkItem", objectId: currentPermit.id, version: currentPermit.version }],
      },
    },
  };
  const stopIdempotencyKey = randomUUID();
  const firstCreate = await post<{ record: RecordData }>(request, projectId, sup, "safety-stop-orders", stopPayload, 201, stopIdempotencyKey);
  const replayCreate = await post<{ record: RecordData }>(request, projectId, sup, "safety-stop-orders", stopPayload, 201, stopIdempotencyKey);
  expect(replayCreate).toEqual(firstCreate);
  let stop = firstCreate.record;
  expect(stop.status).toBe("issued");
  let permitRead = await jsonResponse<RecordData>(await request.get(`/api/projects/${projectId}/safety-permits/${currentPermit.id}`, { headers: headers(con) }), 200);
  expect(permitRead.status).toBe("suspended");
  expect(permitRead.data?.workAuthorized).toBe(false);
  expect(permitRead.data?.stopOrderRefs).toContainEqual({ objectType: "WorkItem", objectId: stop.id, version: stop.version });

  const workspaceResponse = await request.get(`/api/projects/${projectId}/workspace`, { headers: headers(con) });
  const workspace = await jsonResponse<{ items: Array<{ machine: string; record: RecordData }> }>(workspaceResponse, 200);
  const linkedIssue = workspace.items.find(item => item.machine === "issue")?.record;
  expect(linkedIssue, "synthetic project must supply an existing current Issue for the corrective Action link").toBeTruthy();
  const actionTitle = `AC-S-01 remedy ${suffix}`;
  let action = await createRecord(request, projectId, sup, "actions", context.scope, {
    title: actionTitle,
    relatedIssueId: linkedIssue!.id,
    dueAt: validTo,
    responsiblePartyId: con.actor.partyId,
    evidenceIds: [context.evidenceId],
  });
  action = await apiCommand(request, projectId, sup, "actions", action, "assign", {
    responsiblePartyId: con.actor.partyId,
    responsibleOrganizationId: context.scope.responsibleOrganizationId,
    dueAt: validTo,
  });
  action = await apiCommand(request, projectId, con, "actions", action, "start");
  action = await apiCommand(request, projectId, con, "actions", action, "submit", {
    correction: "Guarding restored and work area isolated",
    rootCause: "Temporary control measure was omitted",
    preventiveAction: "Updated the pre-start control checklist",
  }, [context.evidenceId]);
  action = await apiCommand(request, projectId, sup, "actions", action, "verify", {}, [context.evidenceId]);
  expect(action.status).toBe("verified");

  stop = await uiCommand(page, projectId, con, "safety-stop-orders", stop, "acknowledge_stop");
  const staleAcknowledge = await post<{ code: string; currentVersion?: number }>(request, projectId, con,
    `safety-stop-orders/${stop.id}/acknowledge-stop`, {
      roleAssignmentId: con.actor.roleAssignmentId,
      expectedVersion: stop.version - 1,
      payload: {},
      evidenceIds: [],
    }, 409);
  expect(staleAcknowledge.code).toBe("VERSION_CONFLICT");
  expect(staleAcknowledge.currentVersion).toBe(stop.version);

  stop = await uiCommand(page, projectId, con, "safety-stop-orders", stop, "start_correction", {
    correctiveActionRefs: [{ objectType: "Action", objectId: action.id, version: action.version }],
  });
  const deniedSelfResume = await post<{ code: string }>(request, projectId, con,
    `safety-stop-orders/${stop.id}/lift-stop`, {
      roleAssignmentId: con.actor.roleAssignmentId,
      expectedVersion: stop.version,
      payload: {},
      evidenceIds: [context.evidenceId],
    }, 403);
  expect(deniedSelfResume.code).toBe("NOT_AUTHORIZED");
  stop = await uiCommand(page, projectId, con, "safety-stop-orders", stop, "request_resume", {}, context.evidenceId);
  const inspection = await createPassedReverification(request, projectId, con, sup, context, `AC-S-01 Reverification ${suffix}`);
  stop = await uiCommand(page, projectId, sup, "safety-stop-orders", stop, "start_resume_verification", {
    resumeVerificationRefs: [{ objectType: "Inspection", objectId: inspection.id, version: inspection.version }],
  });
  stop = await uiCommand(page, projectId, sup, "safety-stop-orders", stop, "lift_stop", {}, context.evidenceId);
  expect(stop.status).toBe("lifted");
  expect(stop.data?.liftedAt).toBeTruthy();
  expect(Object.values(stop.data?.resumeGate || {}).every(value => value === true)).toBe(true);
  permitRead = await jsonResponse<RecordData>(await request.get(`/api/projects/${projectId}/safety-permits/${currentPermit.id}`, { headers: headers(con) }), 200);
  expect(permitRead.status).toBe("suspended");
  expect(permitRead.data?.workAuthorized).toBe(false);

  currentPermit = await uiCommand(page, projectId, con, "safety-permits", permitRead, "request_resume", { readiness, blockedReasons: [] }, context.evidenceId);
  expect(currentPermit.status).toBe("resume_review");
  expect(currentPermit.data?.workAuthorized).toBe(false);
  const deniedContractorApproval = await post<{ code: string }>(request, projectId, con,
    `safety-permits/${currentPermit.id}/approve-resume`, {
      roleAssignmentId: con.actor.roleAssignmentId,
      expectedVersion: currentPermit.version,
      payload: { readiness, blockedReasons: [] },
      evidenceIds: [context.evidenceId],
    }, 403);
  expect(deniedContractorApproval.code).toBe("NOT_AUTHORIZED");
  currentPermit = await uiCommand(page, projectId, sup, "safety-permits", currentPermit, "approve_resume", {
    readiness,
    blockedReasons: [],
  }, context.evidenceId);
  expect(currentPermit.status).toBe("active");
  expect(currentPermit.data?.workAuthorized).toBe(true);

  const finalStop = await jsonResponse<RecordData>(await request.get(`/api/projects/${projectId}/safety-stop-orders/${stop.id}`, { headers: headers(sup) }), 200);
  const finalPermit = await jsonResponse<RecordData>(await request.get(`/api/projects/${projectId}/safety-permits/${currentPermit.id}`, { headers: headers(sup) }), 200);
  expect(finalStop.status).toBe("lifted");
  expect(finalPermit.status).toBe("active");
  expect(finalPermit.data?.workAuthorized).toBe(true);
  expect(finalPermit.data?.stopOrderRefs).toContainEqual({ objectType: "WorkItem", objectId: stop.id, version: firstCreate.record.version });
  expect(finalPermit.data?.equipmentRefs).toEqual([]);
});
