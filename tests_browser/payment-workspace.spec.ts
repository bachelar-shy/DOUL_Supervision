import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

type Session = {
  projectId: string;
  accessToken: string;
  actor: { roleAssignmentId: string; actorGroup: string };
};

async function login(request: APIRequestContext, actorGroup: string): Promise<Session> {
  const response = await request.post("/api/dev/sessions", { data: { actorGroup } });
  expect(response.status()).toBe(200);
  return response.json();
}

function headers(session: Session, key?: string) {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    "X-Role-Assignment-Id": session.actor.roleAssignmentId,
    ...(key ? { "Idempotency-Key": key } : {}),
  };
}

async function openPayment(page: Page) {
  await page.goto("/#/payment");
  const rolePicker = page.getByRole("combobox", { name: "개발 역할 선택" });
  if ((await rolePicker.inputValue()) !== "CON") {
    const refresh = page.waitForResponse((response) => response.url().endsWith("/workspace") && response.ok());
    await rolePicker.selectOption("CON");
    await refresh;
    await page.goto("/#/payment");
  }
  await expect(page.locator('[data-ui-component="measurement-payment-workspace"]')).toBeVisible();
}

test("AC-PAY UI: contractor creates an API-backed claim draft and sees server capability", async ({ page }) => {
  await openPayment(page);
  await page.getByRole("tab", { name: "기성 신청", exact: true }).click();
  const create = page.getByRole("button", { name: "기록 추가", exact: true });
  await expect(create).toBeEnabled();
  await create.click();
  const dialog = page.getByRole("dialog", { name: "기성 신청 기록 추가" });
  const title = `Payment UI ${randomUUID().slice(0, 8)}`;
  const claimNo = `IPC-UI-${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel("제목 *").fill(title);
  await dialog.getByLabel("번호 *").fill(claimNo);
  const created = page.waitForResponse((response) => response.url().endsWith("/payment-claims") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "초안 저장", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  expect(response.request().headers()["idempotency-key"]).toBeTruthy();
  const record = (await response.json()).record;
  expect(record.data.paymentClaimNo).toBe(claimNo);
  await expect(page.locator(".detail-head")).toContainText(title);
  await expect(page.locator(".payment-summary")).toContainText("청구액");
  await expect(page.locator(".payment-detail-section").filter({ hasText: "개별 지급 기록" })).toContainText("부분지급은 각각 별도 기록으로 보존됩니다.");

  const picker = page.getByRole("combobox", { name: "개발 역할 선택" });
  const refresh = page.waitForResponse((value) => value.url().endsWith("/workspace") && value.ok());
  await picker.selectOption("OWN");
  await refresh;
  await page.goto("/#/payment");
  await page.getByRole("tab", { name: "기성 신청", exact: true }).click();
  await expect(page.getByRole("button", { name: "기록 추가", exact: true })).toBeDisabled();
  await expect(page.locator(".payment-capability-note")).toBeVisible();
});

test("Payment endpoints reject wrong-role and stale commands and deduplicate an idempotent create", async ({ request }) => {
  const con = await login(request, "CON");
  const workspaceResponse = await request.get(`/api/projects/${con.projectId}/workspace`, { headers: headers(con) });
  expect(workspaceResponse.status()).toBe(200);
  const workspace = await workspaceResponse.json();
  const submitPayload = {
    periodStart: "2026-09-01T00:00:00Z",
    periodEnd: "2026-09-30T23:59:59Z",
    contractRef: workspace.context.requirementRef,
    boqRef: workspace.context.requirementRef,
    currency: "VND",
    quantityMeasurementRefs: [{ objectType: "WorkItem", objectId: randomUUID(), version: 1 }],
    claimedGrossAmount: "100.00",
    previousCertifiedAmount: "0",
    previousPaidAmount: "0",
  };
  const clientObjectId = randomUUID();
  const claimNo = `IPC-IDEMP-${randomUUID().slice(0, 8)}`;
  const payload = {
    ...workspace.context.scope,
    subtype: "PaymentClaim",
    title: claimNo,
    data: { paymentClaimNo: claimNo },
  };
  const key = `payment-create-${randomUUID()}`;
  const postCreate = () => request.post(`/api/projects/${con.projectId}/payment-claims`, {
    headers: headers(con, key),
    data: { roleAssignmentId: con.actor.roleAssignmentId, clientObjectId, payload },
  });
  const first = await postCreate();
  expect(first.status()).toBe(201);
  const firstBody = await first.json();
  const replay = await postCreate();
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(firstBody);
  const claim = firstBody.record;

  const owner = await login(request, "OWN");
  const forbidden = await request.post(`/api/projects/${owner.projectId}/payment-claims/${claim.id}/submit-payment-claim`, {
    headers: headers(owner, `owner-submit-${randomUUID()}`),
    data: { roleAssignmentId: owner.actor.roleAssignmentId, expectedVersion: claim.version, payload: submitPayload, evidenceIds: [] },
  });
  expect(forbidden.status()).toBe(403);

  const withdrawn = await request.post(`/api/projects/${con.projectId}/payment-claims/${claim.id}/withdraw-payment-claim`, {
    headers: headers(con, `withdraw-${randomUUID()}`),
    data: { roleAssignmentId: con.actor.roleAssignmentId, expectedVersion: claim.version, payload: { reason: "Draft was created only to verify command versioning." }, evidenceIds: [] },
  });
  expect(withdrawn.status()).toBe(200);
  const current = (await withdrawn.json()).record;
  const stale = await request.post(`/api/projects/${con.projectId}/payment-claims/${claim.id}/withdraw-payment-claim`, {
    headers: headers(con, `stale-submit-${randomUUID()}`),
    data: { roleAssignmentId: con.actor.roleAssignmentId, expectedVersion: claim.version, payload: { reason: "Stale retry." }, evidenceIds: [] },
  });
  const staleBody = await stale.json();
  expect(stale.status(), JSON.stringify(staleBody)).toBe(409);
  expect(staleBody.code).toBe("VERSION_CONFLICT");
  const detail = await request.get(`/api/projects/${con.projectId}/payment-claims/${claim.id}`, { headers: headers(con) });
  expect((await detail.json()).version).toBe(current.version);
});
