import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

type Session = { accessToken: string; projectId: string; actor: { partyId: string; roleAssignmentId: string } };
function headers(session: Session, idempotent = false) {
  return { Authorization: `Bearer ${session.accessToken}`, "X-RoleAssignment-Id": session.actor.roleAssignmentId,
    ...(idempotent ? { "Idempotency-Key": randomUUID() } : {}) };
}
async function ok<T>(request: APIRequestContext, path: string, session: Session, data?: unknown, expected = 200): Promise<T> {
  const response = data === undefined ? await request.get(path, { headers: headers(session) })
    : await request.post(path, { headers: headers(session, true), data });
  const text = await response.text(); expect(response.status(), `${path}: ${text}`).toBe(expected); return JSON.parse(text) as T;
}
async function command(request: APIRequestContext, session: Session, collection: string, id: string, commandName: string,
  current: { id: string; version: number }, payload: Record<string, unknown> = {}, evidenceIds: string[] = []) {
  const result = await ok<{ record: { id: string; version: number } }>(request,
    `/api/projects/${session.projectId}/${collection}/${id}/${commandName.replaceAll("_", "-")}`, session,
    { roleAssignmentId: session.actor.roleAssignmentId, expectedVersion: current.version, payload, evidenceIds }, 200);
  return result.record;
}
async function syntheticCase(request: APIRequestContext) {
  const login = async (actorGroup: string) => {
    const response = await request.post("/api/dev/sessions", { data: { actorGroup } });
    const text = await response.text(); expect(response.status(), text).toBe(200); return JSON.parse(text) as Session;
  };
  const con = await login("CON"); const sup = await login("SUP"); expect(con.projectId).toBe(sup.projectId);
  const context = await ok<{ context: { scope: Record<string, unknown>; evidenceId: string; requirementRef: object; drawingRef: object } }>(request,
    `/api/projects/${con.projectId}/workspace`, con);
  const scope = context.context.scope; const evidenceId = context.context.evidenceId;
  const suffix = randomUUID().slice(0, 8); const now = new Date(); const at = (offset: number) => new Date(now.getTime() + offset).toISOString();
  const inspection = (await ok<{ record: { id: string; version: number } }>(request, `/api/projects/${con.projectId}/inspections`, con, {
    roleAssignmentId: con.actor.roleAssignmentId, clientObjectId: randomUUID(), payload: { ...scope,
      workName: `Synthetic case flow ${suffix}`, selfInspectionComplete: true,
      precheck: { drawing: true, material: true, test: true, previous: true, change: true }, holdPoint: false,
      minimumQualificationRank: 1, nextWorkAllowed: false, requirementRefs: [context.context.requirementRef],
      drawingRef: context.context.drawingRef, evidenceIds: [evidenceId] },
  }, 201)).record;
  let failed = inspection;
  failed = await command(request, con, "inspections", failed.id, "request", failed,
    { requestedAt: at(0), requestedInspectionAt: at(3_600_000), selfInspectionComplete: true,
      precheck: { drawing: true, material: true, test: true, previous: true, change: true },
      drawingRef: context.context.drawingRef, requirementRefs: [context.context.requirementRef] }, [evidenceId]);
  failed = await command(request, sup, "inspections", failed.id, "receive", failed, { receivedAt: at(0) }, [evidenceId]);
  failed = await command(request, sup, "inspections", failed.id, "schedule", failed, { scheduledAt: at(0) }, [evidenceId]);
  failed = await command(request, sup, "inspections", failed.id, "start", failed, {}, [evidenceId]);
  failed = await command(request, sup, "inspections", failed.id, "submit_results", failed, { checkResults: [{ itemId: "dimension",
    requirementRef: context.context.requirementRef, result: "fail", evidenceIds: [evidenceId], measuredValue: 90, unit: "mm" }] }, [evidenceId]);
  failed = await command(request, sup, "inspections", failed.id, "fail", failed, { failureReason: "Synthetic browser case flow" }, [evidenceId]);

  const observation = (await ok<{ record: { id: string; version: number } }>(request, `/api/projects/${sup.projectId}/observations`, sup, {
    roleAssignmentId: sup.actor.roleAssignmentId, clientObjectId: randomUUID(), payload: { ...scope, source: "supervisor",
      description: `Synthetic confirmed observation ${suffix}`, grounding: [{ evidenceId, channel: "visual", claimSupport: "observed" }], evidenceIds: [evidenceId] },
  }, 201)).record;
  let confirmed = await command(request, sup, "observations", observation.id, "begin_review", observation);
  confirmed = await command(request, sup, "observations", observation.id, "confirm", confirmed, { verificationNote: "Synthetic fixture verified" }, [evidenceId]);
  const dueAt = at(86_400_000);
  const issueResult = await ok<{ issue: { id: string }; correctiveAction: { id: string } }>(request,
    `/api/projects/${sup.projectId}/inspection-cases/${failed.id}/issues`, sup, {
      roleAssignmentId: sup.actor.roleAssignmentId, issueObjectId: randomUUID(), actionObjectId: randomUUID(), observationIds: [confirmed.id],
      subtype: "NCR", title: `Synthetic Issue ${suffix}`, actionTitle: `Synthetic correction ${suffix}`,
      responsiblePartyId: con.actor.partyId, dueAt,
    }, 201);
  const graph = await ok<{ issues: Array<{ issue: { record: { id: string } }; observations: Array<{ record: { id: string } }>; correctiveActions: Array<{ record: { id: string } }> }> }>(request,
    `/api/projects/${sup.projectId}/inspection-cases/${failed.id}`, sup);
  expect(graph.issues.some(group => group.issue.record.id === issueResult.issue.id
    && group.observations.some(item => item.record.id === confirmed.id)
    && group.correctiveActions.some(item => item.record.id === issueResult.correctiveAction.id))).toBeTruthy();
  return { title: `Synthetic case flow ${suffix}`, issueTitle: `Synthetic Issue ${suffix}`, inspectionId: failed.id,
    observationId: confirmed.id, correctiveActionId: issueResult.correctiveAction.id };
}

