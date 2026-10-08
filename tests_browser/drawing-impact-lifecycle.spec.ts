import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
const drawingRef = { objectType: "InformationItem", objectId: "lifecycle-drawing", version: 1 };
const event = (incidentId: string, state: "active" | "restored", resolvedAt: string | null) => ({
  incidentId, drawingRef, title: "발생 도면", revision: "R0", reason: "FIELD_SOURCE_UNAVAILABLE",
  occurredAt: "2026-10-08T00:00:00Z", state, resolvedAt,
  items: [{ sourceRef: { objectType: "Inspection", objectId: "historical-inspection", version: 1 },
    machine: "inspection", title: "사건 당시 검측", status: "requested", responsiblePartyId: "contractor" }],
});
async function setup(page: Page) {
  await page.route("**/parallel/notifications", async route => {
    const response = await route.fetch(); const data = await response.json();
    expect(data.items.length).toBeGreaterThan(0);
    const source = data.items[0];
    data.items = ["first-event", "recurrence"].map((incidentId, index) => ({ ...source,
      notification: { ...source.notification, id: "lifecycle-notice-" + index },
      drawingImpact: { incidentId, drawingRef, title: "도면 변경에 따른 업무 재확인", message: "이력 확인 " + incidentId,
        reason: "FIELD_SOURCE_UNAVAILABLE", occurredAt: "2026-10-08T00:00:00Z" } }));
    await route.fulfill({ response, json: data });
  });
  await page.route("**/parallel/drawing-impacts", route => route.fulfill({ json: { items: [], total: 0 } }));
}
async function open(page: Page, index = 0) {
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "알림", exact: true }).click();
  await page.locator('[data-notification-id="lifecycle-notice-' + index + '"]').getByRole("button", { name: "영향 업무 보기", exact: true }).click();
}

test("restored historical event stays visible after current work clears and recurrence is distinct", async ({ page }) => {
  await setup(page);
  await page.route("**/parallel/drawing-impacts/history", route => route.fulfill({ json: { items: [
    event("first-event", "restored", null), event("recurrence", "active", null),
    { ...event("wrong-version", "active", null), drawingRef: { ...drawingRef, version: 2 } },
  ], total: 3 } }));
  await open(page);
  await expect(page.getByTestId("drawing-impact-current")).toContainText("현재 조회 가능한 미완료 영향 업무가 없습니다");
  const history = page.getByTestId("drawing-impact-history");
  await expect(history).toContainText("사용 조건 복구 관측");
  await expect(history).toContainText("복구 시각 미기록");
  await expect(history).toContainText("사건 당시 기록 · historical-inspection · v1");
  await expect(history).toContainText("연결 업무의 완료 또는 재승인을 뜻하지 않습니다");
  await expect(history.locator("[data-impact-history-incident]")).toHaveCount(1);
  await expect(history.locator('[data-impact-history-incident="first-event"]')).toBeVisible();
  await page.locator('[data-notification-id="lifecycle-notice-1"]').getByRole("button", { name: "영향 업무 보기", exact: true }).click();
  await expect(history.locator('[data-impact-history-incident="recurrence"]')).toBeVisible();
  await expect(history).toContainText("사용 조건 확인 필요");
  await expect(history).not.toContainText("사용 조건 복구 관측");
});

test("history failure has a retry and does not suppress current result", async ({ page }) => {
  await setup(page);
  await page.route("**/parallel/drawing-impacts", route => route.fulfill({ json: { items: [{ ...event("first-event", "active", null), title: "현재 영향 도면", items: [{ ...event("first-event", "active", null).items[0], title: "현재 미완료 검측 유지" }] }], total: 1 } }));
  let retryRequested = false;
  await page.route("**/parallel/drawing-impacts/history", route => !retryRequested
    ? route.fulfill({ status: 503, json: { message: "history-retry-fixture" } })
    : route.fulfill({ json: { items: [event("first-event", "restored", "2026-10-08T01:00:00Z")], total: 1 } }));
  await open(page);
  await expect(page.getByTestId("drawing-impact-history")).toContainText("발생·해소 이력을 불러오지 못했습니다");
  await expect(page.getByTestId("drawing-impact-current")).toContainText("현재 미완료 검측 유지");
  retryRequested = true;
  await page.getByTestId("drawing-impact-panel").getByRole("button", { name: "다시 조회", exact: true }).click();
  await expect(page.getByTestId("drawing-impact-history")).toContainText("복구 관측 2026-10-08T01:00:00Z");
  await expect(page.getByTestId("drawing-impact-history").getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("drawing-impact-current")).toContainText("현재 미완료 검측 유지");
});

test("obsolete history refresh cannot replace a newer response", async ({ page }) => {
  await setup(page);
  let release!: () => void; let captured!: () => void; let delivered!: () => void;
  const oldDelivered = new Promise<void>(resolve => { delivered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { captured = resolve; });
  let retryRequested = false;
  await page.route("**/parallel/drawing-impacts/history", async route => {
    if (!retryRequested) { captured(); await held; await route.fulfill({ json: { items: [event("first-event", "active", null)], total: 1 } }); delivered(); }
    else await route.fulfill({ json: { items: [event("first-event", "restored", "2026-10-08T02:00:00Z")], total: 1 } });
  });
  await open(page); await ready;
  retryRequested = true;
  await page.getByTestId("drawing-impact-panel").getByRole("button", { name: "다시 조회", exact: true }).click();
  await expect(page.getByTestId("drawing-impact-history")).toContainText("복구 관측 2026-10-08T02:00:00Z");
  release(); await oldDelivered;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByTestId("drawing-impact-history")).toContainText("사용 조건 복구 관측");
});

for (const fails of [false, true]) test(`prior role delayed history ${fails ? "failure" : "success"} stays hidden`, async ({ page }) => {
  await setup(page);
  let release!: () => void; let captured!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { captured = resolve; });
  await page.route("**/parallel/drawing-impacts/history", async route => {
    captured(); await held;
    if (fails) await route.fulfill({ status: 503, json: { message: "obsolete-history-error" } });
    else await route.fulfill({ json: { items: [event("first-event", "restored", "2026-10-08T03:00:00Z")], total: 1 } });
  });
  await open(page); await ready;
  await page.getByLabel("개발 역할 선택").selectOption("ADM");
  await expect(page.getByLabel("개발 역할 선택")).toHaveValue("ADM");
  release();
  await expect(page.getByTestId("drawing-impact-panel")).toHaveCount(0);
  await expect(page.getByText("obsolete-history-error")).toHaveCount(0);
});
