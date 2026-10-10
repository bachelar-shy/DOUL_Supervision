import { expect, test } from "@playwright/test";

test("opening drawings does not request unused inboxes and opening work inbox requests one page", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => { if (request.method() === "GET") requests.push(request.url()); });
  await page.goto("/#/parallel-test");
  await expect(page.getByLabel("PDF 도면 보기")).toBeVisible();
  await expect(page.getByRole("region", { name: "도면 PDF 연결" })).toBeVisible();
  expect(requests.filter(url => /\/parallel\/(?:work-inbox|notifications)(?:\?|$)/.test(url))).toEqual([]);
  const response = page.waitForResponse(response => response.url().includes("/parallel/work-inbox") && response.ok());
  await page.getByRole("tab", { name: "작업함", exact: true }).click();
  await response;
  await expect(page.locator(".work-inbox-actions [role=status]")).toHaveCount(0, { timeout: 15000 });
  expect(requests.filter(url => url.includes("/parallel/work-inbox"))).toHaveLength(1);
});
