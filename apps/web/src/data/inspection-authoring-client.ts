import type { DomainRef, RecordDTO } from "./ui-contract";
import type { SupervisionClient } from "./supervision-client";
export interface InspectionSources {
  drawings: Array<{ domainRef: DomainRef; title: string; revision: string; locations: Array<{ id: string; name: string }> }>;
  requirements: Array<{ domainRef: DomainRef; title: string }>;
  evidence: Array<{ domainRef: DomainRef; title: string; mediaType: string }>;
}
export interface InspectionDraftInput {
  objectId: string; drawingRef: DomainRef; locationId: string; requirementRefs: DomainRef[]; evidenceRefs: DomainRef[];
  workName: string; selfInspectionComplete: boolean; precheck: Record<string, boolean>; holdPoint: boolean;
}
export function inspectionSources(client: SupervisionClient, drawingRef?: DomainRef, locationId?: string): Promise<InspectionSources> {
  const query = drawingRef && locationId ? `?${new URLSearchParams({ drawing_id: drawingRef.objectId, drawing_version: String(drawingRef.version), location_id: locationId })}` : "";
  return client.request(client.path(`/inspection-authoring/options${query}`));
}
export function createInspectionDraft(client: SupervisionClient, input: InspectionDraftInput, key: string): Promise<{ record: RecordDTO }> {
  return client.request(client.path("/inspection-authoring/drafts"), { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(input) });
}
