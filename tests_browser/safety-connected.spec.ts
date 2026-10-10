import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function createVisibleStopOrder(request: APIRequestContext) {
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
  const workspaceResponse = await request.get(
    `/api/projects/${con.projectId}/workspace`, { headers: headers(con) },
  );
  expect(workspaceResponse.status(), await workspaceResponse.text()).toBe(200);
  const context = (await workspaceResponse.json()).context;
  const permitResponse = await request.post(
    `/api/projects/${con.projectId}/safety-permits`,
    {
      headers: headers(con),
      data: {
        roleAssignmentId: con.actor.roleAssignmentId,
        clientObjectId: randomUUID(),
        payload: { ...context.scope, title: "Synthetic browser safety permit", data: {} },
      },
    },
  );
  expect(permitResponse.status(), await permitResponse.text()).toBe(201);
  const permit = (await permitResponse.json()).record;
  const suffix = randomUUID().slice(0, 8);
  const title = `Synthetic browser safety stop ${suffix}`;
  const stopResponse = await request.post(
    `/api/projects/${con.projectId}/safety-stop-orders`,
    {
      headers: headers(sup),
      data: {
        roleAssignmentId: sup.actor.roleAssignmentId,
        clientObjectId: randomUUID(),
        payload: {
          ...context.scope,
          title,
          evidenceIds: [context.evidenceId],
          data: {
            stopOrderNo: `STOP-BROWSER-${suffix}`,
            stopScopeType: "permit",
            stopReason: "Synthetic browser read-path verification",
            observedAt: new Date().toISOString(),
            effectiveAt: new Date().toISOString(),
            affectedPermitRefs: [{ objectType: "WorkItem", objectId: permit.id, version: permit.version }],
          },
        },
      },
    },
  );
  expect(stopResponse.status(), await stopResponse.text()).toBe(201);
  return title;
}

test("safety connected trace follows a real visible stop order without issuing commands", async ({ page, request }) => {
  const title = await createVisibleStopOrder(request);
  const pageErrors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", req => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method()) && req.url().includes("/api/")) {
      writes.push(req.method() + " " + req.url());
    }
  });
  await page.goto("/#/parallel-test");
  await expect(page.getByRole("heading", { name: "업무별 상세 확인", exact: true })).toBeVisible();
  writes.length = 0;
  await page.getByRole("tab", { name: "안전 관련 기록 확인", exact: true }).click();
  const panel = page.locator('[data-ui-component="safety-connected"]');
  await expect(panel).toBeVisible();
  await panel.getByLabel("작업중지 원본", { exact: true }).selectOption({ label: `${title} · 기록 제1차` });
  await expect(panel.getByText("읽기 전용 조회 · 공식 상태 변경 없음", { exact: true })).toBeVisible();
  await expect(panel.getByText(title, { exact: true })).toBeVisible();
  await expect(panel.getByText("영향 작업허가", { exact: true })).toBeVisible();
  await expect(panel.getByText(/기록 작성 차수 \d+/).first()).toBeVisible();
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
});
