import type { SupervisionClient } from "./supervision-client";
import type { RecordDTO } from "./ui-contract";

export interface DocumentSigningInput {
  documentHash: string;
  roleCode: string;
  method: "wet_original_verified" | "approved_e_signature";
  originalFileId?: string;
}

/** Submit lookup inputs to the trusted server verifier; never assert verification in the browser. */
export function signDocument(client: SupervisionClient, documentId: string, input: DocumentSigningInput, key: string): Promise<RecordDTO> {
  if (client.kind !== "http" || !client.session) return Promise.reject(new Error("DOCUMENT_SIGNING_REQUIRES_AUTHENTICATED_HTTP"));
  return client.request<RecordDTO>(client.path(`/documents/${encodeURIComponent(documentId)}/sign`), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ ...input, roleAssignmentId: client.session.actor.roleAssignmentId }),
  });
}
