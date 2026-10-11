import { expect, test } from "@playwright/test";
import { commands } from "../apps/web/src/labels";

test("field command dialog traps Tab, closes on Esc, and restores focus", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  const workspaceResponse = page.waitForResponse(response => response.url().endsWith("/workspace") && response.status() === 200);
  await page.goto("/#/today");
  const response = await workspaceResponse;
  const workspace = await response.json() as { items: Array<{ machine: string; record: { status: string; title?: string; workName?: string } }> };
  const item = workspace.items.find(value => value.machine === "inspection" && value.record.status === "scheduled");
  expect(item, "Demo project needs a scheduled inspection").toBeTruthy();
  const name = item!.record.title ?? item!.record.workName ?? "";
  expect(name).not.toBe("");
  await page.goto("/#/inspections");
  const title = new RegExp(name.replace(/[.*+?^$()|[\]\\]/g, "\\$&"));
  await page.getByRole("button", { name: title }).first().click();
  const trigger = page.getByRole("button", { name: commands.start, exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "확인 후 실행", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "대화상자 닫기" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(failures).toEqual([]);
});
