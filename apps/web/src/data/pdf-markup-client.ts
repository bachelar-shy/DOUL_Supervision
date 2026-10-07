import type { DomainRef } from "./ui-contract";
import type { SupervisionClient } from "./supervision-client";

export interface PdfMarkupRect { x1: number; y1: number; x2: number; y2: number }
export interface PdfDrawingMarkup {
  id: string;
  version: number;
  projectId: string;
  bindingId: string;
  drawingRef: DomainRef;
  evidenceRef: DomainRef;
  page: number;
  rect: PdfMarkupRect;
  text: string;
  createdAt: string;
  createdBy: string;
  availableCommands?: Array<{ command: "edit" | "delete"; label: string }>;
  deletedAt?: string | null;
  deletedBy?: string | null;
  deleteReason?: string | null;
  historySummary?: { count: number; latestVersion: number };
  issueLink?: unknown;
}
export interface CreatePdfMarkupInput { bindingId: string; page: number; rect: PdfMarkupRect; text: string; idempotencyKey?: string }
export interface EditPdfMarkupInput { expectedVersion: number; text: string; rect: PdfMarkupRect; reason: string; idempotencyKey?: string }
export interface DeletePdfMarkupInput { expectedVersion: number; reason: string; idempotencyKey?: string }
export interface PdfMarkupHistoryItem extends Omit<PdfDrawingMarkup, "deletedAt" | "deletedBy" | "deleteReason"> { reason?: string; editedAt?: string; editedBy?: string; deletedAt?: string | null; deletedBy?: string | null; deleteReason?: string | null; updateReason?: string }

export function parseMarkupCommands(value: unknown): PdfDrawingMarkup["availableCommands"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return (row.command === "edit" || row.command === "delete") && typeof row.label === "string"
      ? [{ command: row.command, label: row.label }] : [];
  });
}

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
  if (typeof row.id !== "string" || typeof row.version !== "number" || !Number.isInteger(row.version) || row.version < 1 || typeof row.projectId !== "string"
    || typeof row.bindingId !== "string" || !isRef(row.drawingRef, "InformationItem")
    || !isRef(row.evidenceRef, "Evidence") || !Number.isInteger(row.page) || Number(row.page) < 1
    || !rect || ![rect.x1, rect.y1, rect.x2, rect.y2].every((point) => typeof point === "number" && Number.isFinite(point))
    || Number(rect.x1) >= Number(rect.x2) || Number(rect.y1) >= Number(rect.y2)
    || typeof row.text !== "string" || row.text.trim().length < 1 || row.text.trim().length > 2000
    || typeof row.createdAt !== "string" || typeof row.createdBy !== "string") return null;
  const historySummary = row.historySummary && typeof row.historySummary === "object"
    ? row.historySummary as Record<string, unknown> : undefined;
  const parsed: PdfDrawingMarkup = { id: row.id, version: row.version, projectId: row.projectId, bindingId: row.bindingId,
    drawingRef: row.drawingRef, evidenceRef: row.evidenceRef, page: Number(row.page),
    rect: { x1: Number(rect.x1), y1: Number(rect.y1), x2: Number(rect.x2), y2: Number(rect.y2) },
    text: row.text, createdAt: row.createdAt, createdBy: row.createdBy };
  if (Array.isArray(row.availableCommands)) parsed.availableCommands = parseMarkupCommands(row.availableCommands);
  if (row.deletedAt === null || typeof row.deletedAt === "string") parsed.deletedAt = row.deletedAt;
  if (row.deletedBy === null || typeof row.deletedBy === "string") parsed.deletedBy = row.deletedBy;
  if (row.deleteReason === null || typeof row.deleteReason === "string") parsed.deleteReason = row.deleteReason;
  if (historySummary && Number.isInteger(historySummary.count) && Number.isInteger(historySummary.latestVersion)) {
    parsed.historySummary = { count: Number(historySummary.count), latestVersion: Number(historySummary.latestVersion) };
  }
  if (row.issueLink !== undefined) parsed.issueLink = row.issueLink;
  return parsed;
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


export async function fetchPdfDrawingMarkup(client: SupervisionClient, id: string): Promise<PdfDrawingMarkup> {
  const value = await client.request<unknown>(client.path("/parallel/drawing-markups/" + encodeURIComponent(id)));
  const markup = parsePdfDrawingMarkup(value);
  if (!markup || markup.id !== id) throw new Error("주석 상세 응답 형식이 올바르지 않습니다.");
  return markup;
}

export async function fetchPdfDrawingMarkupHistory(client: SupervisionClient, id: string): Promise<PdfMarkupHistoryItem[]> {
  const value = await client.request<unknown>(client.path("/parallel/drawing-markups/" + encodeURIComponent(id) + "/history"));
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) return [];
  return (value as { items: unknown[] }).items.flatMap((item) => {
    const parsed = parsePdfDrawingMarkup(item);
    return parsed ? [{ ...parsed, ...(typeof (item as Record<string, unknown>).reason === "string" ? { reason: (item as Record<string, unknown>).reason as string } : {}), ...(typeof (item as Record<string, unknown>).updateReason === "string" ? { updateReason: (item as Record<string, unknown>).updateReason as string } : {}), ...(typeof (item as Record<string, unknown>).deleteReason === "string" ? { deleteReason: (item as Record<string, unknown>).deleteReason as string } : {}) }] : [];
  });
}

export async function editPdfDrawingMarkup(client: SupervisionClient, id: string, input: EditPdfMarkupInput): Promise<PdfDrawingMarkup> {
  const text = input.text.trim();
  const reason = input.reason.trim();
  const { x1, y1, x2, y2 } = input.rect;
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1
    || ![x1, y1, x2, y2].every(Number.isFinite) || x1 >= x2 || y1 >= y2
    || [x1, y1, x2, y2].some((point) => Math.abs(point) > 10_000_000)
    || !text || text.length > 2000 || !reason || reason.length > 500) {
    throw new Error("수정 내용, 위치, 사유를 확인하세요.");
  }
  const value = await client.request<unknown>(client.path("/parallel/drawing-markups/" + encodeURIComponent(id)), {
    method: "PUT", headers: { "Idempotency-Key": input.idempotencyKey || crypto.randomUUID() },
    body: JSON.stringify({ expectedVersion: input.expectedVersion, text, rect: { x1, y1, x2, y2 }, reason }),
  });
  const markup = parsePdfDrawingMarkup(value);
  if (!markup || markup.id !== id || markup.version !== input.expectedVersion + 1) throw new Error("수정된 주석 응답 형식이 올바르지 않습니다.");
  return markup;
}

export async function deletePdfDrawingMarkup(client: SupervisionClient, id: string, input: DeletePdfMarkupInput): Promise<PdfDrawingMarkup> {
  const reason = input.reason.trim();
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || !reason || reason.length > 500) {
    throw new Error("삭제 사유를 입력하세요.");
  }
  const value = await client.request<unknown>(client.path("/parallel/drawing-markups/" + encodeURIComponent(id)), {
    method: "DELETE", headers: { "Idempotency-Key": input.idempotencyKey || crypto.randomUUID() },
    body: JSON.stringify({ expectedVersion: input.expectedVersion, reason }),
  });
  const markup = parsePdfDrawingMarkup(value);
  if (!markup || markup.id !== id || !markup.deletedAt) throw new Error("삭제된 주석 응답 형식이 올바르지 않습니다.");
  return markup;
}
