export type {
  CommandDescriptor,
  DomainRef,
  Fields,
  FormSchema,
  HumanRole,
  Json,
  RecordDTO,
  Scope,
  Session,
  WorkItem,
  Workspace,
} from "@doul/client";

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
