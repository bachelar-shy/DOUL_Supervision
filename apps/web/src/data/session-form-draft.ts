import { useEffect, useState } from "react";

const PREFIX = "doul:session-form-draft:v1:";
const MAX_DRAFT_CHARS = 100_000;
const MAX_DRAFT_AGE_MS = 24 * 60 * 60 * 1000;

export interface DraftIdentity {
  projectId: string;
  partyId: string;
  roleId: string;
}

export function sessionFormDraftKey(kind: string, identity: DraftIdentity): string {
  return PREFIX + [kind, identity.projectId, identity.partyId, identity.roleId]
    .map(value => encodeURIComponent(value)).join(":");
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readSessionFormDraft<T>(key: string, now = Date.now()): T | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as { schema: number; savedAt: number; payload: T };
    if (value.schema !== 1 || !Number.isFinite(value.savedAt) ||
        value.savedAt > now + 60000 || now - value.savedAt > MAX_DRAFT_AGE_MS ||
        !value.payload || typeof value.payload !== "object") {
      storage()?.removeItem(key);
      return null;
    }
    return value.payload;
  } catch {
    return null;
  }
}

export function saveSessionFormDraft<T>(key: string, payload: T): boolean {
  try {
    const raw = JSON.stringify({ schema: 1, savedAt: Date.now(), payload });
    if (raw.length > MAX_DRAFT_CHARS) return false;
    const target = storage();
    if (!target) return false;
    target.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

export function clearSessionFormDraft(key: string) {
  try { storage()?.removeItem(key); } catch { /* Storage denied. */ }
}

/** On explicit logout, discard temporary form drafts on this tab.
 * Authentication expiry is not a logout and intentionally does not call this.
 */
export function clearAllSessionFormDrafts() {
  const target = storage();
  if (!target) return;
  try {
    for (let index = target.length - 1; index >= 0; index--) {
      const key = target.key(index);
      if (key?.startsWith(PREFIX)) target.removeItem(key);
    }
  } catch { /* Best effort only, no server-side state changed. */ }
}

export function useSessionFormDraft<T extends Record<string, unknown>>(
  kind: string, identity: DraftIdentity, empty: T,
) {
  const key = sessionFormDraftKey(kind, identity);
  const [entry, setEntry] = useState(() => {
    const stored = readSessionFormDraft<T>(key);
    return { key, value: stored ?? empty, restored: stored !== null };
  });
  const active = entry.key === key;
  const value = active ? entry.value : empty;

  useEffect(() => {
    if (entry.key !== key) {
      const saved = readSessionFormDraft<T>(key);
      setEntry({ key, value: saved ?? empty, restored: saved !== null });
    }
  }, [key, entry.key, empty]);

  useEffect(() => {
    if (!active) return;
    if (JSON.stringify(entry.value) === JSON.stringify(empty)) {
      clearSessionFormDraft(key);
    } else {
      saveSessionFormDraft(key, entry.value);
    }
  }, [key, active, entry.value, empty]);

  const change = (patch: Partial<T>) => {
    setEntry(previous => {
      const basis = previous.key === key ? previous.value : readSessionFormDraft<T>(key) ?? empty;
      return { key, value: { ...basis, ...patch }, restored: false };
    });
  };
  const discard = () => {
    clearSessionFormDraft(key);
    setEntry({ key, value: empty, restored: false });
  };
  return { value, change, discard, restored: active && entry.restored };
}
