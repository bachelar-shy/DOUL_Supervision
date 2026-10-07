import type { DomainRef } from "./ui-contract";
import type { SupervisionClient } from "./supervision-client";

export interface DrawingRevisionOption {
  domainRef: DomainRef;
  title?: string;
  revision?: string;
  sourceStatus?: string;
}

export interface DrawingPdfBinding {
  id: string;
  projectId: string;
  drawingRef: DomainRef;
  evidenceRef: DomainRef;
  fileHash: string;
  createdAt: string;
  createdBy: string;
}

function endpoint(client: SupervisionClient, projectId: string) {
  return client.path(`/projects/${projectId}/parallel/drawing-pdf-bindings`);
}

export async function listDrawingRevisions(client: SupervisionClient, projectId: string) {
  const result = await client.request<{ items: DrawingRevisionOption[] }>(
    client.path(`/projects/${projectId}/parallel/drawings`),
  );
  return result.items;
}

export async function listDrawingPdfBindings(client: SupervisionClient, projectId: string) {
  const result = await client.request<{ items: DrawingPdfBinding[] }>(endpoint(client, projectId));
  return result.items;
}

export function createDrawingPdfBinding(
  client: SupervisionClient,
  projectId: string,
  drawingRef: DomainRef,
  evidenceRef: DomainRef,
) {
  if (!client.session) throw new Error("로그인이 필요합니다.");
  return client.request<DrawingPdfBinding>(endpoint(client, projectId), {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ drawingRef, evidenceRef }),
  });
}
