import type { HumanRole } from "../data/ui-contract";

export interface RegisterNavigationGroupSpec {
  id: string;
  label: string;
  labelKey: string;
  description: string;
  descriptionKey: string;
  registerIds: readonly string[];
}

export interface RoleRegisterEntrySpec {
  label: string;
  labelKey: string;
  description: string;
  descriptionKey: string;
  defaultRegisterId: string;
  recommendedRegisterIds: readonly string[];
}

// Presentation-only grouping. The authoritative 29-register contract remains the
// generated projection catalog; these groups only improve findability.
export const registerNavigationGroups: readonly RegisterNavigationGroupSpec[] = [
  {
    id: "governance",
    label: "Governance",
    labelKey: "registerNav.group.governance.label",
    description: "Standards, contract and organization",
    descriptionKey: "registerNav.group.governance.description",
    registerIds: ["01", "02", "03", "27", "28", "29"],
  },
  {
    id: "design-submittal",
    label: "Design and submittals",
    labelKey: "registerNav.group.designSubmittal.label",
    description: "Design, submittals and approvals",
    descriptionKey: "registerNav.group.designSubmittal.description",
    registerIds: ["04", "05", "06", "07", "08", "13", "14"],
  },
  {
    id: "quality",
    label: "Quality",
    labelKey: "registerNav.group.quality.label",
    description: "Materials, testing, inspection and corrective work",
    descriptionKey: "registerNav.group.quality.description",
    registerIds: ["09", "10", "11", "12", "15"],
  },
  {
    id: "schedule-cost",
    label: "Schedule and commercial",
    labelKey: "registerNav.group.scheduleCost.label",
    description: "Schedule, payment and contract administration",
    descriptionKey: "registerNav.group.scheduleCost.description",
    registerIds: ["16", "17", "26"],
  },
  {
    id: "hse",
    label: "Safety and statutory",
    labelKey: "registerNav.group.hse.label",
    description: "Safety, environment and statutory inspection",
    descriptionKey: "registerNav.group.hse.description",
    registerIds: ["18", "19", "20", "21", "25"],
  },
  {
    id: "report-closeout",
    label: "Reporting and closeout",
    labelKey: "registerNav.group.reportCloseout.label",
    description: "Owner reporting, records, handover and defects",
    descriptionKey: "registerNav.group.reportCloseout.description",
    registerIds: ["22", "23", "24"],
  },
];

// These are convenience recommendations, not access-control rules. The server
// continues to filter projection rows by the authenticated role and readability.
export const roleRegisterEntries: Record<HumanRole, RoleRegisterEntrySpec> = {
  SUP: {
    label: "Supervision",
    labelKey: "roles.SUP",
    description: "Inspection, issues, field actions, safety and reporting.",
    descriptionKey: "registerNav.role.SUP.description",
    defaultRegisterId: "11",
    recommendedRegisterIds: ["11", "12", "15", "18", "22", "23"],
  },
  CON: {
    label: "Contractor",
    labelKey: "roles.CON",
    description: "Submittals, inspection requests, corrective actions and field records.",
    descriptionKey: "registerNav.role.CON.description",
    defaultRegisterId: "11",
    recommendedRegisterIds: ["11", "06", "12", "16", "23", "13"],
  },
  OWN: {
    label: "Owner",
    labelKey: "roles.OWN",
    description: "Reports, decisions, schedule, payment and contract risks.",
    descriptionKey: "registerNav.role.OWN.description",
    defaultRegisterId: "22",
    recommendedRegisterIds: ["22", "16", "17", "14", "26", "24"],
  },
  DES: {
    label: "Designer",
    labelKey: "roles.DES",
    description: "Drawings, RFI, design change and approval information.",
    descriptionKey: "registerNav.role.DES.description",
    defaultRegisterId: "13",
    recommendedRegisterIds: ["13", "04", "14", "07", "08", "24"],
  },
  ADM: {
    label: "Administrator",
    labelKey: "roles.ADM",
    description: "Staffing, standards, contracts, documents, audits and lessons.",
    descriptionKey: "registerNav.role.ADM.description",
    defaultRegisterId: "03",
    recommendedRegisterIds: ["03", "01", "02", "05", "28", "29"],
  },
};
