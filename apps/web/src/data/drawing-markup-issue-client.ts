import type { DomainRef, RecordDTO } from "./ui-contract";
import type { SupervisionClient } from "./supervision-client";

export interface DrawingMarkupIssueLink {
  markupId: string;
  markupVersion: number;
  inspectionRef: DomainRef;
  observationRefs: DomainRef[];
  issueRef: DomainRef;
  actionRef: DomainRef;
  createdAt: string;
  createdBy: string;
}

export interface DrawingMarkupRecord {
  id: string;
  version: number;
  projectId: string;
  bindingId: string;
  drawingRef: DomainRef;
  evidenceRef: DomainRef;
  page: number;
  rect: { x1: number; y1: number; x2: number; y2: number };
  text: string;
  createdAt: string;
  createdBy: string;
  issueLink?: DrawingMarkupIssueLink;
}

export interface DrawingMarkupIssueInput {
  roleAssignmentId: string;
  expectedMarkupVersion: number;
  inspectionRef: DomainRef;
  observationRefs: DomainRef[];
  issueObjectId: string;
  actionObjectId: string;
  subtype: string;
  title: string;
  actionTitle: string;
  responsiblePartyId: string;
  dueAt: string;
}

export interface DrawingMarkupIssueResult {
  markup: DrawingMarkupRecord;
  issue: RecordDTO;
  correctiveAction: RecordDTO;
  link: DrawingMarkupIssueLink;
}

function projectPath(client: SupervisionClient, projectId: string, suffix: string) {
  if (client.session?.projectId !== projectId) throw new Error("현재 프로젝트가 일치하지 않습니다.");
  return client.path(suffix);
}

export function getDrawingMarkup(client: SupervisionClient, projectId: string, markupId: string) {
  if (!markupId) throw new Error("도면 주석을 선택하십시오.");
  return client.request<DrawingMarkupRecord>(
    projectPath(client, projectId, `/parallel/drawing-markups/${encodeURIComponent(markupId)}`),
  );
}

export function createIssueFromDrawingMarkup(
  client: SupervisionClient,
  projectId: string,
  markupId: string,
  input: DrawingMarkupIssueInput,
  key: string,
) {
  if (!client.session) throw new Error("로그인이 필요합니다.");
  if (!key.trim()) throw new Error("요청 키가 필요합니다.");
  return client.request<DrawingMarkupIssueResult>(
    projectPath(client, projectId, `/parallel/drawing-markups/${encodeURIComponent(markupId)}/issues`),
    {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(input),
    },
  );
}
