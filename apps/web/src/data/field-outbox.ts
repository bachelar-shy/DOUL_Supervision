import type { Fields, WorkItem } from "./ui-contract";

export type FieldOutboxStatus = "pending" | "conflict" | "retry";
export type FieldOutboxItem = {
  id: string; projectId: string; partyId: string; roleId: string;
  machine: string; itemId: string; command: string; requestKey: string;
  expectedVersion: number; title: string; payload: Fields;
  evidenceIds: string[]; savedAt: string; status: FieldOutboxStatus; error?: string;
};

const DB_NAME = "doul-field-outbox-v1";
const TABLE = "intents";
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TABLE)) db.createObjectStore(TABLE, { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function transaction<T>(kind: IDBTransactionMode, callback: (table: IDBObjectStore,
  done: (result: T) => void) => void): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(TABLE, kind);
    const table = tx.objectStore(TABLE);
    let value: T;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    tx.oncomplete = () => { db.close(); resolve(value); };
    callback(table, result => { value = result; });
  });
}
export async function queueFieldCommand(identity: { projectId: string; partyId: string; roleId: string },
  item: WorkItem, command: string, payload: Fields, evidenceIds: string[]): Promise<FieldOutboxItem> {
  if (!identity.partyId || !identity.roleId || !identity.projectId || !Number.isInteger(item.record.version))
    throw new Error("OFFLINE_IDENTITY_REQUIRED");
  if (evidenceIds.some(id => typeof id !== "string")) throw new Error("EVIDENCE_INVALID");
  const queued: FieldOutboxItem = {
    ...identity, id: crypto.randomUUID(), machine: item.machine, itemId: item.record.id,
    title: item.record.title || String(item.record.workName ?? item.record.id), command,
    expectedVersion: item.record.version, requestKey: crypto.randomUUID(),
    payload: structuredClone(payload), evidenceIds: [...evidenceIds],
    savedAt: new Date().toISOString(), status: "pending",
  };
  await transaction<void>("readwrite", (store, done) => { store.put(queued); done(); });
  return queued;
}
export async function listFieldCommands(identity: { projectId: string; partyId: string; roleId: string }) {
  return transaction<FieldOutboxItem[]>("readonly", (store, done) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const rows = request.result as FieldOutboxItem[];
      done(rows.filter(row => row.projectId === identity.projectId && row.partyId === identity.partyId
        && row.roleId === identity.roleId).sort((a, b) => a.savedAt.localeCompare(b.savedAt)));
    };
    request.onerror = () => { throw request.error; };
  });
}
export async function updateFieldCommand(item: FieldOutboxItem): Promise<void> {
  await transaction<void>("readwrite", (store, done) => { store.put(item); done(); });
}
export async function removeFieldCommand(id: string): Promise<void> {
  await transaction<void>("readwrite", (store, done) => { store.delete(id); done(); });
}
