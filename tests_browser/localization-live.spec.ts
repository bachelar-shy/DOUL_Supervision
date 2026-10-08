import { expect, test, type Page } from "@playwright/test";

type Role = "CON" | "OWN" | "SUP";
type WorkspaceItem = {
  record: { id: string; status?: string; version: number };
  actions: { command: string; ready: boolean }[];
};
type WorkspaceResponse = {
  role: { actorGroup: string };
  items: WorkspaceItem[];
};

const roleRoute: Record<Role, string> = {
  CON: "inspections",
  OWN: "issues",
  SUP: "inspections",
};

async function visibleCommandIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-ui-component="action-gate"] [data-command-id]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-command-id") || "").sort(),
    );
}

for (const width of [390, 768, 1440]) {
  test(`Real API authority/state invariants survive locale changes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/#/today");
    await expect(page.getByRole("combobox", { name: "개발 역할 선택" })).toBeVisible();

    const rolePicker = page.locator(".topbar .role-picker select").nth(1);
    const languagePicker = page.locator(".topbar .role-picker select").first();
    const projectMutations: string[] = [];
    page.on("request", (request) => {
      if (
        request.url().includes("/api/projects/") &&
        !["GET", "HEAD", "OPTIONS"].includes(request.method())
      ) {
        projectMutations.push(`${request.method()} ${request.url()}`);
      }
    });

    // Role switches are genuine /dev/sessions + authorized /workspace reads.
    for (const role of ["CON", "OWN", "SUP"] as const) {
      await languagePicker.selectOption("ko");
      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith("/workspace") && response.ok(),
      );
      await rolePicker.selectOption(role);
      const body = (await (await responsePromise).json()) as WorkspaceResponse;
      expect(body.role.actorGroup).toBe(role);
      await expect(rolePicker).toHaveValue(role);

      const route = roleRoute[role];
      await page.evaluate((target) => {
        window.location.hash = `#/${target}`;
      }, route);
      const list = page.locator(`[data-ui-page="${route}"] .record-list`);
      const selectedRow = list.locator(".record-row").first();
      await expect(selectedRow).toBeVisible();
      const recordId = await selectedRow.getAttribute("data-record-id");
      const current = body.items.find((item) => item.record.id === recordId);
      expect(current, "rendered record must originate in the authorized workspace").toBeDefined();
      await selectedRow.click();

      const expectedCommands = (current?.actions || [])
        .map((action) => action.command)
        .sort();
      const actionIds = await visibleCommandIds(page);
      expect(actionIds).toEqual(expectedCommands);
      const expectedStatus = current?.record.status || "";
      const expectedVersion = String(current?.record.version);
      const expectedId = current?.record.id || "";

      for (const [lang, bcp47] of [
        ["ko", "ko-KR"],
        ["vi", "vi-VN"],
        ["en", "en-US"],
      ] as const) {
        await languagePicker.selectOption(lang);
        await expect(page.locator("html")).toHaveAttribute("lang", bcp47);
        await expect(rolePicker).toHaveValue(role);
        await expect(list.locator(".record-row").first()).toHaveAttribute(
          "data-record-id",
          expectedId,
        );
        await expect(list.locator(".record-row").first()).toHaveAttribute(
          "data-record-status",
          expectedStatus,
        );
        await expect(list.locator(".record-row").first()).toHaveAttribute(
          "data-record-version",
          expectedVersion,
        );
        expect(await visibleCommandIds(page)).toEqual(expectedCommands);
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
          )
          .toBeTruthy();
      }
      expect(projectMutations, "locale switch must never execute business commands").toEqual([]);
    }
  });
}
