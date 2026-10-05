import type { DomainRef, RecordDTO, WorkItem } from "../data/ui-contract";
import { machineLabels } from "../app/routes";

export function recordTitle(r: RecordDTO) {
  return (
    r.workName ||
    r.title ||
    r.description ||
    String(
      r.metadata?.name || machineLabels[r.mediaType || ""] || r.id.slice(0, 8),
    )
  );
}
export function recordRef(item: WorkItem): DomainRef {
  const kind: Record<string, string> = {
    inspection: "Inspection",
    issue: "Issue",
    observation: "Observation",
    action: "Action",
    rfi: "WorkItem",
    report: "InformationItem",
    decision: "Decision",
    document: "DocumentSnapshot",
  };
  return {
    objectType: kind[item.machine] || "InformationItem",
    objectId: item.record.id,
    version: item.record.version,
  };
}
