export type UUID=string;
export type RegisterId='01'|'02'|'03'|'04'|'05'|'06'|'07'|'08'|'09'|'10'|'11'|'12'|'13'|'14'|'15'|'16'|'17'|'18'|'19'|'20'|'21'|'22'|'23'|'24'|'25'|'26'|'27'|'28'|'29';
export type Priority='P1'|'P2'|'P3'|'P4';
export interface RegisterRecord{ id:UUID;registerId:RegisterId;projectId:UUID;contractId?:UUID;discipline?:string;locationId?:UUID;drawingIds?:UUID[];status:string;priority?:Priority;dueAt?:string;attachmentIds?:UUID[];relatedIssueIds?:UUID[];revision:number;auditLogId:UUID; }
export interface DocumentSnapshot{ id:UUID;formId:string;templateVersion:string;legalTemplateVersion?:string;projectId:UUID;sourceRecords:Array<{registerId:RegisterId;recordId:UUID;revision:number}>;renderedAt:string;renderHash:string;status:'draft'|'final'|'signed'|'superseded';docxFileId?:UUID;pdfFileId?:UUID;htmlFileId?:UUID; }
export interface SignatureRequirement{roleCode:string;legal:boolean;requiredWhen?:string;}