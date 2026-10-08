import { expect, test } from "@playwright/test";

const ref = (objectType: string, objectId: string, version = 1) => ({ objectType, objectId, version });

const completionFixtures = [
  {
    machine: "commissioning_package",
    record: {
      id: "ui-commissioning-01", projectId: "project-ui", version: 3, status: "testing",
      title: "UI Commissioning Record", requirementRefs: [ref("Requirement", "req-profile-1")],
      data: {
        commissioningNo: "CM-UI-01", system: "Pump train A", commissioningProfileRef: ref("Requirement", "req-profile-1"),
        readinessStatus: "ready", lastTestOutcome: "pass", testResultHistory: [
          { outcome: "fail", acceptanceCriteriaMet: false, failureReason: "Initial pressure leak", recordedAt: "2026-09-20T09:00:00Z", testResultRef: ref("Evidence", "test-fail-1") },
          { outcome: "pass", acceptanceCriteriaMet: true, recordedAt: "2026-09-21T11:00:00Z", testResultRef: ref("Evidence", "test-pass-1") },
        ],
      },
    }, actions: [{ command: "start_test", to: "SUP", fields: [], authority: "SUP", requiresInput: false, ready: true, expectedVersion: 3, requiresEvidence: false }],
  },
  {
    machine: "handover_package",
    record: {
      id: "ui-handover-01", projectId: "project-ui", version: 2, status: "accepted_with_reservations",
      title: "UI Handover Record", data: {
        handoverNo: "HO-UI-01", handoverReady: true, readinessStatus: "ready",
        handoverScope: { scopeId: "SCOPE-A", system: "Pump train A", locationIds: ["LOC-A"], assetRefs: [ref("Asset", "asset-a")] },
        handoverProfileRef: ref("Requirement", "req-handover-1"), acceptedDocumentRefs: [ref("InformationItem", "asbuilt-1")],
        reservations: [{ issueRef: ref("Issue", "issue-open-1"), ownerPartyId: "OWNER-1", dueAt: "2026-10-30T00:00:00Z", requirement: "Replace acoustic insulation" }],
        acceptedScope: { scopeId: "SCOPE-A", system: "Pump train A", locationIds: ["LOC-A"], assetRefs: [ref("Asset", "asset-a")] },
        warrantyStartAt: "2026-10-01T00:00:00Z",
      },
    }, actions: [],
  },
  {
    machine: "warranty_claim",
    record: {
      id: "ui-warranty-01", projectId: "project-ui", version: 4, status: "reinspection",
      title: "UI Warranty Record", data: {
        claimNo: "WC-UI-01", handoverRef: ref("WorkItem", "ui-handover-01"), warrantyPeriodRef: ref("Requirement", "req-warranty-1"),
        defectObservedAt: "2026-10-02T08:00:00Z", defectScope: { scopeId: "SCOPE-A", system: "Pump train A", locationIds: ["LOC-A"], assetRefs: [] },
        defectDescription: "Vibration above expected threshold", causeDescription: "Loose coupling", operationalImpact: "Reduced throughput",
        remedySummary: "Coupling re-torqued", remedyEvidenceIds: ["evidence-remedy-1"],
        reinspectionHistoryRefs: [ref("Inspection", "inspection-rework-1"), ref("Inspection", "inspection-retest-1")],
        closureEvidenceRefs: [],
      },
    }, actions: [],
  },
];

test("completion workspace keeps commissioning, handover, and warranty records separate and shows their histories", async ({ page }) => {
  await page.route(/\/api\/projects\/[^/]+\/workspace(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const workspace = await response.json();
    workspace.items.push(...completionFixtures);
    const { packageId, locationId, discipline } = workspace.context.scope;
    workspace.context.requirementRef = ref("Requirement", "req-generic-default");
    workspace.context.referenceCatalog = {
      requirements: [
        { ref: ref("Requirement", "req-generic-default"), record: {
          id: "req-generic-default", version: 1, status: "active", packageId, locationId, discipline,
          title: "Generic requirement", applicability: { genericRule: {} },
        } },
        { ref: ref("Requirement", "req-commissioning-profile"), record: {
          id: "req-commissioning-profile", version: 2, status: "active", packageId, locationId, discipline,
          title: "Commissioning profile", applicability: { commissioningProfile: { requiredDocuments: [] } },
        } },
      ], assets: [],
    };
    workspace.context.creationCapabilities = {
      ...workspace.context.creationCapabilities,
      commissioning_package: { status: "available", canCreate: true, authority: "CON", reasons: [] },
    };
    await route.fulfill({ response, json: workspace });
  });

  await page.goto("/#/completion");
  const workspace = page.locator('[data-ui-component="completion-handover-workspace"]');
  await expect(workspace).toBeVisible();
  const tabs = workspace.getByRole("tab");
  await expect(tabs).toHaveCount(3);

  await workspace.getByRole("button", { name: /기록 추가/ }).click();
  const createDialog = page.getByRole("dialog");
  const profileOptions = await createDialog.locator("select").first().locator("option").allTextContents();
  expect(profileOptions.join(" ")).toContain("Commissioning profile");
  expect(profileOptions.join(" ")).not.toContain("Generic requirement");
  await createDialog.getByRole("button", { name: /닫기/ }).click();

  await tabs.nth(0).click();
  await workspace.getByRole("button", { name: /UI Commissioning Record/ }).click();
  await expect(workspace.locator(".completion-history")).toHaveCount(1);
  await expect(workspace).toContainText("Initial pressure leak");
  await expect(workspace).toContainText("test-fail");
  await expect(workspace).toContainText("test-pass");
  await expect(workspace.locator(".completion-commands button")).toHaveCount(1);

  await tabs.nth(1).click();
  await workspace.getByRole("button", { name: /UI Handover Record/ }).click();
  await expect(workspace).toContainText("SCOPE-A");
  await expect(workspace).toContainText("Replace acoustic insulation");
  await expect(workspace).toContainText("HO-UI-01");
  await expect(workspace).toContainText("asbuilt-");

  await tabs.nth(2).click();
  await workspace.getByRole("button", { name: /UI Warranty Record/ }).click();
  await expect(workspace).toContainText("Vibration above expected threshold");
  await expect(workspace).toContainText("Coupling re-torqued");
  await expect(workspace).toContainText("inspection-rework");
});
