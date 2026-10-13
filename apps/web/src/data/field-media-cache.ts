/** User-initiated offline site media cache.
 * Never caches access tokens, API responses, reports or official approvals.
 * Every object is bound to one authenticated project + party + role.
 */
export type OfflineScope = { projectId: string; partyId: string; roleId: string };
export type OfflineMediaKind = "photo" | "drawing-preview" | "drawing-thumb";
export type OfflineMediaItem = {
  key: string; projectId: string; partyId: string; roleId: string;
  kind: OfflineMediaKind; objectId: string; version: number;
  title: string; storedAt: number; bytes: number; media: Blob;
};
const NAME = "doul-field-media-cache-v1";
const TABLE = "media";
const META_TABLE = "metadata";
export type OfflineMediaMetadata = Omit<OfflineMediaItem, "media">;
export const MEDIA_LIMIT_BYTES = 80 * 1024 * 1024;
export const OBJECT_LIMIT_BYTES = 12 * 1024 * 1024;
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
function keyFor(scope: OfflineScope, kind: OfflineMediaKind, objectId: string, version: number) {
  if (!scope.projectId || !scope.partyId || !scope.roleId ||
      !objectId || !Number.isSafeInteger(version) || version < 1) throw new Error("INVALID_CACHE_SCOPE");
  return [scope.projectId, scope.partyId, scope.roleId, kind, objectId, version].join("|");
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TABLE))
        db.createObjectStore(TABLE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(META_TABLE)) {
        const metadata = db.createObjectStore(META_TABLE, { keyPath: "key" });
        // Versionchange is atomic: old offline files remain if migration fails.
        const cursorReq = req.transaction!.objectStore(TABLE).openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const {media: _media, ...info} = cursor.value as OfflineMediaItem;
          void _media;
          metadata.put(info);
          cursor.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("OFFLINE_DATABASE_UNAVAILABLE"));
  });
}
/** Metadata-only scans avoid decoding cached drawings and photos. */
async function readMetadata(): Promise<OfflineMediaMetadata[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_TABLE, "readonly");
    const req = tx.objectStore(META_TABLE).getAll();
    req.onsuccess = () => resolve(req.result as OfflineMediaMetadata[]);
    req.onerror = () => reject(req.error || new Error("OFFLINE_METADATA_READ_FAILED"));
    tx.oncomplete = () => db.close();
    tx.onabort = () => { db.close(); reject(tx.error || new Error("OFFLINE_METADATA_READ_FAILED")); };
  });
}

/** Fetch one scoped item by its primary key.
 * Looking up a drawing must not deserialize the entire (up to 80 MB)
 * offline media library into the phone's JavaScript heap.
 */
async function readByKey(key: string): Promise<OfflineMediaItem | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TABLE, "readonly");
    const request = tx.objectStore(TABLE).get(key);
    let found: OfflineMediaItem | null = null;
    request.onsuccess = () => { found = (request.result as OfflineMediaItem | undefined) ?? null; };
    tx.oncomplete = () => { db.close(); resolve(found); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("OFFLINE_CACHE_READ_FAILED")); };
  });
}
function forScope(item: OfflineMediaItem, scope: OfflineScope) {
  return item.projectId === scope.projectId && item.partyId === scope.partyId && item.roleId === scope.roleId;
}
export async function listOfflineMedia(scope: OfflineScope): Promise<Omit<OfflineMediaItem, "media">[]> {
  const now = Date.now();
  const rows = (await readMetadata()).filter(x => forScope(x, scope) && now - x.storedAt <= EXPIRY_MS);
  return rows.sort((a, b) => b.storedAt - a.storedAt);
}
export async function getOfflineMedia(scope: OfflineScope, kind: OfflineMediaKind,
    objectId: string, version: number): Promise<Blob | null> {
  const key = keyFor(scope, kind, objectId, version);
  const row = await readByKey(key);
  return row && forScope(row, scope) &&
    row.kind === kind && row.objectId === objectId && row.version === version &&
    row.media instanceof Blob && Date.now() - row.storedAt <= EXPIRY_MS
    ? row.media : null;
}
export async function cacheOfflineMedia(scope: OfflineScope, kind: OfflineMediaKind,
    objectId: string, version: number, title: string, media: Blob): Promise<void> {
  const key = keyFor(scope, kind, objectId, version);
  if (!media || media.size < 1 || media.size > OBJECT_LIMIT_BYTES)
    throw new Error("OFFLINE_FILE_TOO_LARGE");
  if (!["image/jpeg", "image/png", "image/webp", "image/heic"].includes(media.type))
    throw new Error("OFFLINE_IMAGE_ONLY");
  const now = Date.now();
  const row: OfflineMediaItem = {key, ...scope, kind, objectId, version,
    title:title.slice(0, 240), storedAt:now, bytes:media.size, media};
  const {media:_media, ...metadata} = row;
  void _media;
  // IndexedDB readwrite transactions serialize competing tabs: quota is
  // checked together with evictions and writes, never in a separate read.
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([TABLE, META_TABLE], "readwrite");
    const content = tx.objectStore(TABLE);
    const index = tx.objectStore(META_TABLE);
    let quotaError: Error | null = null;
    const req = index.getAll();
    req.onsuccess = () => {
      const records = req.result as OfflineMediaMetadata[];
      const occupied = records.reduce((total, item) =>
        total + (item.key === key || now - item.storedAt > EXPIRY_MS ? 0 : item.bytes), media.size);
      if (occupied > MEDIA_LIMIT_BYTES) {
        quotaError = new Error("OFFLINE_CACHE_LIMIT_REACHED");
        tx.abort();
        return;
      }
      for (const item of records) {
        if (now - item.storedAt > EXPIRY_MS) {
          index.delete(item.key);
          content.delete(item.key);
        }
      }
      content.put(row);
      index.put(metadata);
    };
    req.onerror = () => tx.abort();
    tx.oncomplete = () => {db.close(); resolve();};
    tx.onabort = () => {db.close(); reject(quotaError || tx.error || new Error("OFFLINE_CACHE_WRITE_FAILED"));};
  });
}
export async function clearOfflineMedia(scope: OfflineScope): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([TABLE, META_TABLE], "readwrite");
    const content = tx.objectStore(TABLE);
    const index = tx.objectStore(META_TABLE);
    const req = index.getAll();
    req.onsuccess = () => {
      for (const item of req.result as OfflineMediaMetadata[]) {
        if (forScope(item, scope)) {
          content.delete(item.key);
          index.delete(item.key);
        }
      }
    };
    req.onerror = () => tx.abort();
    tx.oncomplete = () => {db.close(); resolve();};
    tx.onabort = () => {db.close(); reject(tx.error || new Error("OFFLINE_CACHE_CLEAR_FAILED"));};
  });
}
