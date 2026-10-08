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