test("inspection case panel shows the server-linked graph and opens commands only after explicit user intent", async ({ page, request }) => {
  const fixture = await syntheticCase(request);
  const errors: string[] = []; const transitionPosts: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", req => { if (req.method() === "POST" && /\/api\/projects\/[^/]+\/(?:issues|actions|inspections|owner-reports)\//.test(new URL(req.url()).pathname)) transitionPosts.push(req.url()); });
  await page.goto("/#/parallel-test");
  await page.getByLabel("개발 역할 선택").selectOption("SUP");
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "작업함", exact: true }).click();
  const panel = page.getByTestId("inspection-case-flow");
  await expect(panel).toBeVisible();
  await panel.getByLabel("원 검측 선택", { exact: true }).selectOption(fixture.inspectionId);
  await expect(panel.getByText(fixture.issueTitle, { exact: false })).toBeVisible();
  await expect(panel.getByText(fixture.observationId, { exact: false })).toBeVisible();
  await expect(panel.getByText(fixture.correctiveActionId, { exact: false })).toBeVisible();
  await expect(panel.getByText("서버 준비상태 · 시정 주기 0", { exact: true })).toBeVisible();
  const candidate = panel.locator(".inspection-case-actions button:not([disabled])").first();
  await expect(candidate, "synthetic linked graph must expose a server-provided current command candidate").toBeVisible();
  transitionPosts.length = 0;
  await candidate.click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("button", { name: "확인 후 실행" })).toBeVisible();
  await expect(modal.getByRole("button", { name: "취소" })).toBeVisible();
  expect(transitionPosts).toEqual([]);
  await modal.getByRole("button", { name: "취소" }).click();
  await expect(modal).toHaveCount(0);
  expect(transitionPosts).toEqual([]);
  expect(errors).toEqual([]);
});
