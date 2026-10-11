import { expect, test, type Page, type Route } from "@playwright/test";
import { existsSync } from "node:fs";

type Language = "vi" | "ko";
type TranslationInput = { text: string; sourceLanguage: Language; targetLanguage: Language };
const requestPattern = /\/api\/projects\/[^/]+\/parallel\/translation\/preview$/;
const hasResizableDocumentTemplate = existsSync("apps/web/src/ui/ResizableWorkspace.tsx");
const panel = (page: Page) => page.locator('[data-ui-component="translation-preview"]');

function makeResult(input: TranslationInput, translated: string) {
  return {
    original: input.text, translated,
    sourceLanguage: input.sourceLanguage, targetLanguage: input.targetLanguage,
    model: "mocked-ci-model", reviewStatus: "automatic_unverified",
    usableForOfficialIssue: false, protectedTokensMatch: true,
    metrics: { totalDurationMs: 100, outputTokens: 20 },
  };
}

test("editing text while the old response is in flight cannot replace the current translation", async ({ page }) => {
  let releaseOld: (() => Promise<void>) | undefined;
  let oldRequestSeen = false;
  await page.route(requestPattern, async (route: Route) => {
    const input = route.request().postDataJSON() as TranslationInput;
    if (input.text === "B-3 first") {
      oldRequestSeen = true;
      await new Promise<void>(resolve => {
        releaseOld = async () => {
          await route.fulfill({ json: makeResult(input, "B-3 OLD RESULT") });
          resolve();
        };
      });
      return;
    }
    await route.fulfill({ json: makeResult(input, "B-3 NEW RESULT") });
  });

  await page.goto("/#/documents");
  const translator = panel(page);
  await expect(translator).toBeVisible();
  const input = translator.locator("textarea");
  await input.fill("B-3 first");
  await translator.locator("button.secondary").click();
  await expect.poll(() => oldRequestSeen).toBe(true);
  await input.fill("B-3 second");
  await expect(translator.locator("button.secondary")).toBeEnabled();
  await translator.locator("button.secondary").click();
  await expect(translator.getByTestId("translation-output")).toHaveText("B-3 NEW RESULT");
  await expect(translator.getByTestId("translation-original")).toHaveText("B-3 second");

  expect(releaseOld).toBeDefined();
  const oldResponse = page.waitForResponse(response =>
    requestPattern.test(response.url()) && response.request().postDataJSON().text === "B-3 first");
  await releaseOld!();
  await oldResponse;
  await expect(translator.getByTestId("translation-output")).toHaveText("B-3 NEW RESULT");
  await expect(translator.getByTestId("translation-original")).toHaveText("B-3 second");
});

test("changing translation direction rejects the prior direction's response", async ({ page }) => {
  let releaseOld: (() => Promise<void>) | undefined;
  let oldRequestSeen = false;
  await page.route(requestPattern, async (route: Route) => {
    const input = route.request().postDataJSON() as TranslationInput;
    if (input.sourceLanguage === "vi") {
      oldRequestSeen = true;
      await new Promise<void>(resolve => {
        releaseOld = async () => {
          await route.fulfill({ json: makeResult(input, "PREVIOUS KO") });
          resolve();
        };
      });
      return;
    }
    await route.fulfill({ json: makeResult(input, "Bản dịch mới B-3") });
  });
  await page.goto("/#/documents");
  const translator = panel(page);
  await translator.locator("textarea").fill("B-3 source");
  await translator.locator("button.secondary").click();
  await expect.poll(() => oldRequestSeen).toBe(true);
  await translator.locator("select").selectOption("ko");
  await translator.locator("textarea").fill("B-3 변경");
  await translator.locator("button.secondary").click();
  await expect(translator.getByTestId("translation-output")).toHaveText("Bản dịch mới B-3");
  await expect(translator.getByTestId("translation-output")).toHaveAttribute("lang", "vi");

  const oldResponse = page.waitForResponse(response =>
    requestPattern.test(response.url()) && response.request().postDataJSON().sourceLanguage === "vi");
  await releaseOld!();
  await oldResponse;
  await expect(translator.getByTestId("translation-output")).toHaveText("Bản dịch mới B-3");
});

test("translation failure preserves original and cannot create an official document", async ({ page }) => {
  await page.route(requestPattern, async route => {
    await route.fulfill({ status: 503, json: { code: "TRANSLATION_SERVICE_UNAVAILABLE" } });
  });
  await page.goto("/#/documents");
  const translator = panel(page);
  await translator.locator("textarea").fill("B-3 original");
  await translator.locator("button.secondary").click();
  await expect(translator.getByRole("alert")).toBeVisible();
  await expect(translator.getByTestId("translation-output")).toHaveCount(0);
  await expect(translator.locator("textarea")).toHaveValue("B-3 original");
});

test("documents retain two panes with translation inside editor across all screen widths", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto("/#/documents");
  const layout = page.locator('[data-ui-template="document"]');
  const translator = panel(page);
  await expect(layout).toBeVisible();
  const editor = layout.locator("form.editor-pane");
  const preview = layout.locator("section.preview-pane");
  await expect(editor).toHaveCount(1);
  await expect(preview).toHaveCount(1);
  await expect(editor.locator('[data-ui-component="translation-preview"]')).toHaveCount(1);
  await expect(layout.locator(':scope > [data-ui-component="translation-preview"]')).toHaveCount(0);
  await expect(translator).toBeVisible();

  const originalField = editor.locator('input[name="urgent.fact"]');
  await expect(originalField).toBeVisible();
  await originalField.fill("PRESERVED DRAFT");
  if (hasResizableDocumentTemplate) {
    await expect(layout).toHaveAttribute("data-ui-component", "resizable-workspace");
    await expect(layout.locator('[data-layout-pane]')).toHaveCount(2);
    await expect(layout.locator('[data-layout-pane="first"] form.editor-pane')).toHaveCount(1);
    await expect(layout.locator('[data-layout-pane="second"] section.preview-pane')).toHaveCount(1);
    const first = layout.locator('[data-layout-pane="first"] > form');
    const second = layout.locator('[data-layout-pane="second"] > section');
    await expect.poll(async () => first.evaluate(el => getComputedStyle(el).overflowY)).toBe("auto");
    await expect.poll(async () => second.evaluate(el => getComputedStyle(el).overflowY)).toBe("auto");
    await layout.locator('[data-layout-action="second"]').click();
    await expect(layout.locator('[data-layout-pane="first"]')).toBeHidden();
    await layout.locator('[data-layout-action="split"]').click();
    await expect(originalField).toHaveValue("PRESERVED DRAFT");
  } else {
    await expect(layout.locator(":scope > form.editor-pane")).toHaveCount(1);
    await expect(layout.locator(":scope > section.preview-pane")).toHaveCount(1);
  }
  for (const width of [768, 390, 1440]) {
    await page.setViewportSize({ width, height: 940 });
    await expect(translator).toBeVisible();
    await expect(originalField).toHaveValue("PRESERVED DRAFT");
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    if (hasResizableDocumentTemplate) {
      await expect(layout.locator('[data-layout-pane]')).toHaveCount(2);
      await expect(layout.locator('[data-layout-pane="first"]')).toBeVisible();
      await expect(layout.locator('[data-layout-pane="second"]')).toBeVisible();
    }
  }
});
