import type { DomainRef, RecordDTO } from "@doul/client";

export type {
  CommandDescriptor,
  CreationCapability,
  Fields,
  FormSchema,
  HumanRole,
  IssuePackageInput,
  IssuePackageResult,
  MediaAnalysisMode,
  MediaAnalysisLanguage,
  MediaAnalysisRequestInput,
  MediaAnalysisReview,
  Json,
  Scope,
  Session,
  WorkItem,
  Workspace,
} from "@doul/client";
export type { DomainRef, RecordDTO };

export type ProjectRole = "ADM" | "SUP" | "OWN" | "CON";
export interface ProjectSettings {
  project: { id: string; version: number; name: string; country: string; timezone: string; classification?: string };
  currentRoleId: string;
  availableCommands: string[];
  organizations: Array<{ id: string; name: string; actorGroup: ProjectRole }>;
  participants: Array<{ id: string; name: string; organizationId?: string }>;
  assignments: Array<{ id: string; version: number; partyId: string; organizationId: string; actorGroup: ProjectRole; active: boolean; startDate: string; endDate: string; disciplines: string[]; packageIds: string[]; locationIds: string[] }>;
  locations: Array<{ id: string; name: string }>;
  workPackages: Array<{ id: string; name: string }>;
  disciplines: Array<{ id: string; name: string }>;
  roleProfiles: Array<{ actorGroup: ProjectRole; name: string }>;
  scope: { discipline: string; packageId: string; locationId: string; responsibleOrganizationId: string; minimumQualificationRank: number } | null;
  history: Array<{ id: string; at: string; command: string; afterVersion: number }>;
}
export interface AccessibleProjects {
  currentProjectId: string;
  items: Array<{ projectId: string; name: string; synthetic: boolean }>;
}

export interface RegisterProjectionRow {
  sourceDomainRefs: readonly DomainRef[];
  data: RecordDTO;
  calculated: Record<string, unknown>;
  unavailableFields: readonly string[];
}

export interface UiRoute {
  id: string;
  label: string;
  labelKey?: string;
  icon: string;
}

export interface UiStatusSummary {
  id: string;
  machine: string;
  title: string;
  status: string;
  locationId?: string;
  evidenceCount: number;
  availableCommands: readonly string[];
}

export type DrawingImpactNotice = {
  incidentId: string;
  drawingRef: { objectType: string; objectId: string; version: number };
  title: string;
  message: string;
  reason: string;
  occurredAt: string;
};

export interface DrawingImpactIncident {
  incidentId: string;
  drawingRef: DomainRef;
  title?: string;
  revision?: string;
  reason: string;
  occurredAt: string;
  items: Array<{
    sourceRef: DomainRef;
    machine: string;
    title: string;
    status: string;
    responsiblePartyId: string;
  }>;
}

export interface DrawingImpactHistory extends DrawingImpactIncident {
  resolvedAt: string | null;
  state: "active" | "restored";
}
