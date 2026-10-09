import type { Fields, RecordDTO, WorkItem } from "./ui-contract";

export interface OfflineCommandIntent {
  projectId: string;
  actorId: string;
  roleId: string;
  machine: string;
  itemId: string;
  command: string;
  expectedVersion: number;
  record: Pick<RecordDTO, "id" | "version" | "title" | "status">;
  payload: Fields;
  evidenceIds: string[];
  requestKey: string;
  savedAt: string;
}

export function offlineCommandIntentKey(projectId: string, actorId: string, roleId: string) {
  return `doul:offline-command:${projectId}:${actorId}:${roleId}`;
}

export function readOfflineCommandIntent(key: string): OfflineCommandIntent | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null") as OfflineCommandIntent | null;
    return value?.itemId && value.command && Number.isInteger(value.expectedVersion) && value.payload && value.requestKey ? value : null;
  } catch {
    return null;
  }
}

export function saveOfflineCommandIntent(key: string, item: WorkItem, command: string, payload: Fields, evidenceIds: string[], actorId: string, roleId: string, projectId: string): OfflineCommandIntent {
  const intent: OfflineCommandIntent = {
    projectId, actorId, roleId, machine: item.machine, itemId: item.record.id, command,
    expectedVersion: item.record.version,
    record: { id: item.record.id, version: item.record.version, title: item.record.title, status: item.record.status },
    payload: structuredClone(payload), evidenceIds: [...evidenceIds], requestKey: crypto.randomUUID(), savedAt: new Date().toISOString(),
  };
  localStorage.setItem(key, JSON.stringify(intent));
  return intent;
}

export function clearOfflineCommandIntent(key: string) {
  localStorage.removeItem(key);
}

export function rebaseOfflineCommandIntent(key: string, intent: OfflineCommandIntent, item: WorkItem, actorId: string, roleId: string, projectId: string): OfflineCommandIntent {
  const next: OfflineCommandIntent = {
    ...intent, projectId, actorId, roleId, machine: item.machine, itemId: item.record.id,
    expectedVersion: item.record.version,
    record: { id: item.record.id, version: item.record.version, title: item.record.title, status: item.record.status },
    requestKey: crypto.randomUUID(), savedAt: new Date().toISOString(),
  };
  localStorage.setItem(key, JSON.stringify(next));
  return next;
}
