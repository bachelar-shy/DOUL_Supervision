import type { RecordDTO, Workspace } from "./ui-contract";
import type { SupervisionClient } from "./supervision-client";

export const PDF_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

export interface PdfEvidenceSource {
  id: string;
  name: string;
  mime: string;
  record: RecordDTO;
  drawing: boolean;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isPdf(record: RecordDTO): boolean {
  const metadata = record.metadata ?? {};
  const mime = text(metadata.mimeType) || text(metadata.mime) || text(record.mediaType);
  const name = text(metadata.name) || text(record.title) || text(record.fileName);
  return mime.toLowerCase().includes("pdf") || name.toLowerCase().endsWith(".pdf");
}

function sameRef(a: unknown, b: unknown): boolean {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return left.objectType === right.objectType && left.objectId === right.objectId;
}

export function listPdfEvidenceSources(workspace: Workspace): PdfEvidenceSource[] {
  return workspace.items
    .filter((item) => item.machine === "evidence" && isPdf(item.record))
    .map(({ record }) => {
      const metadata = record.metadata ?? {};
      const mime = text(metadata.mimeType) || text(metadata.mime) || "application/pdf";
      const name = text(metadata.name) || text(record.title) || `${record.id}.pdf`;
      const bound = sameRef(record.drawingRef, workspace.context.drawingRef);
      return { id: record.id, name, mime, record, drawing: bound };
    });
}

export async function uploadPdfEvidence(
  client: SupervisionClient,
  workspace: Workspace,
  file: File,
  progress?: (offset: number, total: number) => void,
): Promise<RecordDTO> {
  if (file.size > PDF_UPLOAD_LIMIT_BYTES) {
    throw new Error("PDF 파일은 20 MiB 이하만 업로드할 수 있습니다.");
  }
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("PDF 파일만 업로드할 수 있습니다.");
  }
  const session = client.session;
  if (!session) throw new Error("로그인이 필요합니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return client.upload(bytes, {
    name: file.name,
    mime: "application/pdf",
    hash,
    scope: workspace.context.scope,
    sourcePartyId: session.actor.partyId,
  }, progress);
}

export async function loadPdfEvidence(client: SupervisionClient, evidenceId: string): Promise<Blob> {
  const blob = await client.evidenceContent(evidenceId);
  if (blob.type && !blob.type.toLowerCase().includes("pdf") && blob.type !== "application/octet-stream") {
    throw new Error("선택한 증빙이 PDF 형식이 아닙니다.");
  }
  return blob;
}
