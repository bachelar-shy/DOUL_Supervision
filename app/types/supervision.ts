export type UUID = string;
export type RegisterId='01'|'02'|'03'|'04'|'05'|'06'|'07'|'08'|'09'|'10'|'11'|'12'|'13'|'14'|'15'|'16'|'17'|'18'|'19'|'20'|'21'|'22'|'23'|'24'|'25'|'26'|'27'|'28'|'29';
export type Priority='P1'|'P2'|'P3'|'P4';
export type ActorGroup='SUP'|'ADM'|'CON'|'OWN'|'DES'|'SYS';
export type DomainObjectKind='Project'|'Party'|'RoleAssignment'|'Requirement'|'Location'|'Asset'|'InformationItem'|'Evidence'|'WorkItem'|'Inspection'|'Observation'|'Issue'|'Action'|'Decision'|'Approval';

export interface VersionedEntity { id:UUID; projectId:UUID; version:number; createdAt:string; updatedAt:string; }
export interface RoleAssignment extends VersionedEntity { partyId:UUID; organizationId:UUID; actorGroup:ActorGroup; roleCode:string; authorityCodes:string[]; validFrom?:string; validTo?:string; }
export interface Evidence extends VersionedEntity { sourceType:'original'|'derived'; originalEvidenceId?:UUID; fileId:UUID; fileHash:string; locationId?:UUID; assetId?:UUID; drawingId?:UUID; drawingRevision?:string; capturedAt?:string; createdBy:UUID; }
export interface Observation extends VersionedEntity { source:'supervisor'|'contractor'|'owner'|'ai'; status:'candidate'|'under_review'|'confirmed'|'rejected'; evidenceIds:UUID[]; locationId?:UUID; confirmedBy?:UUID; }
export interface Inspection extends VersionedEntity { status:'draft'|'requested'|'completeness_review'|'scheduled'|'in_progress'|'result_pending'|'passed'|'conditional'|'failed'|'hold'|'completed'; requirementIds:UUID[]; evidenceIds:UUID[]; locationId?:UUID; assetIds?:UUID[]; relatedIssueId?:UUID; previousInspectionId?:UUID; }
export interface Issue extends VersionedEntity { issueType:'defect'|'ncr'|'safety'|'environmental'|'material'|'fire'|'punch'|'schedule'|'design'; status:'open'|'assigned'|'in_progress'|'ready_for_recheck'|'reinspection'|'rework_required'|'closed'|'cancelled'|'superseded'; observationIds:UUID[]; actionIds:UUID[]; closureEvidenceIds?:UUID[]; closedBy?:UUID; }
export interface RegisterRecord { id:UUID; registerId:RegisterId; projectId:UUID; contractId?:UUID; discipline?:string; locationId?:UUID; drawingIds?:UUID[]; status:string; priority?:Priority; dueAt?:string; attachmentIds?:UUID[]; relatedIssueIds?:UUID[]; sourceDomainObjectIds?:UUID[]; revision:number; auditLogId:UUID; }
export interface DocumentSnapshot { id:UUID; formId:string; templateVersion:string; legalTemplateVersion?:string; projectId:UUID; sourceRecords:Array<{registerId:RegisterId;recordId:UUID;revision:number}>; renderedAt:string; renderHash:string; status:'draft'|'final'|'signed'|'superseded'; docxFileId?:UUID; pdfFileId?:UUID; htmlFileId?:UUID; }
export interface SignatureRequirement { roleCode:string; legal:boolean; requiredWhen?:string; }
