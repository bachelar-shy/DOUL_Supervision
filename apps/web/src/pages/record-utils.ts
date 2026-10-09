import type { RecordDTO } from "../data/ui-contract";
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
export { recordReference as recordRef } from "../data/record-reference";
