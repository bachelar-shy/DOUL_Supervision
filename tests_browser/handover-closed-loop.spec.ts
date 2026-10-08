import { expect, test, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createInterface } from "node:readline";

type Ref = { objectType: string; objectId: string; version: number };
type Fixture = {
  projectId: string; scope: Record<string, string>; requirementRef: Ref; drawingRef: Ref;
  evidenceId: string; retestEvidenceId: string; commissioningProfileRef: Ref;
  inspectionRef: Ref; issueRef: Ref; actionRef: Ref;
  handoverProfileRef: Ref; assets: Ref[]; actors: Record<string, string>;
  tomorrow: string;
  disclosure: string;
};

const python = process.env.DOUL_TEST_PYTHON || "/workspace/DOUL_Supervision/work/priority-venv/bin/python";

test.use({ launchOptions: { executablePath: "/usr/bin/chromium" } });

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate fixture port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startApi(): Promise<{ child: ChildProcess; base: string; fixture: Fixture }> {
  const port = await freePort();
  const child = spawn(python, ["tests_browser/support/handover_api_fixture.py", "--port", String(port)], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const lines = createInterface({ input: child.stdout! });
  const ready = new Promise<Fixture>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Fixture startup timed out: ${stderr}`)), 15000);
    child.once("exit", (code) => reject(new Error(`Fixture exited ${code}: ${stderr}`)));
    lines.on("line", (line) => {
      try {
        const value = JSON.parse(line) as Partial<Fixture>;
        if (value.projectId && value.commissioningProfileRef) {
          clearTimeout(timeout);
          resolve(value as Fixture);
        }
      } catch { /* API request logs precede the fixture metadata. */ }
    });
  });
  const fixture = await ready;
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return { child, base, fixture };
    } catch { /* Wait for uvicorn to bind. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`Fixture server did not become healthy: ${stderr}`);
}

async function useRole(page: Page, role: "CON" | "SUP") {
  await page.locator(".top-actions .role-picker select").nth(1).selectOption(role);
  await expect(page.locator(".top-actions .role-picker select").nth(1)).toHaveValue(role);
  await page.getByRole("navigation").getByRole("button", { name: /commissioning.*handover.*warranty/i }).click();
  await expect(page.locator("[data-ui-component='completion-handover-workspace']")).toBeVisible({ timeout: 15000 });
}

test("real Completion UI creates a planned commissioning package and respects the missing current procedure gate", async ({ page }) => {
  test.setTimeout(90000);
  const { child, base, fixture } = await startApi();
  try {
    let latestWorkspace: any;
    await page.route("**/api/**", async (route) => {
      const response = await route.fetch({ url: route.request().url().replace("http://127.0.0.1:5181/api", base) });
      if (route.request().url().includes("/workspace")) {
        latestWorkspace = await response.json();
        await route.fulfill({ response, json: latestWorkspace });
      } else await route.fulfill({ response });
    });
    await page.goto("/#/completion");
    await page.locator(".top-actions .role-picker select").first().selectOption("en");
    await useRole(page, "CON");

    const workspace = page.locator("[data-ui-component='completion-handover-workspace']");
    await workspace.locator('[data-ui-component="completion-create-action"] button').click();
    const create = page.getByRole("dialog");
    await create.getByLabel(/title/i).fill("Browser commissioned system");
    await create.getByLabel(/number/i).fill("CM-BROWSER-01");
    await create.getByLabel(/^시스템$|^system$/i).fill("SYS-BROWSER");
    const choose = async (label: RegExp, ref: Ref) => {
      const select = create.getByLabel(label);
      const option = select.locator("option").filter({ hasText: ref.objectId.slice(0, 8) });
      await expect(option, `${ref.objectType} ${ref.objectId} must be visible as a server reference option`).toHaveCount(1, { timeout: 5000 });
      await select.selectOption(await option.getAttribute("value") || "");
    };
    await choose(/profile/i, fixture.commissioningProfileRef);
    await choose(/inspection/i, fixture.inspectionRef);
    await choose(/drawing/i, fixture.drawingRef);
    const created = page.waitForResponse((response) => response.request().method() === "POST" && /\/commissioning-packages$/.test(response.url()));
    await create.getByRole("button", { name: /save draft/i }).click();
    const createResponse = await created;
    expect(createResponse.status()).toBe(201);
    const recordId = (await createResponse.json()).record.id as string;
    await expect(workspace.getByRole("button", { name: /Browser commissioned system/ })).toBeVisible();
    await workspace.getByRole("button", { name: /Browser commissioned system/ }).click();

    await useRole(page, "SUP");
    await workspace.getByRole("button", { name: /Browser commissioned system/ }).click();
    const current = latestWorkspace.items.find((candidate: any) => candidate.record.id === recordId);
    expect(current.record.status).toBe("planned");
    expect(current.record.data.testResultHistory).toEqual([]);
    expect(current.actions.find((action: any) => action.command === "start_prerequisite_review")?.blockedReason?.code).toBe("COMMISSIONING_PROCEDURE_INVALID");
    const blocked = workspace.locator(".completion-commands").getByRole("button", { name: /start prerequisite review/i });
    await expect(blocked).toBeDisabled();
  } finally {
    child.kill("SIGTERM");
  }
});

test("real Completion UI preserves Owner reservation proposal inputs on a handover draft", async ({ page }) => {
  test.setTimeout(90000);
  const { child, base, fixture } = await startApi();
  try {
    let latestWorkspace: any;
    await page.route("**/api/**", async (route) => {
      const response = await route.fetch({ url: route.request().url().replace("http://127.0.0.1:5181/api", base) });
      if (route.request().url().includes("/workspace")) {
        latestWorkspace = await response.json();
        await route.fulfill({ response, json: latestWorkspace });
      } else await route.fulfill({ response });
    });
    await page.goto("/#/completion");
    await page.locator(".top-actions .role-picker select").first().selectOption("en");
    await useRole(page, "CON");
    const workspace = page.locator("[data-ui-component='completion-handover-workspace']");
    await workspace.getByRole("tab", { name: /handover/i }).click();
    await workspace.locator('[data-ui-component="completion-create-action"] button').click();
    const create = page.getByRole("dialog");
    await create.getByLabel(/title/i).fill("Browser handover reservation draft");
    await create.getByLabel(/number/i).fill("HO-BROWSER-01");
    await create.getByLabel(/^system$/i).fill("SYS-BROWSER");
    await create.getByLabel(/scope id/i).fill("SYS-BROWSER-SEGMENT-A");
    const choose = async (label: RegExp, ref: Ref) => {
      const select = create.getByLabel(label);
      const option = select.locator("option").filter({ hasText: ref.objectId.slice(0, 8) });
      await expect(option, `${ref.objectType} ${ref.objectId} must be visible as a server reference option`).toHaveCount(1, { timeout: 5000 });
      await select.selectOption(await option.getAttribute("value") || "");
    };
    await choose(/profile/i, fixture.handoverProfileRef);
    await create.getByLabel(/location/i).selectOption(fixture.scope.locationId);
    await choose(/asset/i, fixture.assets[0]);
    await choose(/open issue/i, fixture.issueRef);
    const reservation = create.locator('[data-ui-component="handover-reservation-inputs"]');
    await expect(reservation).toBeVisible();
    await reservation.getByLabel(/reservation owner/i).selectOption(fixture.actors.OWN);
    const reservationDue = new Date(fixture.tomorrow);
    reservationDue.setSeconds(0, 0);
    const reservationDueAt = reservationDue.toISOString();
    await reservation.getByLabel(/due at/i).fill(reservationDueAt.slice(0, 16));
    await reservation.getByLabel(/closure requirement/i).fill("Verify and close the remaining punch issue");
    const created = page.waitForResponse((response) => response.request().method() === "POST" && /\/handover-packages$/.test(response.url()));
    await create.getByRole("button", { name: /save draft/i }).click();
    const response = await created;
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(201);
    const record = body.record;
    expect(record.status).toBe("draft");
    expect(record.data.reservationProposals).toEqual([{
      issueRef: fixture.issueRef,
      ownerPartyId: fixture.actors.OWN,
      dueAt: reservationDueAt,
      closureRequirement: "Verify and close the remaining punch issue",
    }]);
    await expect(workspace.getByRole("button", { name: /Browser handover reservation draft/ })).toBeVisible();
    await workspace.getByRole("button", { name: /Browser handover reservation draft/ }).click();
    await useRole(page, "CON");
    await workspace.getByRole("tab", { name: /handover/i }).click();
    await workspace.getByRole("button", { name: /Browser handover reservation draft/ }).click();
    const handoverItem = latestWorkspace.items.find((candidate: any) => candidate.record.id === record.id);
    expect(handoverItem.record.status).toBe("draft");
    const submit = handoverItem.actions.find((action: any) => action.command === "submit_handover_package");
    expect(submit).toBeTruthy();
    expect(submit.ready).toBe(false);
    await expect(workspace.locator(".completion-commands").getByRole("button", { name: /submit handover package/i })).toBeDisabled();
  } finally {
    child.kill("SIGTERM");
  }
});
