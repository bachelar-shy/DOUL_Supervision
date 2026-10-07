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
  const context = (await response.json()).context;
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
  return { con, sup, context, title, stop, headers };
}

async function selectRole(page: Page, role: string) {
  const picker = page.getByRole("combobox", { name: "개발 역할 선택" });
  if (await picker.inputValue() !== role) {
    const refreshed = page.waitForResponse(response => response.url().endsWith("/workspace") && response.ok());
    await picker.selectOption(role);
    await refreshed;
  }
  await page.goto("/#/parallel-test");
}

test("selected current SafetyStopOrder uses server actions and refuses a guarded resume", async ({ page, request }) => {
  const fixture = await createVisibleStop(request);
  const { con, sup, context, title, stop, headers } = fixture;
  const uiWrites: string[] = [];
  page.on("request", req => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method()) && req.url().includes("/api/")) uiWrites.push(`${req.method()} ${req.url()}`);
  });
  await page.goto("/#/parallel-test");
  await selectRole(page, "CON");
  await expect(page.getByText("병렬 기능 통합 테스트", { exact: true })).toBeVisible();
  uiWrites.length = 0;
  await page.getByRole("tab", { name: "안전 추적성", exact: true }).click();
  const panel = page.locator('[data-ui-component="safety-connected"]');
  await panel.getByLabel("작업중지 원본", { exact: true }).selectOption(stop.id);
  await expect(panel.getByLabel("작업중지 원본", { exact: true })).toHaveValue(stop.id);
  await expect(panel.getByText(title, { exact: true })).toBeVisible();
  const commandRegion = panel.locator(".safety-connected-commands");
  const acknowledge = commandRegion.getByRole("button", { name: "작업중지 확인 열기", exact: true });
  await expect(acknowledge).toBeEnabled();

  await acknowledge.click();
  const dialog = page.getByRole("dialog", { name: /작업중지 확인/ });
  await expect(dialog.getByText(new RegExp(`원본 v${stop.version} 기준`))).toBeVisible();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  expect(uiWrites).toEqual([]);

  await acknowledge.click();
  await page.getByRole("dialog").getByRole("button", { name: "확인 후 실행", exact: true }).click();
  await expect.poll(async () => {
    const current = await request.get(`/api/projects/${sup.projectId}/safety-stop-orders/${stop.id}`, { headers: headers(con) });
    return (await current.json()).status;
  }).toBe("acknowledged");
  expect(uiWrites.some(url => url.includes(`/safety-stop-orders/${stop.id}/acknowledge-stop`))).toBe(true);

  const beforeGuard = await request.get(`/api/projects/${sup.projectId}/safety-stop-orders/${stop.id}`, { headers: headers(con) });
  const versionBeforeGuard = (await beforeGuard.json()).version;
  const resume = commandRegion.getByRole("button", { name: "재개 요청 열기 · 입력 후 서버 검증", exact: true });
  await expect(resume).toBeEnabled();
  await resume.click();
  const resumeDialog = page.getByRole("dialog");
  await resumeDialog.getByLabel("명령 증빙 ID").fill(context.evidenceId);
  await resumeDialog.getByRole("button", { name: "확인 후 실행", exact: true }).click();
  await expect(resumeDialog.getByRole("alert")).toBeVisible();
  const afterGuard = await request.get(`/api/projects/${sup.projectId}/safety-stop-orders/${stop.id}`, { headers: headers(con) });
  const afterRecord = await afterGuard.json();
  expect(afterRecord.version).toBe(versionBeforeGuard);
  expect(afterRecord.data.resumeRequestAt).toBeUndefined();
  expect(uiWrites.filter(url => url.includes(`/safety-stop-orders/${stop.id}/request-resume`))).toHaveLength(1);
});
