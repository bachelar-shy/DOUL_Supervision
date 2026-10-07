import type { DomainRef, RecordDTO } from './ui-contract';
import type { SupervisionClient } from './supervision-client';
export interface DrawingSourceInput { objectId: string; title: string; revision: string; evidenceRef: DomainRef; predecessorRef: DomainRef | null; requestReview: boolean }
export interface DrawingSourceResult { drawing: RecordDTO; binding: { id: string; drawingRef: DomainRef; evidenceRef: DomainRef }; approval: RecordDTO | null }
export function registerDrawingSource(client: SupervisionClient, input: DrawingSourceInput, key: string) {
  return client.request<DrawingSourceResult>(client.path('/parallel/drawing-sources'), { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(input) });
}
