import { expect, test } from "@playwright/test";

test("offline photo lookup reads one key without loading all cached originals", async ({ page }) => {
  await page.goto("/#/capture");
  const result = await page.evaluate(async () => {
    const cache = await import("/src/data/field-media-cache.ts");
    const scope = { projectId: "key-test-project", partyId: "key-test-user", roleId: "key-test-role" };
    const otherRole = { ...scope, roleId: "key-test-other-role" };
    await cache.clearOfflineMedia(scope);
    await cache.clearOfflineMedia(otherRole);
    const image = new Blob(["evidence-1"], { type: "image/png" });
    await cache.cacheOfflineMedia(scope, "photo", "evidence-101", 1, "구조 검측", image);
    await cache.cacheOfflineMedia(otherRole, "drawing-preview", "evidence-101", 1, "별도 역할", image);
    const prototype = IDBObjectStore.prototype;
    const originalGetAll = prototype.getAll;
    let fullScans = 0;
    prototype.getAll = function(...args: Parameters<IDBObjectStore["getAll"]>) {
      if (this.name === "media") {
        fullScans++;
        throw new Error("Offline media key lookup scanned the entire cache");
      }
      return originalGetAll.apply(this, args);
    };
    let photo: Blob | null = null;
    let hidden: Blob | null = null;
    let wrongRevision: Blob | null = null;
    try {
      photo = await cache.getOfflineMedia(scope, "photo", "evidence-101", 1);
      hidden = await cache.getOfflineMedia(otherRole, "photo", "evidence-101", 1);
      wrongRevision = await cache.getOfflineMedia(scope, "photo", "evidence-101", 2);
    } finally {
      prototype.getAll = originalGetAll;
    }
    const content = photo ? await photo.text() : null;
    await cache.clearOfflineMedia(scope);
    await cache.clearOfflineMedia(otherRole);
    return { content, hidden: hidden === null, wrongRevision: wrongRevision === null, fullScans };
  });
  expect(result).toEqual({ content: "evidence-1", hidden: true, wrongRevision: true, fullScans: 0 });
});

test("expired drawing previews are never returned as offline originals", async ({ page }) => {
  await page.goto("/#/capture");
  const result = await page.evaluate(async () => {
    const cache = await import("/src/data/field-media-cache.ts");
    const scope = { projectId: "expiry-project", partyId: "expiry-user", roleId: "expiry-role" };
    await cache.clearOfflineMedia(scope);
    await cache.cacheOfflineMedia(scope, "drawing-preview", "sheet-002", 3,
      "A-102 기초 평면도", new Blob(["preview"], { type: "image/png" }));
    const key = [scope.projectId, scope.partyId, scope.roleId, "drawing-preview", "sheet-002", 3].join("|");
    await new Promise<void>((resolve, reject) => {
      const opened = indexedDB.open("doul-field-media-cache-v1", 2);
      opened.onerror = () => reject(opened.error);
      opened.onsuccess = () => {
        const db = opened.result;
        const tx = db.transaction(["media", "metadata"], "readwrite");
        const store = tx.objectStore("media");
        const request = store.get(key);
        request.onsuccess = () => {
          const item = request.result as {storedAt: number} | undefined;
          if (!item) return;
          item.storedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
          store.put(item);
          const metadata = tx.objectStore("metadata");
          const {media: _media, ...info} = item as Record<string, unknown>;
          void _media;
          metadata.put(info);
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    const expired = await cache.getOfflineMedia(scope, "drawing-preview", "sheet-002", 3);
    const listed = await cache.listOfflineMedia(scope);
    await cache.clearOfflineMedia(scope);
    return { expired: expired === null, listed: listed.length };
  });
  expect(result).toEqual({ expired: true, listed: 0 });
});

test("offline list and storage operations never scan media Blob records", async ({ page }) => {
  await page.goto("/#/capture");
  const result = await page.evaluate(async () => {
    const cache = await import("/src/data/field-media-cache.ts");
    const scope = {projectId:"meta-test",partyId:"meta-user",roleId:"meta-role"};
    await cache.clearOfflineMedia(scope);
    const proto = IDBObjectStore.prototype;
    const previous = proto.getAll;
    let scannedMedia = false;
    proto.getAll = function(...args: Parameters<IDBObjectStore["getAll"]>) {
      if (this.name === "media") {scannedMedia = true; throw new Error("Blob scan forbidden");}
      return previous.apply(this,args);
    };
    try {
      await cache.cacheOfflineMedia(scope,"drawing-thumb","sheet-1",1,"지붕 도면",
        new Blob(["thumb"],{type:"image/png"}));
      const rows = await cache.listOfflineMedia(scope);
      const image = await cache.getOfflineMedia(scope,"drawing-thumb","sheet-1",1);
      await cache.clearOfflineMedia(scope);
      return {scannedMedia,count:rows.length,title:rows[0]?.title,
        text:await image?.text(),remaining:(await cache.listOfflineMedia(scope)).length};
    } finally {proto.getAll = previous;}
  });
  expect(result).toEqual({scannedMedia:false,count:1,title:"지붕 도면",text:"thumb",remaining:0});
});
