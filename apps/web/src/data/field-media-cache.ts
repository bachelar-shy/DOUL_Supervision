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
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(TABLE))
        req.result.createObjectStore(TABLE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("OFFLINE_DATABASE_UNAVAILABLE"));
  });
}
async function readAll(): Promise<OfflineMediaItem[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TABLE, "readonly");
    const req = tx.objectStore(TABLE).getAll();
    req.onsuccess = () => resolve(req.result as OfflineMediaItem[]);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => { db.close(); reject(tx.error); };
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
async function writeTransaction(write: (store: IDBObjectStore) => void): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TABLE, "readwrite");
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    write(tx.objectStore(TABLE));
  });
}
function forScope(item: OfflineMediaItem, scope: OfflineScope) {
  return item.projectId === scope.projectId && item.partyId === scope.partyId && item.roleId === scope.roleId;
}
export async function listOfflineMedia(scope: OfflineScope): Promise<Omit<OfflineMediaItem, "media">[]> {
  const now = Date.now();
  const rows = (await readAll()).filter(x => forScope(x, scope) && now - x.storedAt <= EXPIRY_MS);
  return rows.map(({ media: _media, ...info }) => { void _media; return info; })
    .sort((a, b) => b.storedAt - a.storedAt);
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
  const records = await readAll();
  const stale = records.filter(x => now - x.storedAt > EXPIRY_MS);
  const current = records.filter(x => now - x.storedAt <= EXPIRY_MS && x.key !== key);
  const size = current.reduce((total, x) => total + x.bytes, media.size);
  if (size > MEDIA_LIMIT_BYTES) throw new Error("OFFLINE_CACHE_LIMIT_REACHED");
  const row: OfflineMediaItem = { key, ...scope, kind, objectId, version,
    title: title.slice(0, 240), storedAt: now, bytes: media.size, media };
  await writeTransaction(store => {
    stale.forEach(x => store.delete(x.key));
    store.put(row);
  });
}
export async function clearOfflineMedia(scope: OfflineScope): Promise<void> {
  const rows = await readAll();
  await writeTransaction(store => {
    rows.filter(x => forScope(x, scope)).forEach(x => store.delete(x.key));
  });
}
