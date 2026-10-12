import { expect, test } from "@playwright/test";

test("contractor self-inspection input survives reload in the same tab and stays scoped by role", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/#/today");
  const picker = page.locator("header.topbar .role-picker select").last();
  await picker.selectOption("CON");
  await page.goto("/#/inspections");
  await page.locator('[data-ui-component="new-inspection-entry"] button').click();
  const editor = page.getByRole("form", { name: "자체검측 작성" });
  await expect(editor).toBeVisible();
  await editor.getByRole("textbox", { name: "공종·작업명" }).fill("A구역 철근 검측");
  await editor.getByRole("checkbox", { name: "자체검측 완료" }).check();

  await page.reload();
  await page.locator("header.topbar .role-picker select").last().selectOption("CON");
  await page.goto("/#/inspections");
  await page.locator('[data-ui-component="new-inspection-entry"] button').click();
  const reopened = page.getByRole("form", { name: "자체검측 작성" });
  await expect(reopened.getByRole("textbox", { name: "공종·작업명" })).toHaveValue("A구역 철근 검측");
  await expect(reopened.getByRole("checkbox", { name: "자체검측 완료" })).toBeChecked();
  await expect(reopened.getByRole("status")).toContainText("이전 작성 내용을 복원했습니다");

  await reopened.getByRole("button", { name: "임시 작성 내용 삭제" }).click();
  await expect(reopened.getByRole("textbox", { name: "공종·작업명" })).toHaveValue("");
  await page.reload();
  await page.locator("header.topbar .role-picker select").last().selectOption("CON");
  await page.goto("/#/inspections");
  await page.locator('[data-ui-component="new-inspection-entry"] button').click();
  await expect(page.getByRole("textbox", { name: "공종·작업명" })).toHaveValue("");
  expect(errors).toEqual([]);
});

test("phone metadata is legible and action controls keep touch-size minimum", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/inspections");
  const label = page.locator(".record-summary > div > small").first();
  await expect(label).toBeVisible();
  const size = await label.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  expect(size).toBeGreaterThanOrEqual(12);
  const navButton = page.locator(".bottom-nav button").first();
  await expect(navButton).toBeVisible();
  const metrics = await navButton.evaluate(element => ({
    size: parseFloat(getComputedStyle(element).fontSize),
    height: element.getBoundingClientRect().height,
  }));
  expect(metrics.size).toBeGreaterThanOrEqual(12);
  expect(metrics.height).toBeGreaterThanOrEqual(44);
});
