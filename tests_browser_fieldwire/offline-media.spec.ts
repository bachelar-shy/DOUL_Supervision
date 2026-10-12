import { expect, test } from "@playwright/test";

test("오프라인 사진·도면 캐시는 프로젝트·역할별로 분리된다", async ({ page }) => {
  await page.goto("/#/capture");
  const result = await page.evaluate(async () => {
    const mod = await import("/src/data/field-media-cache.ts");
    const first = { projectId: "project-a", partyId: "person-a", roleId: "role-a" };
    const other = { projectId: "project-b", partyId: "person-a", roleId: "role-a" };
    const otherRole = { projectId: "project-a", partyId: "person-a", roleId: "role-b" };
    await mod.clearOfflineMedia(first);
    await mod.clearOfflineMedia(other);
    await mod.cacheOfflineMedia(first, "photo", "photo-001", 1,
      "기둥 철근사진", new Blob(["photo"], { type: "image/jpeg" }));
    const original = await mod.getOfflineMedia(first, "photo", "photo-001", 1);
    const changedProject = await mod.getOfflineMedia(other, "photo", "photo-001", 1);
    const changedRole = await mod.getOfflineMedia(otherRole, "photo", "photo-001", 1);
    const newerVersion = await mod.getOfflineMedia(first, "photo", "photo-001", 2);
    const listed = await mod.listOfflineMedia(first);
    const tampered = await mod.listOfflineMedia(other);
    let rejected = false;
    try {
      await mod.cacheOfflineMedia(first, "photo", "photo-002", 1,
        "비허용 자료", new Blob(["pdf"], { type: "application/pdf" }));
    } catch { rejected = true; }
    await mod.clearOfflineMedia(first);
    const cleared = await mod.listOfflineMedia(first);
    return {
      original: await original?.text(), changedProject, changedRole, newerVersion,
      listed: listed.length, tampered: tampered.length, rejected, cleared: cleared.length,
    };
  });
  expect(result).toEqual({
    original: "photo", changedProject: null, changedRole: null, newerVersion: null,
    listed: 1, tampered: 0, rejected: true, cleared: 0,
  });
});
