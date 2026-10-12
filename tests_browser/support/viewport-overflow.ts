import { expect, type Page } from "@playwright/test";

// Reports precise offending elements only when an actual viewport check fails.
// Never hides content or relaxes the maximum document-width contract.
export async function expectNoHorizontalOverflow(page: Page, label = "viewport"): Promise<void> {
  try {
    await expect.poll(
      () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      { message: label, timeout: 5_000 },
    ).toBeTruthy();
  } catch (cause) {
    const details = await page.evaluate(() => ({
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      offenders: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter(element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.right > innerWidth + 1
            && style.display !== "none" && style.visibility !== "hidden";
        }).slice(0, 24).map(element => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            id: element.id,
            classes: (element.getAttribute("class") || "").slice(0, 90),
            position: getComputedStyle(element).position,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            text: (element.textContent || "").trim().slice(0, 38),
          };
        }),
    }));
    throw new Error(label + ": document exceeds viewport: " + JSON.stringify(details), { cause });
  }
}
