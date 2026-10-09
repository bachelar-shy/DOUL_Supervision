import type { DomainRef, WorkItem } from "./ui-contract";

const objectTypes: Record<string, string> = {
  inspection: "Inspection", issue: "Issue", observation: "Observation", action: "Action",
  decision: "Decision", document: "DocumentSnapshot", evidence: "Evidence",
  requirement: "Requirement", asset: "Asset", analysis_run: "AnalysisRun",
  rfi: "WorkItem", change: "WorkItem", approval: "Approval",
  delay_event: "WorkItem", recovery_plan: "WorkItem", safety_permit: "WorkItem",
  safety_stop_order: "WorkItem", safety_equipment_inspection: "WorkItem",
  contract_notice: "WorkItem", claim: "WorkItem", eot_request: "WorkItem",
  quantity_measurement: "WorkItem", payment_claim: "WorkItem",
  commissioning_package: "WorkItem", handover_package: "WorkItem", warranty_claim: "WorkItem",
};

export function recordReference(item: WorkItem): DomainRef {
  return { objectType: objectTypes[item.machine] ?? "InformationItem", objectId: item.record.id, version: item.record.version };
}
