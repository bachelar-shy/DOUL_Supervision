/** One-shot handoff from authorized site-photo evidence to a drawing pin.
 * This token is NOT an authorization grant. The viewer always requests
 * project-scoped sheet/pin data again through its authenticated client.
 */
export const FIELD_DRAWING_FOCUS_EVENT = "doul-field-drawing-focus";
const STORAGE_KEY = "doul-field-drawing-focus-v1";
const MAX_AGE_MS = 120_000;
export type DrawingFocus = { projectId: string; sheetId: string; pinId: string; issuedAt: number };

function allowed(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 200;
}
export function readDrawingFocus(projectId: string): DrawingFocus | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const candidate = data as DrawingFocus;
    if (!allowed(candidate.projectId) || !allowed(candidate.sheetId) ||
        !allowed(candidate.pinId) || candidate.projectId !== projectId ||
        !Number.isSafeInteger(candidate.issuedAt) ||
        candidate.issuedAt > Date.now() + 1000 ||
        Date.now() - candidate.issuedAt > MAX_AGE_MS) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return candidate;
  } catch {
    try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked */ }
    return null;
  }
}
export function consumeDrawingFocus(projectId: string): DrawingFocus | null {
  const current = readDrawingFocus(projectId);
  try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked */ }
  return current;
}
export function requestDrawingFocus(projectId: string, sheetId: string, pinId: string): boolean {
  if (![projectId, sheetId, pinId].every(allowed)) return false;
  try {
    window.sessionStorage.setItem(STORAGE_KEY,
      JSON.stringify({ projectId, sheetId, pinId, issuedAt: Date.now() } satisfies DrawingFocus));
  } catch { return false; }
  if (window.location.hash !== "#/drawings") window.location.hash = "#/drawings";
  window.dispatchEvent(new Event(FIELD_DRAWING_FOCUS_EVENT));
  return true;
}
