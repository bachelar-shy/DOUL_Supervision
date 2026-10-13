import type { DomainRef } from "./ui-contract";
import type { SupervisionClient } from "./supervision-client";

export interface DrawingSet {
  id: string; projectId: string; fileName: string; folder: string;
  pageCount: number; completedPages: number; status: "processing" | "ready" | "failed";
  error?: string; createdAt: string; updatedAt: string;
}
export interface DrawingSheet {
  id: string; projectId: string; setId: string; pageNo: number;
  version: number; number: string; title: string; folder: string;
  revision: string; status: "processing" | "ready" | "failed";
  createdAt: string; updatedAt: string;
  hasPreview: boolean; hasThumb: boolean; drawingRef: DomainRef | null; bindingId: string | null;
  extractedNumber?: string | null; extractedTitle?: string | null;
  metadataSource?: string; metadataNeedsReview?: boolean;
  metadataReview?: { status: "verified" | "needs_review"; reviewedAt: string;
    reviewedByRole: string; sourcePdfHash: string; note: string };

}
export interface DrawingSheetPin {
  id: string; sheetId: string; projectId: string; kind: "issue" | "inspection" | "site";
  x: number; y: number; comment: string; status: "draft" | "linked";
  recordRef: DomainRef | null; createdAt: string; createdByRole: string;
}
export type DrawingPinKind = DrawingSheetPin["kind"];
export interface NewDrawingPin {
  x: number; y: number; kind: DrawingPinKind; comment: string; recordRef: DomainRef | null;
}

export const drawingPinLabels: Record<DrawingPinKind, string> = {
  issue: "지적·이슈", inspection: "검측", site: "현장상황",
};

export function drawingSheetPath(client: SupervisionClient, sheetId?: string): string {
  return client.path("/drawing-sheets" + (sheetId ? "/" + encodeURIComponent(sheetId) : ""));
}
export async function loadDrawingSheets(client: SupervisionClient) {
  return client.request<{ items: DrawingSheet[]; count: number }>(drawingSheetPath(client));
}
export async function loadDrawingSets(client: SupervisionClient) {
  return client.request<{ items: DrawingSet[] }>(client.path("/drawing-sets"));
}
export async function uploadDrawingSet(client: SupervisionClient, file: File, key: string) {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))
    throw new Error("PDF만 업로드할 수 있습니다.");
  if (file.size > 20 * 1024 * 1024) throw new Error("파일 크기는 20MB 이하여야 합니다.");
  return client.request<{ set: DrawingSet }>(
    client.path("/drawing-sets") + "?filename=" + encodeURIComponent(file.name),
    { method: "POST", headers: { "Content-Type": "application/pdf", "Idempotency-Key": key }, body: file },
  );
}
export async function updateDrawingSheet(client: SupervisionClient, sheet: DrawingSheet,
                                         number: string, title: string) {
  return client.request<{ sheet: DrawingSheet }>(
    drawingSheetPath(client, sheet.id),
    { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ expectedVersion: sheet.version, number, title }) },
  );
}
export async function loadSheetPins(client: SupervisionClient, sheetId: string) {
  return client.request<{ items: DrawingSheetPin[]; count: number }>(drawingSheetPath(client, sheetId) + "/pins");
}
export async function createSheetPin(client: SupervisionClient, sheetId: string, body: NewDrawingPin, key: string) {
  return client.request<{ pin: DrawingSheetPin }>(drawingSheetPath(client, sheetId) + "/pins",
    { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body) });
}

/** Source titleblock verification is separate from drawing release or site approval. */
export function reviewDrawingSheetMetadata(client: SupervisionClient, sheetId: string,
  payload: {expectedVersion: number; decision: "verified" | "needs_review";
    number: string; title: string; note: string}, key: string) {
  return client.request<{sheet: DrawingSheet}>(
    drawingSheetPath(client, sheetId) + "/metadata-review",
    { method: "POST", headers: {"Idempotency-Key": key}, body: JSON.stringify(payload) },
  );
}

export type DrawingMarkupKind = "pen" | "line" | "arrow" | "rectangle" | "ellipse" |
  "cloud" | "text" | "measure";

export interface DrawingSheetMarkup {
  id: string; version: number; projectId: string; sheetId: string; sheetVersion: number;
  tool: DrawingMarkupKind; points: Array<{x:number; y:number}>;
  color: string; lineWidth: number; text: string; status: "active" | "archived";
  createdAt: string; updatedAt: string; createdByPartyId: string; createdByRole: string;
}
export type NewSheetMarkup = Pick<DrawingSheetMarkup,
  "sheetVersion" | "tool" | "points" | "color" | "lineWidth" | "text">;

export function loadSheetMarkups(client: SupervisionClient, sheetId: string) {
  return client.request<{items: DrawingSheetMarkup[]; count: number}>(
    drawingSheetPath(client, sheetId) + "/markups");
}
export function createSheetMarkup(client: SupervisionClient, sheetId: string,
  payload: NewSheetMarkup, key: string) {
  return client.request<{markup: DrawingSheetMarkup}>(
    drawingSheetPath(client, sheetId) + "/markups",
    {method: "POST", headers: {"Idempotency-Key": key}, body: JSON.stringify(payload)});
}
export function changeSheetMarkup(client: SupervisionClient, sheetId: string,
  id: string, action: "archive" | "restore", version: number, key: string) {
  return client.request<{markup: DrawingSheetMarkup}>(
    drawingSheetPath(client, sheetId) + "/markups/" + encodeURIComponent(id) + "/" + action,
    {method: "POST", headers: {"Idempotency-Key": key},
      body: JSON.stringify({expectedVersion: version})});
}
