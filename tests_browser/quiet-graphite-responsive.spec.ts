import { expect, test } from "@playwright/test";

const widths = [390, 768, 1024, 1440, 1920] as const;
const routes = ["today", "actions", "registers", "documents", "safety", "parallel-test"] as const;

type BoxProblem = { node: string; left: number; right: number; label: string };

async function visibleControlOverflow(page: import("@playwright/test").Page): Promise<BoxProblem[]> {
  return page.locator("main").evaluate((main) => {
    const defects: BoxProblem[] = [];
    for (const element of main.querySelectorAll<HTMLElement>("button, input:not([type=hidden]), select, textarea, h1")) {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!bounds.width || !bounds.height || style.visibility === "hidden" || style.display === "none") continue;
      let parent = element.parentElement;
      while (parent && parent !== main && !["scroll", "auto"].includes(getComputedStyle(parent).overflowX)) {
        parent = parent.parentElement;
      }
      // A data grid may scroll horizontally inside its own visible viewport.
      if (parent && parent !== main) continue;
      if (bounds.left < -1 || bounds.right > innerWidth + 1) {
        defects.push({
          node: element.tagName,
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
          label: element.getAttribute("aria-label") || element.getAttribute("type") || element.textContent?.trim().slice(0, 48) || "",
        });
      }
    }
    return defects;
  });
}

for (const width of widths) {
  test(`Quiet Graphite core workspaces remain usable at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/#/today");
    await page.locator(".topbar .role-picker select").first().selectOption("ko");

    for (const route of routes) {
      await test.step(`${width}px / ${route}`, async () => {
        await page.goto("/#/" + route);
        if (route === "drawings") {
          await expect(page.locator('[data-ui-component="drawing-sheet-workspace"] .drawing-sheet-commandbar')).toBeVisible();
        } else {
          await expect(page.locator("main .page-heading h1")).toBeVisible();
        }
        await expect.poll(
          () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          { message: `${width}px/${route}: page horizontal overflow` },
        ).toBeTruthy();
        expect(await visibleControlOverflow(page), `${width}px/${route}: controls outside viewport`).toEqual([]);

        if (route === "safety") {
          const disclosure = page.locator('[data-ui-component="safety-create-disclosure"]');
          await expect(disclosure).not.toHaveAttribute("open");
          await disclosure.locator("summary").click();
          const authoring = page.locator('[data-ui-component="safety-authoring-panel"]');
          await expect(authoring).toBeVisible();
          const tabs = page.locator('[data-ui-page="safety"] [role="tab"]');
          const count = await tabs.count();
          for (let index = 0; index < count; index++) {
            await tabs.nth(index).click();
            await expect(authoring).toBeVisible();
            const boxes = await authoring.locator('input:not([type="checkbox"]), select, textarea').evaluateAll((controls) =>
              controls.filter((control) => {
                const bounds = control.getBoundingClientRect();
                return bounds.width && (bounds.left < -1 || bounds.right > innerWidth + 1);
              }).map((control) => ({
                type: control.getAttribute("type") || control.tagName,
                left: Math.round(control.getBoundingClientRect().left),
                right: Math.round(control.getBoundingClientRect().right),
              })),
            );
            expect(boxes, `${width}px/safety tab ${index}: form exceeds viewport`).toEqual([]);
          }
        }
        if (width === 390 && route === "today") {
          const more = page.locator(".bottom-nav button").last();
          await expect(more).toBeVisible();
          const box = await more.boundingBox();
          expect(box?.height).toBeGreaterThanOrEqual(44);
          expect(box?.width).toBeGreaterThanOrEqual(44);
        }
        if (["today", "registers", "documents", "safety", "parallel-test"].includes(route)) {
          await page.screenshot({
            path: testInfo.outputPath(`pr144-${width}-${route}.png`),
            fullPage: false,
            animations: "disabled",
          });
        }
      });
    }

    await test.step(`${width}px / long heading and reduced motion`, async () => {
      await page.goto("/#/actions");
      await expect(page.locator("main h1")).toBeVisible();
      await page.locator("main h1").evaluate((heading) => {
        heading.textContent = "감리 현장 검토 및 시정조치 사항 최종 검증 보고서 ".repeat(5);
      });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
      await page.emulateMedia({ reducedMotion: "reduce" });
      const duration = await page.locator(".sidebar nav button").first().evaluate(
        (button) => getComputedStyle(button).transitionDuration,
      );
      expect(duration, "Reduce motion must remove sidebar transition").toBe("0s");
    });
  });
}
