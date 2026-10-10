import type { DomainRef } from "./ui-contract";
import type { SupervisionClient } from "./supervision-client";

export interface DrawingFieldReceipt {
  recipientPartyId: string;
  recipientName?: string;
  deliveredAt: string | null;
  deliveredBy?: string | null;
  receivedAt: string | null;
  receivedBy?: string | null;
  returnedAt: string | null;
  returnedBy?: string | null;
  returnReason?: string | null;
}

export interface DrawingFieldCommand {
  command: string;
  label: string;
}

export interface DrawingFieldRevision {
  id: string;
  version: number;
  projectId: string;
  bindingId: string;
  drawingRef: DomainRef;
  evidenceRef: DomainRef;
  drawingNo: string;
  revision: string;
  issuedFor: "construction" | "review" | "information";
  requiredRecipientPartyIds: string[];
  approvalRef: DomainRef | null;
  changeRefs: DomainRef[];
  supersedesId: string | null;
  status: string;
  releasedAt: string | null;
  createdAt: string;
  createdBy: string;
  receipts?: DrawingFieldReceipt[];
  fieldDistributionComplete?: boolean;
  obsoleteCopiesOutstanding?: number | string[] | boolean;
  currentForConstruction?: boolean;
  readinessReasons?: string[];
  isCurrentSource?: boolean;
  availableCommands: DrawingFieldCommand[];
  [key: string]: unknown;
}

export interface DrawingFieldRegistrationInput {
  bindingId: string;
  drawingNo: string;
  revision: string;
  issuedFor: "construction" | "review" | "information";
  requiredRecipientPartyIds: string[];
  approvalRef: DomainRef | null;
  changeRefs: DomainRef[];
  supersedesId: string | null;
}

export interface DrawingFieldHistoryEvent {
  [key: string]: unknown;
}

function projectPath(client: SupervisionClient, projectId: string, suffix: string) {
  if (!client.session) throw new Error("로그인이 필요합니다.");
  if (client.session.projectId !== projectId) throw new Error("현재 현장이 일치하지 않습니다.");
  return client.path(suffix);
}

export async function listDrawingFieldRevisions(client: SupervisionClient, projectId: string): Promise<DrawingFieldRevision[]> {
  const result = await client.request<{ items: DrawingFieldRevision[] }>(
    projectPath(client, projectId, "/parallel/drawing-field-revisions"),
  );
  return result.items;
}

export async function registerDrawingFieldRevision(
  client: SupervisionClient,
  projectId: string,
  input: DrawingFieldRegistrationInput,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<DrawingFieldRevision> {
  return client.request<DrawingFieldRevision>(
    projectPath(client, projectId, "/parallel/drawing-field-revisions"),
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    },
  );
}

export async function commandDrawingFieldRevision(
  client: SupervisionClient,
  projectId: string,
  revisionId: string,
  command: string,
  expectedVersion: number,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<DrawingFieldRevision> {
  return client.request<DrawingFieldRevision>(
    projectPath(client, projectId, `/parallel/drawing-field-revisions/${encodeURIComponent(revisionId)}/commands`),
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ command, expectedVersion, payload }),
    },
  );
}

export async function getDrawingFieldRevision(
  client: SupervisionClient,
  projectId: string,
  revisionId: string,
): Promise<DrawingFieldRevision> {
  return client.request<DrawingFieldRevision>(
    projectPath(client, projectId, `/parallel/drawing-field-revisions/${encodeURIComponent(revisionId)}`),
  );
}

export async function getDrawingFieldHistory(
  client: SupervisionClient,
  projectId: string,
  revisionId: string,
): Promise<DrawingFieldHistoryEvent[]> {
  const result = await client.request<{ items: DrawingFieldHistoryEvent[] }>(
    projectPath(client, projectId, `/parallel/drawing-field-revisions/${encodeURIComponent(revisionId)}/history`),
  );
  return result.items;
}
