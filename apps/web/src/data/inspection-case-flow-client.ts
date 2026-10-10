import type { InspectionCase } from "@doul/client";
export type { InspectionCase } from "@doul/client";
import type { SupervisionClient } from "./supervision-client";
import type { ReinspectionRequestInput, ReinspectionRequestResult, OwnerReportDraftInput, OwnerReportDraftResult } from "@doul/client";
export type { ReinspectionRequestInput, ReinspectionRequestResult, OwnerReportDraftInput, OwnerReportDraftResult } from "@doul/client";

/** Read the server-built, explicitly linked inspection case graph. */
export function getInspectionCase(client: SupervisionClient, inspectionId: string): Promise<InspectionCase> {
  return client.request<InspectionCase>(client.path(`/inspection-cases/${encodeURIComponent(inspectionId)}`));
}

function caseWrite<T>(client: SupervisionClient, inspectionId: string, issueId: string, action: string, input: object, key: string): Promise<T> {
  if (client.kind !== "http" || !client.session) throw new Error("Official case requests require an authenticated API connection");
  return client.request<T>(client.path(`/inspection-cases/${encodeURIComponent(inspectionId)}/issues/${encodeURIComponent(issueId)}/${action}`), {
    method: "POST", headers: { "Idempotency-Key": key },
    body: JSON.stringify({ roleAssignmentId: client.session.actor.roleAssignmentId, ...input }),
  });
}

export function requestCaseReinspection(client: SupervisionClient, inspectionId: string, issueId: string, input: ReinspectionRequestInput, key = crypto.randomUUID()): Promise<ReinspectionRequestResult> {
  return caseWrite(client, inspectionId, issueId, "reinspections", input, key);
}

export function createCaseOwnerReport(client: SupervisionClient, inspectionId: string, issueId: string, input: OwnerReportDraftInput, key = crypto.randomUUID()): Promise<OwnerReportDraftResult> {
  return caseWrite(client, inspectionId, issueId, "owner-reports", input, key);
}
