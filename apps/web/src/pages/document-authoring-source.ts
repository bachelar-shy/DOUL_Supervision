import type { DomainRef, RecordDTO, Workspace } from "../data/ui-contract";
import { recordRef } from "./record-utils";

export interface DocumentSource {
  ref: DomainRef;
  record: RecordDTO;
}

/**
 * Choose the primary record by its actual domain kind, not by the first
 * accessible record. In particular FM-21 requires Decision, FM-13 Action,
 * FM-15 WorkItem/RFI, and FM-20 InformationItem/Report.
 * These are authoring shortcuts; the API remains authoritative.
 */
export const documentAuthoringSources: Readonly<Record<string, readonly string[]>> = {
  "FM-09": ["inspection"],
  "FM-12": ["issue"],
  "FM-13": ["action"],
  "FM-15": ["rfi"],
  "FM-19": ["report"],
  "FM-20": ["report"],
  "FM-21": ["decision"],
};

export const documentAuthoringForms = ["FM-20", "FM-19", "FM-21", "FM-12", "FM-13", "FM-15", "FM-09", "FM-02"] as const;

export function eligibleDocumentSources(workspace: Workspace, formId: string): DocumentSource[] {
  if (formId === "FM-02") {
    // Method statements are configuration references, not workflow machines.
    // Use the readable catalog's exact source ref, without inventing a machine.
    return (workspace.context.referenceCatalog?.informationItems ?? []).filter(({ ref, record }) =>
      ref.objectType === "InformationItem" && record.subtype === "MethodStatement" &&
      record.projectId === workspace.project.id && ref.objectId === record.id &&
      Number.isInteger(ref.version) && ref.version > 0 && ref.version === record.version
    );
  }
  const kinds = documentAuthoringSources[formId] ?? [];
  return workspace.items.filter((item) =>
    kinds.includes(item.machine) && item.record.projectId === workspace.project.id
  ).map((item) => ({ ref: recordRef(item), record: item.record }));
}

export function sourceSelectionForForm(sources: DocumentSource[], selectedId: string): DocumentSource | undefined {
  if (selectedId) return sources.find((item) => item.record.id === selectedId);
  // A single unambiguous candidate is safe to offer as a suggested default.
  return sources.length === 1 ? sources[0] : undefined;
}
