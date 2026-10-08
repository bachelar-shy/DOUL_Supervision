import type { DomainRef, RecordDTO } from "@doul/client";

export type {
  CommandDescriptor,
  Fields,
  FormSchema,
  HumanRole,
  Json,
  Scope,
  Session,
  WorkItem,
  Workspace,
} from "@doul/client";
export type { DomainRef, RecordDTO };

export interface RegisterProjectionRow {
  sourceDomainRefs: readonly DomainRef[];
  data: RecordDTO;
  calculated: Record<string, unknown>;
  unavailableFields: readonly string[];
}

export interface UiRoute {
  id: string;
  label: string;
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
