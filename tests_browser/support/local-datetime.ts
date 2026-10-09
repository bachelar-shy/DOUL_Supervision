import type { Page } from "@playwright/test";

// datetime-local has no zone. Convert in the browser, whose timezone can differ
// from the Node runner, while keeping the intended instant at minute precision.
export async function localDateTime(page: Page, instant: string | number): Promise<string> {
  return page.evaluate((value) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error("Invalid datetime test instant");
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }, instant);
}
