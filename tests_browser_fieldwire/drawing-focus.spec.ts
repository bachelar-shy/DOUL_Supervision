import { expect, test } from "@playwright/test";

test("도면 핀 이동 요청은 프로젝트별 1회용이며 오래된 토큰을 거부", async ({ page }) => {
  await page.goto("/#/capture");
  const actual = await page.evaluate(async () => {
    const mod = await import("/src/data/drawing-focus.ts");
    const valid = mod.requestDrawingFocus("site-a", "sheet-a", "pin-a");
    const first = mod.readDrawingFocus("site-a");
    const consumed = mod.consumeDrawingFocus("site-a");
    const replay = mod.readDrawingFocus("site-a");
    const other = mod.requestDrawingFocus("site-a", "sheet-a", "pin-a");
    const crossProject = mod.readDrawingFocus("site-b");
    const replayCross = mod.readDrawingFocus("site-a");
    const invalid = mod.requestDrawingFocus("", "sheet-a", "pin-a");
    return { valid, first: first?.pinId, consumed: consumed?.sheetId,
      replay, other, crossProject, replayCross, invalid };
  });
  expect(actual).toEqual({
    valid: true, first: "pin-a", consumed: "sheet-a", replay: null,
    other: true, crossProject: null, replayCross: null, invalid: false,
  });
});

test("사진에서 연결된 도면 핀으로 이동하면 검증된 시트와 핀 상세가 열린다", async ({ page }) => {
  test.setTimeout(75_000);
  await page.goto("/#/capture");
  const project = await page.evaluate(async () => {
    const response = await fetch("/api/dev/projects");
    return (await response.json()).defaultProjectId as string;
  });
  expect(project).toBeTruthy();
  const sheet = {
    id: "focus-sheet-1", projectId: project, setId: "focus-set-1", pageNo: 1,
    version: 1, number: "A-101", title: "현장 검측 위치도", folder: "A",
    revision: "A", status: "ready", createdAt: "2026-10-13T00:00:00Z",
    updatedAt: "2026-10-13T00:00:00Z", hasPreview: true, hasThumb: true,
    drawingRef: null, bindingId: null,
  };
  const pin = {
    id: "focus-pin-1", sheetId: sheet.id, projectId: project, version: 1,
    kind: "site", x: .25, y: .55, comment: "현장기록 위치", status: "draft",
    recordRef: null, createdAt: "2026-10-13T00:00:00Z", createdByRole: "SUP",
  };
  await page.route("**/drawing-sets", async route => {
    await route.fulfill({ contentType: "application/json",
      body: JSON.stringify({ items: [{
        id: sheet.setId, projectId: project, fileName: "sample.pdf", folder: "A",
        pageCount: 1, completedPages: 1, status: "ready",
        createdAt: sheet.createdAt, updatedAt: sheet.updatedAt,
      }] }) });
  });
  await page.route("**/drawing-sheets", async route => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      items: [sheet], count: 1,
    }) });
  });
  await page.route("**/drawing-sheets/focus-sheet-1/pins", async route => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      items: [pin], count: 1,
    }) });
  });
  await page.route("**/drawing-sheets/focus-sheet-1/image?size=preview", async route => {
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRkQAAAAASUVORK5CYII=",
      "base64");
    await route.fulfill({ body: pixel, contentType: "image/png" });
  });
  await page.evaluate(async ({ projectId, sheetId, pinId }) => {
    const { requestDrawingFocus } = await import("/src/data/drawing-focus.ts");
    if (!requestDrawingFocus(projectId, sheetId, pinId)) throw new Error("Focus request rejected");
  }, { projectId: project, sheetId: sheet.id, pinId: pin.id });
  await expect(page.locator(".drawing-issue-dialog")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".drawing-issue-dialog")).toContainText(pin.comment);
  await expect(page.locator(".drawing-issue-dialog")).toContainText(sheet.number);
});
