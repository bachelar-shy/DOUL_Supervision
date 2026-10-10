import { expect, test } from "@playwright/test";

const drawingRef = { objectType: "InformationItem", objectId: "historical-impact-drawing", version: 1 };
async function noticeFixture(page: import("@playwright/test").Page) {
  await page.route("**/parallel/notifications", async route => {
    const response = await route.fetch();
    const data = await response.json();
    expect(data.items.length).toBeGreaterThan(0);
    data.items[0].drawingImpact = { incidentId: "impact-explorer", drawingRef, title: "도면 변경에 따른 업무 재확인",
      message: "선택한 구 개정 도면의 영향 업무를 확인하십시오.", reason: "SOURCE_CHANGED", occurredAt: data.items[0].notification.dueAt };
    await route.fulfill({ response, json: { ...data, items: [data.items[0]] } });
  });
}
const incident = (ref = drawingRef, id = "impact-explorer") => ({ incidentId: id, drawingRef: ref, title: "구 개정 기준 도면", revision: "R0",
  reason: "SOURCE_CHANGED", occurredAt: "2026-10-08T00:00:00Z", items: [{ sourceRef: { objectType: "Inspection", objectId: "missing-work", version: 1 },
    machine: "inspection", title: "정확한 구본 연결 검측", status: "requested", responsiblePartyId: "contractor" }] });

test("impact explorer keeps the exact historical ref and does not substitute a new revision", async ({ page }) => {
  await noticeFixture(page);
  await page.route("**/parallel/drawing-impacts", route => route.fulfill({ json: { items: [
    incident(), { ...incident({ ...drawingRef, version: 2 }, "other-incident"), title: "대체되면 안 되는 신본" },
  ], total: 2 } }));
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "알림", exact: true }).click();
  await page.getByRole("button", { name: "영향 업무 보기", exact: true }).click();
  const panel = page.getByTestId("drawing-impact-panel");
  await expect(panel).toContainText("정확한 구본 연결 검측");
  await expect(panel.getByTestId("impact-drawing-ref")).toContainText("historical-impact-drawing · 기록 제1차");
  await expect(panel).not.toContainText("대체되면 안 되는 신본");
  await expect(panel).toContainText("해당 작성 차수의 PDF 원본을 현재 권한으로 열 수 없습니다.");
  await expect(panel).toContainText("업무 원본을 현재 업무 화면에서 열 수 없습니다.");
  await expect(panel.getByRole("button", { name: "업무 원본 보기" })).toHaveCount(0);
});

for (const fails of [false, true]) test(`prior-role delayed impact ${fails ? "failure" : "result"} cannot display after switching roles`, async ({ page }) => {
  await noticeFixture(page);
  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { captured = resolve; });
  await page.route("**/parallel/drawing-impacts", async route => {
    captured(); await held;
    if (fails) await route.fulfill({ status: 503, json: { message: "obsolete-impact-error" } });
    else await route.fulfill({ json: { items: [incident()], total: 1 } });
  });
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "알림", exact: true }).click();
  await page.getByRole("button", { name: "영향 업무 보기", exact: true }).click();
  await ready;
  await expect(page.getByTestId("drawing-impact-panel")).toContainText("영향 업무를 불러오는 중");
  await page.getByLabel("시험 사용자 역할 선택").selectOption("ADM");
  await expect(page.getByLabel("시험 사용자 역할 선택")).toHaveValue("ADM");
  release();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByTestId("drawing-impact-panel")).toHaveCount(0);
  await expect(page.getByText("obsolete-impact-error")).toHaveCount(0);
});
