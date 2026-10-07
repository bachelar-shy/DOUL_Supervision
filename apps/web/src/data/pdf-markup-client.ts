import type { DomainRef } from "./ui-contract";
import type { SupervisionClient } from "./supervision-client";

export interface PdfMarkupRect { x1: number; y1: number; x2: number; y2: number }
export interface PdfDrawingMarkup {
  id: string;
  version: 1;
  projectId: string;
  bindingId: string;
  drawingRef: DomainRef;
  evidenceRef: DomainRef;
  page: number;
  rect: PdfMarkupRect;
  text: string;
  createdAt: string;
  createdBy: string;
}
export interface CreatePdfMarkupInput { bindingId: string; page: number; rect: PdfMarkupRect; text: string; idempotencyKey?: string }

function isRef(value: unknown, type: string): value is DomainRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Record<string, unknown>;
  return ref.objectType === type && typeof ref.objectId === "string" && typeof ref.version === "number"
    && Number.isInteger(ref.version) && ref.version > 0;
}

export function parsePdfDrawingMarkup(value: unknown): PdfDrawingMarkup | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const rect = row.rect as Record<string, unknown> | null;
  if (typeof row.id !== "string" || row.version !== 1 || typeof row.projectId !== "string"
    || typeof row.bindingId !== "string" || !isRef(row.drawingRef, "InformationItem")
    || !isRef(row.evidenceRef, "Evidence") || !Number.isInteger(row.page) || Number(row.page) < 1
    || !rect || ![rect.x1, rect.y1, rect.x2, rect.y2].every((point) => typeof point === "number" && Number.isFinite(point))
    || Number(rect.x1) >= Number(rect.x2) || Number(rect.y1) >= Number(rect.y2)
    || typeof row.text !== "string" || row.text.trim().length < 1 || row.text.trim().length > 2000
    || typeof row.createdAt !== "string" || typeof row.createdBy !== "string") return null;
  return { id: row.id, version: 1, projectId: row.projectId, bindingId: row.bindingId,
    drawingRef: row.drawingRef, evidenceRef: row.evidenceRef, page: Number(row.page),
    rect: { x1: Number(rect.x1), y1: Number(rect.y1), x2: Number(rect.x2), y2: Number(rect.y2) },
    text: row.text, createdAt: row.createdAt, createdBy: row.createdBy };
}

export function parsePdfDrawingMarkups(value: unknown): PdfDrawingMarkup[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) return [];
  return (value as { items: unknown[] }).items.flatMap((item) => {
    const parsed = parsePdfDrawingMarkup(item);
    return parsed ? [parsed] : [];
  });
}

export async function fetchPdfDrawingMarkups(client: SupervisionClient, bindingId: string): Promise<PdfDrawingMarkup[]> {
  if (!bindingId) return [];
  const data = await client.request<unknown>(client.path("/parallel/drawing-markups") + "?bindingId=" + encodeURIComponent(bindingId));
  return parsePdfDrawingMarkups(data);
}

export async function createPdfDrawingMarkup(client: SupervisionClient, input: CreatePdfMarkupInput): Promise<PdfDrawingMarkup> {
  const { x1, y1, x2, y2 } = input.rect;
  const text = input.text.trim();
  if (!input.bindingId || !Number.isInteger(input.page) || input.page < 1
    || ![x1, y1, x2, y2].every(Number.isFinite) || x1 >= x2 || y1 >= y2
    || [x1, y1, x2, y2].some((point) => Math.abs(point) > 10_000_000)
    || text.length < 1 || text.length > 2000) throw new Error("주석 내용이나 위치 정보가 올바르지 않습니다.");
  const value = await client.request<unknown>(client.path("/parallel/drawing-markups"), {
    method: "POST", headers: { "Idempotency-Key": input.idempotencyKey || crypto.randomUUID() },
    body: JSON.stringify({ bindingId: input.bindingId, page: input.page, rect: { x1, y1, x2, y2 }, text }),
  });
  const markup = parsePdfDrawingMarkup(value);
  if (!markup || markup.bindingId !== input.bindingId || markup.page !== input.page) throw new Error("저장된 주석 응답 형식이 올바르지 않습니다.");
  return markup;
}
