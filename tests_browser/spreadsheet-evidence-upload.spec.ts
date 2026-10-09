import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const fixture = Buffer.from("UEsDBBQAAAAIAAuKSV2U7PTVoAAAANQAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbF2PwQ6CMBBEf4X0augSDx4McPGuHvyBtV2ggXabdkX8ewFvniaTybzJ1I9PpFwsfgq5UYNIPANkM5DHrDlSWJOOk0dZbeohohmxJzhW1QkMB6EgpWwM1da3mVJyloo7Jrmip0bBMsGb0/hkHvXKUsXlV9p2G4UxTs6gOA4wB/u3WHLXOUOWzcuvFZ1jIrR5IBI/6V21RxcOGxjaGvYz7RdQSwMEFAAAAAgAC4pJXYLZHNUSAAAAEAAAAAsAAABfcmVscy8ucmVsc7MJSs1JLMnMzyvOyCwo1rcDAFBLAwQUAAAACAALikldzp6YEw0AAAALAAAADwAAAHhsL3dvcmtib29rLnhtbLMpzy/KTsrPz9a3AwBQSwMEFAAAAAgAC4pJXR6vXyoOAAAADAAAABgAAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWyzKc8vyi7OSE0t0bcDAFBLAQIUAxQAAAAIAAuKSV2U7PTVoAAAANQAAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAgAC4pJXYLZHNUSAAAAEAAAAAsAAAAAAAAAAAAAAIAB0QAAAF9yZWxzLy5yZWxzUEsBAhQDFAAAAAgAC4pJXc6emBMNAAAACwAAAA8AAAAAAAAAAAAAAIABDAEAAHhsL3dvcmtib29rLnhtbFBLAQIUAxQAAAAIAAuKSV0er18qDgAAAAwAAAAYAAAAAAAAAAAAAACAAUYBAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxQSwUGAAAAAAQABAD9AAAAigEAAAAA", "base64");
const paths: string[] = JSON.parse(process.env.DOUL_FIELD_FILE_PATHS ?? "[]");
for (const locale of ["ko", "vi", "en"]) {
  test(`original workbook upload and exact download in ${locale}`, async ({ page }) => {
    await page.addInitScript((language) => localStorage.setItem("doul.locale", language), locale);
    await page.goto("/#/parallel-test");
    await page.getByRole("tab").filter({ hasText: /증빙 격리|Evidence quarantine|Kiểm thử cách ly bằng chứng/ }).click();
    await expect(page.locator("#official-evidence-file")).toBeVisible();
    const files = paths.length ? paths.map(path => ({ name: basename(path), buffer: readFileSync(path), mimeType: path.endsWith(".pdf") ? "application/pdf" : mime })) : [{name: "field-boq.xlsx", buffer: fixture, mimeType: mime}];
    for (const file of files) {
      const completed = page.waitForResponse(response => response.url().includes("/uploads/") && response.url().endsWith("/complete") && response.request().method() === "POST");
      await page.locator("#official-evidence-file").setInputFiles(file);
      const response = await completed;
      expect(response.status(), await response.text()).toBe(201);
      const record = await response.json();
      const digest = createHash("sha256").update(file.buffer).digest("hex");
      expect(record.fileHash).toBe(digest);
      await expect(page.locator('section[aria-labelledby="evidence-registration-title"] [role=status]').filter({hasText:digest})).toBeVisible();
      const requestHeaders = response.request().headers();
      const downloaded = await page.request.get(`/api/projects/${record.projectId}/evidence/${record.id}/content`, { headers: { Authorization: requestHeaders.authorization, "X-RoleAssignment-Id": (response.request().postDataJSON() as {roleAssignmentId: string}).roleAssignmentId } });
      expect(downloaded.status()).toBe(200);
      expect(createHash("sha256").update(await downloaded.body()).digest("hex")).toBe(digest);
    }
  });
}

test("renamed non-workbook ZIP is refused by the server", async ({page}) => {
  await page.goto("/#/parallel-test");
  await page.getByRole("tab", {name: "증빙 격리 테스트", exact: true}).click();
  const completed = page.waitForResponse(response => response.url().endsWith("/complete") && response.request().method() === "POST");
  await page.locator("#official-evidence-file").setInputFiles({name:"fake.xlsx",mimeType:mime,buffer:Buffer.from("PK\x03\x04not a workbook")});
  const response = await completed;
  expect(response.status()).toBe(415);
  expect((await response.json()).code).toBe("MIME_INVALID");
});
