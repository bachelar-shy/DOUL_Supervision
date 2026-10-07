import type { DomainRef } from "./ui-contract";
import type { SupervisionClient } from "./supervision-client";

export interface DrawingPdfBinding {
  id: string;
  projectId: string;
  drawingRef: DomainRef;
  evidenceRef: DomainRef;
  fileHash: string;
  createdAt: string;
  createdBy: string;
}

export interface PdfDrawingAnchor {
  drawingRef: DomainRef;
  page: number;
  x: number;
  y: number;
  coordinateSystem: "pdf_points";
  [key: string]: unknown;
}

export interface PdfPinLocation {
  reference: DomainRef;
  name: string;
  drawingAnchors: unknown[];
}

function isRef(value: unknown): value is DomainRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Record<string, unknown>;
  return typeof ref.objectType === "string" && typeof ref.objectId === "string"
    && typeof ref.version === "number" && Number.isInteger(ref.version) && ref.version > 0;
}

export function sameDomainRef(left: unknown, right: unknown): left is DomainRef {
  return isRef(left) && isRef(right) && left.objectType === right.objectType
    && left.objectId === right.objectId && left.version === right.version;
}

export function parseDrawingPdfBindings(value: unknown): DrawingPdfBinding[] {
  const items = value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
    ? (value as { items: unknown[] }).items : [];
  return items.flatMap((item): DrawingPdfBinding[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.projectId !== "string" || !isRef(row.drawingRef)
      || !isRef(row.evidenceRef) || typeof row.fileHash !== "string"
      || typeof row.createdAt !== "string" || typeof row.createdBy !== "string") return [];
    return [{
      id: row.id,
      projectId: row.projectId,
      drawingRef: row.drawingRef,
      evidenceRef: row.evidenceRef,
      fileHash: row.fileHash,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    }];
  });
}

export function parsePdfPinLocations(value: unknown): PdfPinLocation[] {
  const rows = value && typeof value === "object" && Array.isArray((value as { rows?: unknown }).rows)
    ? (value as { rows: unknown[] }).rows : [];
  return rows.flatMap((item): PdfPinLocation[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (!isRef(row.reference) || typeof row.name !== "string" || !Array.isArray(row.drawingAnchors)) return [];
    return [{ reference: row.reference, name: row.name, drawingAnchors: row.drawingAnchors }];
  });
}

export async function fetchDrawingPdfBindings(client: SupervisionClient): Promise<DrawingPdfBinding[]> {
  const data = await client.request<unknown>(client.path("/parallel/drawing-pdf-bindings"));
  return parseDrawingPdfBindings(data);
}

export async function fetchPdfPinLocations(client: SupervisionClient): Promise<PdfPinLocation[]> {
  const data = await client.request<unknown>(client.path("/parallel/locations"));
  return parsePdfPinLocations(data);
}

export async function savePdfLocationAnchor(client: SupervisionClient, location: PdfPinLocation, anchor: PdfDrawingAnchor): Promise<void> {
  if (!isRef(location.reference) || !isRef(anchor.drawingRef)
    || !Number.isInteger(anchor.page) || anchor.page < 1 || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)
    || anchor.coordinateSystem !== "pdf_points") {
    throw new Error("저장할 도면 위치 정보가 올바르지 않습니다.");
  }
  await client.request<unknown>(
    client.path("/parallel/locations/" + encodeURIComponent(location.reference.objectId)),
    {
      method: "PUT",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        expectedVersion: location.reference.version,
        drawingAnchors: [...location.drawingAnchors, anchor],
      }),
    },
  );
}
