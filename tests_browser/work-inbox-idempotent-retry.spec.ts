import { test, expect } from "@playwright/test";

test("work inbox retries an uncertain command with the same idempotency key and server result", async ({ page, request }) => {
  const target = /\/api\/projects\/([^/]+)\/inspections\/([^/]+)\/start$/;
  const posts: Array<{ key: string | undefined; body: string | null }> = [];
  let firstResponse: { status: number; body: string; auditId: string; record: Record<string, unknown> } | null = null;
  let replayResponse: typeof firstResponse = null;
  let authHeaders: Record<string, string> | null = null;
  let projectId = "";
  let recordId = "";

  await page.route(target, async route => {
    const req = route.request();
    const match = req.url().match(target);
    if (!match) throw new Error(`Unexpected command URL: ${req.url()}`);
    projectId = match[1];
    recordId = match[2];
    authHeaders = await req.allHeaders();
    posts.push({ key: authHeaders["idempotency-key"], body: req.postData() });

    // Let the real API receive and commit the first command, then discard only
    // its response to the browser to reproduce an uncertain transport outcome.
    const response = await route.fetch();
    const body = await response.text();
    const parsed = JSON.parse(body) as { auditEvent: { id: string }; record: Record<string, unknown> };
    const captured = { status: response.status(), body, auditId: parsed.auditEvent.id, record: parsed.record };
    if (posts.length === 1) {
      firstResponse = captured;
      await route.abort("connectionreset");
      return;
    }
    replayResponse = captured;
    await route.fulfill({ status: response.status(), headers: response.headers(), body });
  });

  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "작업함", exact: true }).click();
  const inbox = page.getByTestId("work-inbox-actions");
  await expect(inbox).toBeVisible();
  await expect(inbox.getByRole("status")).toHaveCount(0, { timeout: 15000 });
  const inspectionCard = inbox.locator(".work-inbox-card").filter({ has: page.locator(".badge", { hasText: /^검측$/ }) }).filter({ has: page.locator(".work-inbox-candidate", { hasText: "시작전이" }) }).first();
  const candidate = inspectionCard.locator(".work-inbox-candidate").filter({ hasText: "시작전이" });
  await expect(candidate).toBeEnabled();
  await candidate.click();
  const modal = page.getByRole("dialog");
  const submit = modal.getByRole("button", { name: "확인 후 실행" });
  await expect(submit).toBeVisible();
  await submit.click();

  await expect(page.getByRole("alert").filter({ hasText: "연결을 확인한 뒤 다시 시도" })).toBeVisible();
  await expect(modal).toBeVisible();
  await submit.click();

  await expect(modal).toHaveCount(0);
  expect(posts).toHaveLength(2);
  expect(posts[0].key).toBeTruthy();
  expect(posts[1].key).toBe(posts[0].key);
  expect(posts[1].body).toBe(posts[0].body);
  expect(firstResponse).not.toBeNull();
  expect(replayResponse).not.toBeNull();
  expect(replayResponse?.status).toBe(200);
  expect(replayResponse?.body).toBe(firstResponse?.body);
  expect(replayResponse?.auditId).toBe(firstResponse?.auditId);
  expect(replayResponse?.record).toEqual(firstResponse?.record);
  expect(replayResponse?.record.status).toBe("in_progress");

  const headers = authHeaders;
  if (!headers) throw new Error("Missing browser authorization headers");
  const workspace = await request.get(new URL(`/api/projects/${projectId}/workspace`, page.url()).toString(), {
    headers: {
      authorization: headers.authorization,
      "x-roleassignment-id": headers["x-roleassignment-id"],
    },
  });
  expect(workspace.ok()).toBeTruthy();
  const state = await workspace.json() as { items: Array<{ record: { id: string; status: string } }>; audit: Array<{ id: string; objectRef: { objectId: string } }> };
  expect(state.items.find(item => item.record.id === recordId)?.record.status).toBe("in_progress");
  expect(state.audit.filter(event => event.objectRef.objectId === recordId && event.id === firstResponse?.auditId)).toHaveLength(1);
});
