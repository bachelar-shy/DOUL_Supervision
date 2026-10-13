import type { SupervisionClient } from "./supervision-client";

export interface DrawingSheetVersionLink {
  id: string;
  projectId: string;
  version: number;
  fromSheetId: string;
  toSheetId: string;
  drawingNumber: string;
  previousRevision: string;
  newRevision: string;
  note: string;
  createdAt: string;
  createdByRole: string;
  fromPdfHash: string;
  toPdfHash: string;
  classification: "DRAFT_REVISION_LINK_NOT_APPROVED";
}

export interface NewDrawingSheetVersionLink {
  fromSheetId: string;
  toSheetId: string;
  previousRevision: string;
  newRevision: string;
  expectedFromVersion: number;
  expectedToVersion: number;
  note: string;
}

export async function getDrawingSheetVersionLinks(client: SupervisionClient, sheetId: string) {
  return client.request<{items: DrawingSheetVersionLink[]; count: number}>(
    client.path("/drawing-sheet-revisions") + "?sheetId=" + encodeURIComponent(sheetId),
  );
}

export async function addDrawingSheetVersionLink(client: SupervisionClient,
  body: NewDrawingSheetVersionLink, key: string) {
  return client.request<{link: DrawingSheetVersionLink}>(client.path("/drawing-sheet-revisions"), {
    method: "POST",
    headers: {"Idempotency-Key": key},
    body: JSON.stringify(body),
  });
}
