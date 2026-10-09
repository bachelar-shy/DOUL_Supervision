import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { actionAuthoringTranslations } from "@doul/localization";

type Locale = "ko" | "vi" | "en";
type Session = {
  projectId: string;
  accessToken: string;
  actor: { partyId: string; roleAssignmentId: string; actorGroup: string };
};
type Ref = { objectType: string; objectId: string; version: number };
type RecordDTO = Record<string, unknown> & { id: string; version: number; status?: string; title?: string };
type Workspace = {
  project: { id: string; name: string };
  context: {
    projectId: string;
    scope: Record<string, unknown>;
    creationCapabilities?: Record<string, { status: string; canCreate: boolean; authority: string | null }>;
    referenceCatalog?: { issues?: Array<{ ref: Ref; record: RecordDTO }> };
  };
  items: Array<{ machine: string; record: RecordDTO }>;
  participants: Array<{ partyId: string; name: string; actorGroup: string }>;
  audit: Array<{ objectRef?: Ref; command: string; afterState: string }>;
};

const labels = actionAuthoringTranslations;
const rolePicker = (page: Page) => page.locator(".top-actions .role-picker select").nth(1);
const languagePicker = (page: Page) => page.locator(".top-actions .role-picker select").first();
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ["--no-sandbox"] } });
}

