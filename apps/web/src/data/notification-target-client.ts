import type { WorkItem, Workspace } from "./ui-contract";
import { machineForRoute } from "../app/routes";

export interface NotificationSourceRef {
  objectType: string;
  objectId: string;
  version: number;
}

export type NotificationSourceTarget =
  | { kind: "exact"; item: WorkItem; route: string }
  | { kind: "past"; currentItem: WorkItem; route: string }
  | { kind: "unavailable" };

// Event references use WorkItem; drawing impact references preserve canonical types.
// Explicit type/machine pairs are required for canonical navigation.
const extraMachineRoutes: Readonly<Record<string, string>> = {
  schedule_baseline: "schedule",
  schedule_progress: "schedule",
  delay_event: "schedule",
  recovery_plan: "schedule",
  safety_permit: "safety",
  safety_stop_order: "safety",
  safety_equipment_inspection: "safety",
  evidence: "capture",
  document: "documents",
};

const machineRoutes: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(
    Object.entries(machineForRoute).flatMap(([route, machines]) => machines.map((machine) => [machine, route])),
  ),
  ...extraMachineRoutes,
});

const canonicalMachines: Readonly<Record<string, string>> = {
  Inspection: "inspection", Issue: "issue", Action: "action",
};

export function resolveNotificationSourceTarget(
  sourceRef: NotificationSourceRef,
  projectId: string,
  workspace: Workspace,
): NotificationSourceTarget {
  if (
    (sourceRef.objectType !== "WorkItem" && !canonicalMachines[sourceRef.objectType])
    || !sourceRef.objectId
    || !Number.isInteger(sourceRef.version)
    || sourceRef.version < 1
    || projectId !== workspace.project.id
  ) return { kind: "unavailable" };

  const scopedItems = workspace.items.filter((item) =>
    item.record.id === sourceRef.objectId && item.record.projectId === projectId
      && typeof machineRoutes[item.machine] === "string"
      && (sourceRef.objectType === "WorkItem" || item.machine === canonicalMachines[sourceRef.objectType]),
  );
  const exact = scopedItems.filter((item) => item.record.version === sourceRef.version);
  if (exact.length === 1) {
    return { kind: "exact", item: exact[0], route: machineRoutes[exact[0].machine] };
  }
  if (exact.length > 1) return { kind: "unavailable" };

  const current = scopedItems.filter((item) => item.record.version > sourceRef.version);
  if (current.length === 1) {
    return { kind: "past", currentItem: current[0], route: machineRoutes[current[0].machine] };
  }
  return { kind: "unavailable" };
}
