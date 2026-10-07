import { expect, test } from "@playwright/test";

import { resolveNotificationSourceTarget } from "../apps/web/src/data/notification-target-client";
import type { Workspace } from "../apps/web/src/data/ui-contract";

test("an exact notification source opens its canonical record route without changing the record", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", { name: "알림", exact: true }).click();

  const exactSource = page.locator('.notification-events-list li:has([data-source-target="exact"])').first();
  await expect(exactSource, "the demo API should produce an actor-readable notification whose exact WorkItem version is in the workspace").toBeVisible();
  const target = exactSource.locator('[data-source-target="exact"]');
  const route = await target.getAttribute("data-source-route");
  expect(route).toBeTruthy();
  const title = (await target.locator("strong").innerText()).trim();

  let postCount = 0;
  page.on("request", request => {
    if (request.method() === "POST") postCount += 1;
  });
  await exactSource.getByRole("button", { name: "원본 보기", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`#/${route}$`));
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  expect(postCount).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("a prior-version reference is explicit and never silently resolved to the current version", () => {
  const sourceRef = { objectType: "WorkItem", objectId: "item-1", version: 1 };
  const workspace = {
    project: { id: "project-1" },
    items: [{
      machine: "inspection",
      record: { id: "item-1", projectId: "project-1", version: 2 },
    }],
  } as unknown as Workspace;

  const target = resolveNotificationSourceTarget(sourceRef, "project-1", workspace);
  expect(target).toMatchObject({ kind: "past", route: "inspections", currentItem: { record: { version: 2 } } });
});

test("unknown domain references and machine kinds cannot become guessed navigation targets", () => {
  const workspace = {
    project: { id: "project-1" },
    items: [{
      machine: "unregistered_machine",
      record: { id: "item-1", projectId: "project-1", version: 2 },
    }],
  } as unknown as Workspace;

  expect(resolveNotificationSourceTarget(
    { objectType: "Document", objectId: "item-1", version: 2 },
    "project-1",
    workspace,
  )).toEqual({ kind: "unavailable" });
  expect(resolveNotificationSourceTarget(
    { objectType: "WorkItem", objectId: "item-1", version: 2 },
    "project-1",
    workspace,
  )).toEqual({ kind: "unavailable" });
});
