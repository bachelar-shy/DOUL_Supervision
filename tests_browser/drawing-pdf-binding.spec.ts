import { expect, test, type Route } from "@playwright/test";

const drawingId = "22222222-2222-4222-8222-222222222222";
const evidenceId = "33333333-3333-4333-8333-333333333333";
const drawingRef = { objectType: "InformationItem", objectId: drawingId, version: 4 };
const evidenceRef = { objectType: "Evidence", objectId: evidenceId, version: 2 };
let actualProjectId = "";
function fixtureBinding(projectId: string) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    projectId,
    drawingRef,
    evidenceRef,
    fileHash: "a".repeat(64),
    createdAt: "2026-10-07T00:00:00Z",
    createdBy: "55555555-5555-4555-8555-555555555555",
  };
}

async function addPdfFixture(route: Route) {
  const response = await route.fetch();
  const workspace = await response.json();
  actualProjectId = workspace.project.id;
  expect(workspace.context.projectId).toBe(actualProjectId);
  workspace.items = workspace.items.filter((item: { machine: string; record: { id: string } }) => item.record.id !== evidenceId);
  workspace.items.push({
    machine: "evidence",
    record: {
      id: evidenceId,
      version: evidenceRef.version,
      sourceType: "original",
      mediaType: "document",
      metadata: { name: "synthetic-binding-plan.pdf", mimeType: "application/pdf" },
    },
  });
  await route.fulfill({ response, json: workspace });
}

test("uses synthetic Drawing/PDF fixtures and registers the technical binding through the UI", async ({ page }) => {
  actualProjectId = "";
  let binding: ReturnType<typeof fixtureBinding> | null = null;
  const submittedBodies: unknown[] = [];
  await page.route("**/workspace", addPdfFixture);
  await page.route("**/parallel/drawings", async (route) => {
    const url = new URL(route.request().url());
    if (url.search) return route.fallback();
    await route.fulfill({ json: { items: [{
      domainRef: drawingRef,
      title: "Synthetic plan",
      revision: "A04",
    }] } });
  });
  await page.route("**/parallel/drawing-pdf-bindings", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { items: binding ? [binding] : [] } });
      return;
    }
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    const body = route.request().postDataJSON();
    submittedBodies.push(body);
    binding = { ...fixtureBinding(actualProjectId), ...body };
    await route.fulfill({ status: 201, json: binding });
  });

  await page.goto("/#/parallel-test");
  const rolePicker = page.getByRole("combobox", { name: "개발 역할 선택" });
  if (await rolePicker.inputValue() !== "ADM") {
    const workspace = page.waitForResponse((response) => response.url().endsWith("/workspace") && response.ok());
    await rolePicker.selectOption("ADM");
    await workspace;
  }
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "도면 버전", exact: true }).click();
  const panel = page.getByRole("region", { name: "도면 PDF 연결" });
  await expect(panel).toBeVisible();
  await panel.getByLabel("도면 버전").selectOption(`${drawingRef.objectType}:${drawingId}:${drawingRef.version}`);
  await panel.getByLabel("PDF 원본").selectOption(`${evidenceRef.objectType}:${evidenceId}:${evidenceRef.version}`);
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/parallel/drawing-pdf-bindings") && response.request().method() === "POST");
  await panel.getByRole("button", { name: "선택한 버전 연결" }).click();
  expect((await saved).status()).toBe(201);
  expect(submittedBodies).toEqual([{ drawingRef, evidenceRef }]);
  await expect(panel.getByRole("list", {name: "저장된 도면 PDF 연결"}).getByText(new RegExp(fixtureBinding(actualProjectId).fileHash))).toBeVisible();
  await expect(panel.getByRole("button", { name: "이 도면 버전은 이미 PDF와 연결됨" })).toBeDisabled();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
