import { selectCommandEvidence } from "./command-evidence-helper";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function createVisibleStop(request: APIRequestContext) {
  const login = async (actorGroup: string) => {
    const response = await request.post("/api/dev/sessions", { data: { actorGroup } });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const con = await login("CON");
  const sup = await login("SUP");
  expect(sup.projectId).toBe(con.projectId);
  const headers = (session: any) => ({
    Authorization: `Bearer ${session.accessToken}`,
    "X-RoleAssignment-Id": session.actor.roleAssignmentId,
    "Idempotency-Key": randomUUID(),
  });
  const response = await request.get(`/api/projects/${con.projectId}/workspace`, { headers: headers(con) });
  expect(response.status(), await response.text()).toBe(200);
  const workspace = await response.json();
  const context = workspace.context;
  const correctiveAction = workspace.items.find((item: any) => item.machine === "action" && !["verified", "closed", "cancelled"].includes(item.record.status));
  expect(correctiveAction, "a current non-complete Action is required for synthetic correction setup").toBeTruthy();
  const permitResponse = await request.post(`/api/projects/${con.projectId}/safety-permits`, {
    headers: headers(con),
    data: { roleAssignmentId: con.actor.roleAssignmentId, clientObjectId: randomUUID(), payload: { ...context.scope, title: "Synthetic command verification permit", data: {} } },
  });
  expect(permitResponse.status(), await permitResponse.text()).toBe(201);
  const permit = (await permitResponse.json()).record;
  const suffix = randomUUID().slice(0, 8);
  const title = `Synthetic command verification stop ${suffix}`;
  const created = await request.post(`/api/projects/${con.projectId}/safety-stop-orders`, {
    headers: headers(sup),
    data: {
      roleAssignmentId: sup.actor.roleAssignmentId,
      clientObjectId: randomUUID(),
      payload: {
        ...context.scope,
        title,
        evidenceIds: [context.evidenceId],
        data: {
          stopOrderNo: `STOP-CMD-${suffix}`,
          stopScopeType: "permit",
          stopReason: "Synthetic verification of guarded resume flow",
          observedAt: new Date().toISOString(),
          effectiveAt: new Date().toISOString(),
          affectedPermitRefs: [{ objectType: "WorkItem", objectId: permit.id, version: permit.version }],
        },
      },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const stop = (await created.json()).record;
  return { con, sup, context, title, stop, correctiveAction, headers };
}

async function selectRole(page: Page, role: string) {
  const picker = page.getByRole("combobox", { name: "시험 사용자 역할 선택" });
  if (await picker.inputValue() !== role) {
    const refreshed = page.waitForResponse(response => response.url().endsWith("/workspace") && response.ok());
    await picker.selectOption(role);
    await refreshed;
  }
  await page.goto("/#/safety");
}

test("selected current SafetyStopOrder uses server actions and refuses a guarded resume", async ({ page, request }) => {
  const fixture = await createVisibleStop(request);
  const { con, sup, context, title, stop, correctiveAction, headers } = fixture;
  const uiWrites: string[] = [];
  page.on("request", req => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method()) && req.url().includes("/api/")) uiWrites.push(`${req.method()} ${req.url()}`);
  });
  await page.goto("/#/safety");
  await selectRole(page, "CON");
  const panel = page.locator('[data-ui-component="safety-workspace"]');
  await expect(panel).toBeVisible();
  uiWrites.length = 0;
  await panel.getByRole("tab", { name: "작업중지", exact: true }).click();
  const row = panel.locator(".record-list").getByRole("button").filter({ hasText: title }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(panel.locator(".detail-head h2")).toHaveText(title);
  const commandRegion = panel.locator('[data-ui-component="action-gate"]');
  const acknowledge = commandRegion.getByRole("button", { name: /작업중지 확인/ });
  await expect(acknowledge).toBeEnabled();

  await acknowledge.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("p").filter({ hasText: `기록 제${stop.version}차 기준` })).toBeVisible();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  expect(uiWrites).toEqual([]);

  await acknowledge.click();
  const acknowledgeDialog = page.getByRole("dialog");
  const commandEvidence = acknowledgeDialog.locator(".command-evidence-picker");
  if (await commandEvidence.count()) await selectCommandEvidence(acknowledgeDialog,[context.evidenceId]);
  const acknowledgeResponse = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/safety-stop-orders/${stop.id}/acknowledge-stop`));
  await acknowledgeDialog.getByRole("button", { name: "확인 후 실행", exact: true }).click();
  const acknowledgedCommand = await acknowledgeResponse;
  expect(acknowledgedCommand.status(), await acknowledgedCommand.text()).toBe(200);
  expect((await acknowledgedCommand.json()).record).toMatchObject({ id: stop.id, status: "acknowledged", version: stop.version + 1 });
  await expect.poll(async () => {
    const current = await request.get(`/api/projects/${sup.projectId}/safety-stop-orders/${stop.id}`, { headers: headers(con) });
    return (await current.json()).status;
  }).toBe("acknowledged");
  expect(uiWrites.some(url => url.includes(`/safety-stop-orders/${stop.id}/acknowledge-stop`))).toBe(true);

  const acknowledgedResponse = await request.get(`/api/projects/${sup.projectId}/safety-stop-orders/${stop.id}`, { headers: headers(con) });
  const acknowledged = await acknowledgedResponse.json();
  const correctionResponse = await request.post(`/api/projects/${sup.projectId}/safety-stop-orders/${stop.id}/start-correction`, {
    headers: headers(con),
    data: {
      roleAssignmentId: con.actor.roleAssignmentId,
      expectedVersion: acknowledged.version,
      payload: { correctiveActionRefs: [{ objectType: "Action", objectId: correctiveAction.record.id, version: correctiveAction.record.version }] },
      evidenceIds: [],
    },
  });
  expect(correctionResponse.status(), await correctionResponse.text()).toBe(200);

  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  const beforeGuard = await request.get(`/api/projects/${sup.projectId}/safety-stop-orders/${stop.id}`, { headers: headers(con) });
  const versionBeforeGuard = (await beforeGuard.json()).version;
  const actionResponse = await request.get(`/api/projects/${sup.projectId}/safety-stop-orders/${stop.id}/available-actions`, { headers: headers(con) });
  const resumeAction = (await actionResponse.json()).find((action: any) => action.command === "request_resume");
  expect(resumeAction).toMatchObject({ ready: false, requiresInput: false, expectedVersion: versionBeforeGuard });
  const resumeControl = commandRegion.getByRole("button", { name: /재개 요청/ });
  if (await resumeControl.count()) await expect(resumeControl).toBeDisabled();
  const resumeAttempt = await request.post(`/api/projects/${sup.projectId}/safety-stop-orders/${stop.id}/request-resume`, {
    headers: headers(con),
    data: {
      roleAssignmentId: con.actor.roleAssignmentId,
      expectedVersion: versionBeforeGuard,
      payload: {},
      evidenceIds: [context.evidenceId],
    },
  });
  expect(resumeAttempt.status()).toBe(409);
  expect((await resumeAttempt.json()).code).toBe("STOP_RESUME_REQUEST_READY");
  const afterGuard = await request.get(`/api/projects/${sup.projectId}/safety-stop-orders/${stop.id}`, { headers: headers(con) });
  const afterRecord = await afterGuard.json();
  expect(afterRecord.version).toBe(versionBeforeGuard);
  expect(afterRecord.data.resumeRequestAt).toBeUndefined();
  expect(uiWrites.filter(url => url.includes(`/safety-stop-orders/${stop.id}/request-resume`))).toHaveLength(0);
});
