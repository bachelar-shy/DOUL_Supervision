import { koreanMachineLabels } from "@doul/localization";
import type { HumanRole, UiRoute } from "../data/ui-contract";
import i18n from "../i18n/config";

export const routes: readonly UiRoute[] = [
  { id: "today", label: "Today", labelKey: "navigation.today", icon: "home" },
  { id: "drawings", label: "Drawings", labelKey: "navigation.drawings", icon: "layers" },
  { id: "corrections", label: "Corrective actions", labelKey: "launch.corrections", icon: "flag" },
  {
    id: "inspections",
    label: "Inspections",
    labelKey: "navigation.inspections",
    icon: "check",
  },
  {
    id: "capture",
    label: "Field evidence",
    labelKey: "navigation.capture",
    icon: "camera",
  },
  {
    id: "observations",
    label: "Observations",
    labelKey: "navigation.observations",
    icon: "eye",
  },
  {
    id: "issues",
    label: "Issues",
    labelKey: "navigation.issues",
    icon: "flag",
  },
  {
    id: "actions",
    label: "Corrective actions",
    labelKey: "navigation.actions",
    icon: "tool",
  },
  {
    id: "schedule",
    label: "Schedule",
    labelKey: "navigation.schedule",
    icon: "layers",
  },
  {
    id: "contract",
    label: "Contract",
    labelKey: "navigation.contract",
    icon: "report",
  },
  {
    id: "payment",
    label: "Payment",
    labelKey: "payment.title",
    icon: "table",
  },
  {
    id: "completion",
    label: "Completion and handover",
    labelKey: "completion.title",
    icon: "check",
  },
  {
    id: "safety",
    label: "Safety",
    labelKey: "navigation.safety",
    icon: "shield",
  },
  {
    id: "owner",
    label: "Owner reporting",
    labelKey: "navigation.owner",
    icon: "report",
  },
  {
    id: "documents",
    label: "Documents",
    labelKey: "navigation.documents",
    icon: "document",
  },
  {
    id: "registers",
    label: "Registers",
    labelKey: "navigation.registers",
    icon: "table",
  },
  { id: "rfis", label: "RFI", labelKey: "navigation.rfis", icon: "layers" },
  { id: "admin", label: "Admin", labelKey: "navigation.admin", icon: "users" },
  { id: "parallel-test", label: "Parallel feature tests", labelKey: "navigation.parallelTest", icon: "layers" },
];

// Stage-one field release limits navigation; original workflows and data remain intact.
export const fieldCoreRoutes: Record<HumanRole, readonly string[]> = {
  SUP: ["today","capture","drawings","inspections","corrections","owner"],
  CON: ["today","capture","drawings","inspections","corrections"],
  OWN: ["today","drawings","corrections","owner"],
  DES: ["today","drawings"],
  ADM: ["today","capture","drawings","inspections","corrections","owner","admin"],
};
export type CorrectionSection = "observations" | "issues" | "actions";
export function fieldCoreRouteFor(target: string): { route: string; correction?: CorrectionSection; reportForm?: boolean } {
  if (target === "observations" || target === "issues" || target === "actions") {
    return { route: "corrections", correction: target };
  }
  if (target === "documents") return { route: "owner", reportForm: true };
  return { route: target };
}

const allRouteIds = routes.map((route) => route.id);

export interface MobileRouteSpec {
  id: string;
  label: string;
  labelKey?: string;
  icon: string;
}

export const mobileRoutes: Record<HumanRole, readonly MobileRouteSpec[]> = {
  SUP: [
    { id: "today", label: "Today", labelKey: "navigation.today", icon: "home" },
    {
      id: "inspections",
      label: "Inspection",
      labelKey: "mobile.inspections",
      icon: "check",
    },
    { id: "capture", label: "Capture", labelKey: "mobile.capture", icon: "camera" },
    { id: "safety", label: "Safety", labelKey: "mobile.safety", icon: "shield" },
  ],
  CON: [
    { id: "today", label: "Today", labelKey: "navigation.today", icon: "home" },
    {
      id: "inspections",
      label: "Inspection",
      labelKey: "mobile.inspections",
      icon: "check",
    },
    { id: "capture", label: "Capture", labelKey: "mobile.capture", icon: "camera" },
    { id: "safety", label: "Safety", labelKey: "mobile.safety", icon: "shield" },
  ],
  OWN: [
    { id: "today", label: "Today", labelKey: "navigation.today", icon: "home" },
    { id: "owner", label: "Decision", labelKey: "mobile.owner", icon: "report" },
    { id: "issues", label: "Issues", labelKey: "mobile.issues", icon: "flag" },
    {
      id: "documents",
      label: "Documents",
      labelKey: "mobile.documents",
      icon: "document",
    },
  ],
  DES: [
    { id: "today", label: "Today", labelKey: "navigation.today", icon: "home" },
    { id: "rfis", label: "RFI", labelKey: "mobile.rfis", icon: "layers" },
    { id: "capture", label: "Capture", labelKey: "mobile.capture", icon: "camera" },
    {
      id: "documents",
      label: "Documents",
      labelKey: "mobile.documents",
      icon: "document",
    },
  ],
  ADM: [
    { id: "today", label: "Today", labelKey: "navigation.today", icon: "home" },
    {
      id: "registers",
      label: "Registers",
      labelKey: "mobile.registers",
      icon: "table",
    },
    {
      id: "documents",
      label: "Documents",
      labelKey: "mobile.documents",
      icon: "document",
    },
    { id: "admin", label: "Admin", labelKey: "mobile.admin", icon: "users" },
  ],
};

export const roleRoutes: Record<HumanRole, readonly string[]> = {
  SUP: allRouteIds.filter((id) => id !== "admin"),
  CON: [
    "today",
    "inspections",
    "capture",
    "drawings",
    "issues",
    "actions",
    "safety",
    "schedule",
    "contract",
    "payment",
    "completion",
    "rfis",
    "documents",
    "registers",
  ],
  OWN: ["today", "drawings", "schedule", "contract", "payment", "completion", "owner", "issues", "documents", "registers"],
  DES: ["today", "rfis", "drawings", "capture", "documents", "registers"],
  ADM: allRouteIds,
};

export const machineLabels: Record<string, string> = new Proxy(
  koreanMachineLabels,
  {
    get(target, property, receiver) {
      if (typeof property !== "string") {
        return Reflect.get(target, property, receiver);
      }
      if (!(property in target)) return undefined;
      return i18n.t(`machine.${property}`, {
        defaultValue: target[property],
      });
    },
  },
);

export const machineForRoute: Record<string, readonly string[]> = {
  inspections: ["inspection"],
  observations: ["observation"],
  issues: ["issue"],
  actions: ["action"],
  contract: ["contract_notice", "claim", "eot_request"],
  payment: ["contract_boq", "quantity_measurement", "payment_claim"],
  completion: ["commissioning_package", "handover_package", "warranty_claim"],
  safety: ["safety_permit", "safety_stop_order", "safety_equipment_inspection"],
  schedule: ["schedule_baseline", "schedule_progress", "delay_event", "recovery_plan"],
  owner: ["report", "decision"],
  rfis: ["rfi"],
};