async function login(request: APIRequestContext, actorGroup: "SUP" | "OWN"): Promise<Session> {
  const response = await request.post("/api/dev/sessions", { data: { actorGroup } });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

function auth(session: Session) {
  return { Authorization: `Bearer ${session.accessToken}`, "X-Role-Assignment-Id": session.actor.roleAssignmentId };
}

async function workspace(request: APIRequestContext, session: Session): Promise<Workspace> {
  const response = await request.get(`/api/projects/${session.projectId}/workspace`, { headers: auth(session) });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function chooseRole(page: Page, role: "SUP" | "OWN") {
  if (await rolePicker(page).inputValue() !== role) {
    const updated = page.waitForResponse((response) => response.url().endsWith("/workspace") && response.ok());
    await rolePicker(page).selectOption(role);
    await updated;
  }
  await page.goto("/#/actions");
}

async function chooseLocale(page: Page, locale: Locale) {
  await languagePicker(page).selectOption(locale);
  await expect(page.locator("html")).toHaveAttribute("lang", { ko: "ko-KR", vi: "vi-VN", en: "en-US" }[locale]);
}

function matchingIssue(value: Workspace) {
  const scope = value.context.scope;
  return (value.context.referenceCatalog?.issues ?? []).find(({ ref, record }) =>
    ref.objectType === "Issue" && record.projectId === value.context.projectId
    && ["packageId", "locationId", "discipline", "responsibleOrganizationId"].every((field) => record[field] === scope[field]));
}

test("SUP creates a scoped Action draft through Workbench, preserves it across locales, and reset does not create a duplicate", async ({ page, request }) => {
  const supervisor = await login(request, "SUP");
  const initialWorkspace = await workspace(request, supervisor);
  expect(initialWorkspace.context.creationCapabilities?.action).toMatchObject({ status: "available", canCreate: true, authority: "create_action" });
  const issue = matchingIssue(initialWorkspace);
  expect(issue, "demo API must expose a current Issue in the server-provided creation scope").toBeTruthy();
  const contractor = initialWorkspace.participants.find((participant) => participant.actorGroup === "CON");
  expect(contractor, "demo API must expose a readable contractor participant").toBeTruthy();

  await page.goto("/#/actions");
  await chooseRole(page, "SUP");
  const panel = page.locator('[data-ui-component="action-authoring-panel"]');
  await expect(panel).toBeVisible();
  const suffix = randomUUID().slice(0, 10);
  const title = `Action draft browser ${suffix}`;
  const titleInput = panel.getByLabel(labels.ko.title, { exact: true });
  const issueSelect = panel.getByLabel(labels.ko.relatedIssue, { exact: true });
  const assigneeSelect = panel.getByLabel(labels.ko.assignee, { exact: true });
  const dueAtInput = panel.getByLabel(labels.ko.dueAt, { exact: true });
  await titleInput.fill(title);
  await issueSelect.selectOption(issue!.ref.objectId);
  await assigneeSelect.selectOption(contractor!.partyId);
  const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  await dueAtInput.fill(dueAt);

  const mutations: string[] = [];
  page.on("request", (browserRequest) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(browserRequest.method()) && browserRequest.url().includes("/api/")) {
      mutations.push(`${browserRequest.method()} ${new URL(browserRequest.url()).pathname}`);
    }
  });
  const beforeLocaleChanges = mutations.length;
  for (const locale of ["vi", "en", "ko"] as const) {
    await chooseLocale(page, locale);
    await expect(panel.getByRole("heading", { name: labels[locale].heading, exact: true })).toBeVisible();
    await expect(panel.getByLabel(labels[locale].title, { exact: true })).toHaveValue(title);
    await expect(panel.getByLabel(labels[locale].relatedIssue, { exact: true })).toHaveValue(issue!.ref.objectId);
    await expect(panel.getByLabel(labels[locale].assignee, { exact: true })).toHaveValue(contractor!.partyId);
    await expect(panel.getByLabel(labels[locale].dueAt, { exact: true })).toHaveValue(dueAt);
  }
  expect(mutations.slice(beforeLocaleChanges), "changing the display language must not call create or workflow endpoints").toEqual([]);

  const createResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/actions"));
  await panel.getByRole("button", { name: labels.ko.create, exact: true }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  const created = await createResponse.json() as { record: RecordDTO; auditEvent: { command: string; afterState: string; objectRef: Ref } };
  expect(created.record.title).toBe(title);
  expect(created.record.relatedIssueId).toBe(issue!.ref.objectId);
  expect(created.record.correctionCycle).toBe(issue!.record.correctionCycle);
  expect(created.record.responsiblePartyId).toBe(contractor!.partyId);
  expect(created.record.status).toBe("draft");
  expect(created.record.version).toBe(1);
  expect(created.record).not.toHaveProperty("startedAt");
  expect(created.auditEvent).toMatchObject({ command: "create:action", afterState: "draft", objectRef: { objectId: created.record.id, version: 1 } });
  expect(mutations).toEqual(["POST /api/actions"]);
  await expect(panel.getByText(labels.ko.created, { exact: true })).toBeVisible();

  const persistedWorkspace = await workspace(request, supervisor);
  const persisted = persistedWorkspace.items.find((item) => item.machine === "action" && item.record.id === created.record.id);
  expect(persisted?.record).toMatchObject({ status: "draft", relatedIssueId: issue!.ref.objectId, correctionCycle: issue!.record.correctionCycle, responsiblePartyId: contractor!.partyId, version: 1 });
  const auditForCreated = persistedWorkspace.audit.filter((event) => event.objectRef?.objectId === created.record.id);
  expect(auditForCreated).toHaveLength(1);
  expect(auditForCreated[0]).toMatchObject({ command: "create:action", afterState: "draft" });

  const writesBeforeReset = mutations.length;
  await panel.getByRole("button", { name: labels.ko.newAction, exact: true }).click();
  await expect(panel.getByLabel(labels.ko.title, { exact: true })).toHaveValue("");
  await expect(panel.getByLabel(labels.ko.relatedIssue, { exact: true })).toHaveValue("");
  await expect(panel.getByLabel(labels.ko.assignee, { exact: true })).toHaveValue("");
  await expect(panel.getByLabel(labels.ko.dueAt, { exact: true })).toHaveValue("");
  expect(mutations).toHaveLength(writesBeforeReset);
  await panel.getByLabel(labels.ko.title, { exact: true }).fill(`Reset draft ${suffix}`);
  await expect(panel.getByRole("button", { name: labels.ko.create, exact: true })).toBeEnabled();
  expect(mutations).toHaveLength(writesBeforeReset);
});

test("Owner sees server-denied Action creation and cannot submit through Workbench", async ({ page, request }) => {
  const owner = await login(request, "OWN");
  const initialWorkspace = await workspace(request, owner);
  expect(initialWorkspace.context.creationCapabilities?.action).toMatchObject({ status: "unauthorized", canCreate: false });
  await page.goto("/#/actions");
  await chooseRole(page, "OWN");
  const panel = page.locator('[data-ui-component="action-authoring-panel"]');
  await expect(panel).toBeVisible();
  const create = panel.getByRole("button", { name: labels.ko.create, exact: true });
  await expect(create).toBeDisabled();
  await expect(panel.getByRole("status")).not.toBeEmpty();
  const writes: string[] = [];
  page.on("request", (browserRequest) => {
    if (browserRequest.method() === "POST" && new URL(browserRequest.url()).pathname.endsWith("/actions")) writes.push(browserRequest.url());
  });
  await expect(create).toBeDisabled();
  expect(writes).toEqual([]);
});
