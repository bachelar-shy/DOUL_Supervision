import { expect, test } from "@playwright/test";

test("workbench uses a full-width list until a record opens in the right context pane", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/inspections");
  const workspace = page.locator('[data-ui-component="resizable-workspace"][data-kind="workbench"]');
  await expect(workspace).toHaveAttribute("data-view", "first");
  await expect(workspace.locator('[data-layout-pane="first"]')).toBeVisible();
  await expect(workspace.locator('[data-layout-pane="second"]')).toBeHidden();
  const listBody = await workspace.locator(".doul-resizable-body").boundingBox();
  const fullList = await workspace.locator('[data-layout-pane="first"]').boundingBox();
  if (!listBody || !fullList) throw new Error("List-only workspace not rendered");
  expect(Math.abs(fullList.x - listBody.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(fullList.width - listBody.width)).toBeLessThanOrEqual(2);

  const record = workspace.locator(".record-row").first();
  await expect(record).toBeVisible();
  await expect(record).toHaveAttribute("aria-pressed", "false");
  await record.click();

  await expect(workspace).toHaveAttribute("data-view", "split");
  await expect(record).toHaveAttribute("aria-pressed", "true");
  await expect(workspace.locator('[data-layout-pane="second"]')).toBeVisible();
  const first = await workspace.locator('[data-layout-pane="first"]').boundingBox();
  const second = await workspace.locator('[data-layout-pane="second"]').boundingBox();
  if (!first || !second) throw new Error("Missing contextual panes");
  expect(first.width / (first.width + second.width)).toBeGreaterThan(0.61);
  expect(Math.abs(second.x - first.x - first.width)).toBeLessThanOrEqual(20);

  // Both panes must remain mounted; closing the detail restores the list
  // without navigating away or losing its scroll position.
  const listPane = workspace.locator(".list-pane");
  await listPane.evaluate(element => {
    const spacer = document.createElement("div");
    spacer.style.height = "1600px";
    spacer.setAttribute("aria-hidden", "true");
    element.appendChild(spacer);
    element.scrollTop = 120;
  });
  const previousScroll = await listPane.evaluate(element => element.scrollTop);
  expect(previousScroll).toBeGreaterThan(0);
  await workspace.locator('[data-ui-component="workbench-detail-close"]').click();
  await expect(workspace).toHaveAttribute("data-view", "first");
  await expect(workspace.locator('[data-layout-pane="second"]')).toBeHidden();
  await expect(record).toHaveAttribute("aria-pressed", "false");
  expect(await listPane.evaluate(element => element.scrollTop)).toBe(previousScroll);
  await expect(page).toHaveURL(/#\/inspections$/);
});

test("issues, actions and owner reports use the same contextual list entry", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const route of ["issues", "actions", "owner"]) {
    await page.goto("/#/" + route);
    const workspace = page.locator('[data-ui-component="resizable-workspace"]');
    await expect(workspace).toHaveAttribute("data-view", "first");
    const row = workspace.locator(".record-row").first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(workspace).toHaveAttribute("data-view", "split");
    await workspace.locator('[data-ui-component="workbench-detail-close"]').click();
    await expect(workspace).toHaveAttribute("data-view", "first");
  }
});

test("phone switches from list to detail with a usable return control", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/inspections");
  const workspace = page.locator('[data-ui-component="resizable-workspace"][data-kind="workbench"]');
  await expect(workspace).toHaveAttribute("data-view", "first");
  await workspace.locator(".record-row").first().click();
  await expect(workspace).toHaveAttribute("data-view", "second");
  await workspace.locator(".mobile-back").click();
  await expect(workspace).toHaveAttribute("data-view", "first");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
});
