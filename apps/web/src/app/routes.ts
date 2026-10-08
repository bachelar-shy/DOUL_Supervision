import { koreanMachineLabels } from "@doul/localization";
import type { HumanRole, UiRoute } from "../data/ui-contract";
import i18n from "../i18n/config";

export const routes: readonly UiRoute[] = [
  { id: "today", label: "Today", labelKey: "navigation.today", icon: "home" },
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
    "issues",
    "actions",
    "safety",
    "schedule",
    "contract",
    "rfis",
    "documents",
    "registers",
  ],
  OWN: ["today", "schedule", "contract", "owner", "issues", "documents", "registers"],
  DES: ["today", "rfis", "capture", "documents", "registers"],
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
  owner: ["report", "decision"],
  rfis: ["rfi"],
};
