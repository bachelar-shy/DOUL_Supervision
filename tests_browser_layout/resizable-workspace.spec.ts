import { expect, test, type Page } from "@playwright/test";

const workspace = (page: Page, kind: string) =>
  page.locator('[data-ui-component="resizable-workspace"][data-kind="' + kind + '"]');

test("workbench resizing is keyboard accessible and persisted per screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto("/#/inspections");
  const shell = workspace(page, "workbench");
  await expect(shell).toHaveAttribute("data-compact", "false");
  await expect(shell).toHaveAttribute("data-view", "first");
  await shell.locator(".record-row").first().click();
  await expect(shell).toHaveAttribute("data-view", "split");
  const divider = shell.getByRole("separator");
  await expect(divider).toBeVisible();
  const old = Number(await divider.getAttribute("aria-valuenow"));
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Number(await divider.getAttribute("aria-valuenow"))).toBeGreaterThan(old);
  const newRatio = Number(await divider.getAttribute("aria-valuenow"));
  await expect.poll(async () =>
    page.evaluate(() => Number(localStorage.getItem("doul.ui.split.v1.workbench:inspections"))),
  ).toBe(newRatio);

  await page.reload();
  await expect(workspace(page, "workbench").locator('[role="separator"]')).toHaveAttribute("aria-valuenow", String(newRatio));
  await page.goto("/#/actions");
  await expect(workspace(page, "workbench").locator('[role="separator"]')).toHaveAttribute("aria-valuenow", String(old));
  await page.goto("/#/inspections");
  await expect(workspace(page, "workbench").locator('[role="separator"]')).toHaveAttribute("aria-valuenow", String(newRatio));
});

test("pointer resize is bounded and reset returns to the initial ratio", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto("/#/documents");
  const shell = workspace(page, "document");
  await expect(shell).toHaveAttribute("data-compact", "false");
  const separator = shell.getByRole("separator");
  await expect(separator).toBeVisible();
  const box = await separator.boundingBox();
  if (!box) throw new Error("Missing handle");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 140, y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Number(await separator.getAttribute("aria-valuenow"))).toBeGreaterThan(36);
  await separator.focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => {
    const min = Number(await separator.getAttribute("aria-valuemin"));
    const now = Number(await separator.getAttribute("aria-valuenow"));
    return now === min;
  }).toBe(true);
  await shell.locator('[data-layout-action="reset"]').click();
  await expect.poll(async () => Number(await separator.getAttribute("aria-valuenow"))).toBe(36);
});

test("document focus modes preserve in-progress input without API writes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  let writes = 0;
  page.on("request", request => {
    if (request.url().includes("/api/") && request.method() !== "GET") writes += 1;
  });
  await page.goto("/#/documents");
  const shell = workspace(page, "document");
  const field = shell.locator('input[name="urgent.fact"]');
  await expect(field).toBeVisible();
  await field.fill("DRAFT-SURVIVES-LAYOUT");
  await shell.locator('[data-layout-action="second"]').click();
  await expect(shell).toHaveAttribute("data-view", "second");
  await expect(shell.locator('[data-layout-pane="first"]')).toBeHidden();
  await shell.locator('[data-layout-action="split"]').click();
  await expect(field).toHaveValue("DRAFT-SURVIVES-LAYOUT");
  await shell.locator('[data-layout-action="first"]').click();
  await expect(shell.locator('[data-layout-pane="second"]')).toBeHidden();
  await shell.locator('[data-layout-action="split"]').click();
  expect(writes).toBe(0);
});

test("workbench scrolls its two panes independently", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto("/#/inspections");
  const shell = workspace(page, "workbench");
  await expect(shell).toHaveAttribute("data-view", "first");
  await shell.locator(".record-row").first().click();
  await expect(shell).toHaveAttribute("data-view", "split");
  await expect(shell.getByRole("separator")).toBeVisible();
  const panes = shell.locator(".doul-resizable-pane > .panel");
  await expect(panes).toHaveCount(2);
  const data = await panes.evaluateAll(elements => {
    for (const element of elements) {
      const spacer = document.createElement("div");
      spacer.style.height = "1800px";
      spacer.setAttribute("aria-hidden", "true");
      element.appendChild(spacer);
    }
    elements[0].scrollTop = 240;
    return {
      first: elements[0].scrollTop,
      second: elements[1].scrollTop,
      firstOverflow: getComputedStyle(elements[0]).overflowY,
      secondOverflow: getComputedStyle(elements[1]).overflowY,
    };
  });
  expect(data.first).toBeGreaterThan(0);
  expect(data.second).toBe(0);
  expect(data.firstOverflow).toBe("auto");
  expect(data.secondOverflow).toBe("auto");
});

test("390px layout avoids horizontal overflow and keeps mobile selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 940 });
  await page.goto("/#/inspections");
  const shell = workspace(page, "workbench");
  await expect(shell).toHaveAttribute("data-compact", "true");
  await expect(shell).toHaveAttribute("data-view", "first");
  await expect(shell.getByRole("separator")).toBeHidden();
  const items = shell.locator(".record-row");
  if (await items.count()) {
    await items.first().click();
    await expect(shell).toHaveAttribute("data-view", "second");
    await expect(shell.locator('[data-layout-pane="second"]')).toBeVisible();
    await shell.locator('[data-layout-action="first"]').click();
    await expect(shell.locator('[data-layout-pane="first"]')).toBeVisible();
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.goto("/#/documents");
  const docs = workspace(page, "document");
  await expect(docs).toHaveAttribute("data-compact", "true");
  await expect(docs.locator('[data-layout-pane="first"]')).toBeVisible();
  await expect(docs.locator('[data-layout-pane="second"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("dashboard supports focus and registers keep a single scroll region", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto("/#/today");
  const dashboard = workspace(page, "dashboard");
  await expect(dashboard.getByRole("separator")).toBeVisible();
  await dashboard.locator('[data-layout-action="second"]').click();
  await expect(dashboard.locator('[data-layout-pane="first"]')).toBeHidden();
  await dashboard.locator('[data-layout-action="split"]').click();
  await page.goto("/#/registers");
  const table = page.locator(".template-register .table-scroll").first();
  await expect(table).toBeVisible();
  expect(await table.evaluate(node => getComputedStyle(node).overflowY)).toBe("auto");
});


test("Fieldwire list and detail view toggles use compact labeled icons without losing keyboard access", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [route, kind] of [["issues", "workbench"], ["owner", "owner"]] as const) {
      await page.goto("/#/" + route);
      const root = workspace(page, kind);
      const controls = root.locator(".doul-layout-controls");
      const first = controls.locator('[data-layout-action="first"]');
      const split = controls.locator('[data-layout-action="split"]');
      await expect(first).toBeVisible();
      await expect(first).toHaveAttribute("aria-label", /.+/);
      await expect(split).toHaveAttribute("aria-label", /.+/);
      const size = await first.boundingBox();
      expect(size, route + ": list view button has geometry").not.toBeNull();
      expect(size!.height, route + ": touch target").toBeGreaterThanOrEqual(width < 768 ? 44 : 34);
      if (width >= 768) {
        await expect(first.locator("span")).toHaveCSS("display", "none");
        const bar = await controls.boundingBox();
        expect(bar!.height, route + ": compact top controls").toBeLessThanOrEqual(38);
      }
      await split.click();
      await expect(root).toHaveAttribute("data-view", width < 768 ? "first" : "split");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow, route + ": horizontal overflow").toBeLessThanOrEqual(2);
    }
  }
});
