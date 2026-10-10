import type { DomainRef, WorkItem, Workspace } from "./ui-contract";
import { recordReference } from "./record-reference";

export type CompletionMachine = "commissioning_package" | "handover_package" | "warranty_claim";

export type CompletionLabelKey =
  | "title" | "description" | "commissioning" | "handover" | "warranty"
  | "commissioningDescription" | "handoverDescription" | "warrantyDescription"
  | "create" | "saveDraft" | "cancel" | "titleField" | "number" | "system"
  | "status" | "readiness" | "commands" | "empty" | "version" | "period"
  | "profileRef" | "requirementRefs" | "inspectionRefs" | "drawingRef" | "testProcedureRefs"
  | "integratedTestRefs" | "materialReadinessRefs" | "equipmentReadinessRefs" | "calibrationRefs"
  | "utilityReadinessRefs" | "safetyPermitRefs" | "testWitnessPartyIds" | "correctionActionRefs"
  | "testResult" | "testHistory" | "outcome" | "criteriaMet" | "recordedAt" | "testResultRef"
  | "punchIssues" | "handoverReady" | "scope" | "scopeId" | "locationIds" | "assetRefs"
  | "commissioningRefs" | "asBuiltRefs" | "omManualRefs" | "trainingRefs" | "sparePartsRefs"
  | "certificateRefs" | "statutoryAcceptanceRefs" | "openIssueRefs" | "acceptedDocuments" | "submittedDocuments" | "acceptedScope"
  | "ownerAcceptance" | "handoverDate" | "reservations" | "reservationOwner" | "dueAt"
  | "partialScope" | "warrantyTrigger" | "handoverRef" | "warrantyPeriodRef" | "observedAt"
  | "defectScope" | "defectDescription" | "causeDescription" | "operationalImpact"
  | "issueRef" | "actionRefs" | "responseDueAt" | "remedySummary" | "reworkReason"
  | "remedyEvidence" | "reinspectionRef" | "reinspectionHistory" | "closureEvidence"
  | "closeout" | "reference" | "selectReference" | "noReferences" | "serverBoundary"
  | "offlineSave" | "mockSave" | "requiredFields" | "saving" | "sourceVersion"
  | "notSet" | "yes" | "no" | "backToList" | "noCommands" | "createUnavailable" | "closeDialog" | "requiredHandoverScope"
  | "retestPreserved" | "partialHandoverBoundary" | "warrantyClosureBoundary"
  | "profileRequired" | "profileScopeNote" | "profileUnavailable" | "warrantyRequiredFields" | "evidenceRefs" | "error"
  | "commandAvailable" | "commandBlocked" | "readinessReady" | "readinessNotReady"
  | "submittedIssueRefs" | "currentIssueRefs" | "currentOpenIssueRefs" | "issueReferenceRefreshHistory"
  | "currentPunchIssueRefs" | "currentCorrectionActionRefs" | "punchReferenceRefreshHistory"
  | "currentIssueRef" | "currentActionRefs" | "remedyReferenceRefreshHistory" | "referenceRefreshPrior" | "referenceRefreshCurrent";

export const completionLabelKeys: readonly CompletionLabelKey[] = [
  "title", "description", "commissioning", "handover", "warranty", "commissioningDescription",
  "handoverDescription", "warrantyDescription", "create", "saveDraft", "cancel", "titleField", "number",
  "system", "status", "readiness", "commands", "empty", "version", "period", "profileRef", "requirementRefs",
  "inspectionRefs", "drawingRef", "testProcedureRefs", "integratedTestRefs", "materialReadinessRefs", "equipmentReadinessRefs",
  "calibrationRefs", "utilityReadinessRefs", "safetyPermitRefs", "testWitnessPartyIds", "correctionActionRefs",
  "testResult", "testHistory", "outcome", "criteriaMet",
  "recordedAt", "testResultRef", "punchIssues", "handoverReady", "scope", "scopeId", "locationIds", "assetRefs",
  "commissioningRefs", "asBuiltRefs", "omManualRefs", "trainingRefs", "sparePartsRefs", "certificateRefs",
  "statutoryAcceptanceRefs", "openIssueRefs", "acceptedDocuments", "submittedDocuments", "acceptedScope", "ownerAcceptance", "handoverDate", "reservations",
  "reservationOwner", "dueAt", "partialScope", "warrantyTrigger", "handoverRef", "warrantyPeriodRef", "observedAt",
  "defectScope", "defectDescription", "causeDescription", "operationalImpact", "issueRef", "actionRefs",
  "responseDueAt", "remedySummary", "reworkReason", "remedyEvidence", "reinspectionRef", "reinspectionHistory",
  "closureEvidence", "closeout", "reference", "selectReference", "noReferences", "serverBoundary", "offlineSave",
  "mockSave", "requiredFields", "saving", "sourceVersion", "notSet", "yes", "no", "backToList", "noCommands",
  "createUnavailable", "closeDialog", "requiredHandoverScope", "retestPreserved", "partialHandoverBoundary", "warrantyClosureBoundary",
  "profileRequired", "profileScopeNote", "profileUnavailable", "warrantyRequiredFields", "evidenceRefs", "error",
  "commandAvailable", "commandBlocked",
  "readinessReady", "readinessNotReady", "submittedIssueRefs", "currentIssueRefs", "currentOpenIssueRefs",
  "issueReferenceRefreshHistory", "currentPunchIssueRefs", "currentCorrectionActionRefs", "punchReferenceRefreshHistory",
  "currentIssueRef", "currentActionRefs", "remedyReferenceRefreshHistory", "referenceRefreshPrior", "referenceRefreshCurrent",
];

export const completionFallbackLabels: Record<CompletionLabelKey, string> = {
  title: "시운전 · 인수 · 하자", description: "시운전 시험, 발주처 인수와 보증기간 하자조치를 각각 별도 원본으로 관리합니다.",
  commissioning: "시운전", handover: "인수 패키지", warranty: "보증 하자",
  commissioningDescription: "시험결과와 재시험 이력을 유지하고 인수 준비 상태를 별도로 표시합니다.",
  handoverDescription: "인수 범위, 제출 문서, 발주처 수락, 유보사항과 부분인수 근거를 표시합니다.",
  warrantyDescription: "보증 하자, 시정조치, 재검측 및 종결 증빙을 추적합니다.",
  create: "기록 추가", saveDraft: "초안 저장", cancel: "취소", titleField: "제목", number: "번호", system: "시스템",
  status: "상태", readiness: "준비 상태", commands: "서버 제공 명령", empty: "표시할 원본 기록이 없습니다.",
  version: "원본 버전", period: "기간", profileRef: "적용 프로파일 참조", requirementRefs: "요구사항 참조",
  inspectionRefs: "선행 검측 참조", drawingRef: "도면 참조", testProcedureRefs: "시험 절차 참조", integratedTestRefs: "통합시험 참조",
  materialReadinessRefs: "자재 준비 참조", equipmentReadinessRefs: "장비 준비 참조", calibrationRefs: "교정 참조",
  utilityReadinessRefs: "유틸리티 준비 참조", safetyPermitRefs: "안전 허가 참조", testWitnessPartyIds: "입회자",
  correctionActionRefs: "시정 조치 참조", testResult: "최신 시험 결과",
  testHistory: "시험 결과 이력", outcome: "결과", criteriaMet: "합격기준 충족", recordedAt: "기록 시각", testResultRef: "시험 증빙 참조",
  punchIssues: "Punch 이슈", handoverReady: "인수 준비", scope: "인수 범위", scopeId: "범위 ID", locationIds: "위치",
  assetRefs: "자산 참조", commissioningRefs: "시운전 패키지", asBuiltRefs: "준공도면", omManualRefs: "운영·유지보수 매뉴얼",
  trainingRefs: "교육 기록", sparePartsRefs: "예비품·공구", certificateRefs: "인증서", statutoryAcceptanceRefs: "법정 인수 기록",
  openIssueRefs: "미결 이슈", acceptedDocuments: "수락된 문서", submittedDocuments: "제출 문서", acceptedScope: "수락된 인수 범위", ownerAcceptance: "발주처 수락 참조", handoverDate: "인수일",
  reservations: "유보사항", reservationOwner: "유보 담당자", dueAt: "기한", partialScope: "부분인수 범위", warrantyTrigger: "보증 개시 조건",
  handoverRef: "인수 패키지 참조", warrantyPeriodRef: "보증기간 참조", observedAt: "발견 시각", defectScope: "하자 범위",
  defectDescription: "하자 설명", causeDescription: "원인 설명", operationalImpact: "운영 영향", issueRef: "연결 이슈",
  actionRefs: "시정 조치", responseDueAt: "응답 기한", remedySummary: "시정 요약", reworkReason: "재작업 사유",
  remedyEvidence: "시정 증빙", reinspectionRef: "재검측 참조", reinspectionHistory: "재검측 이력", closureEvidence: "종결 증빙",
  closeout: "종결 상태", reference: "정확한 원본 참조", selectReference: "원본 참조 선택", noReferences: "선택할 원본 참조가 없습니다.",
  serverBoundary: "상태, 선행조건, 권한과 준비도는 서버가 결정합니다. 이 화면은 원본 기록과 사용 가능한 명령을 표시합니다.",
  offlineSave: "연결을 복구한 뒤 다시 저장하십시오.", mockSave: "UI Mock Preview에서는 공식 기록을 생성하지 않습니다.",
  requiredFields: "제목과 번호를 입력하십시오.", saving: "저장 중…", sourceVersion: "원본", notSet: "미기록", yes: "예", no: "아니오",
  backToList: "목록", noCommands: "현재 역할에서 사용할 수 있는 명령이 없습니다.",
  createUnavailable: "서버가 현재 역할과 범위에서 초안 생성을 허용하지 않았습니다.", closeDialog: "닫기",
  requiredHandoverScope: "범위 ID, 시스템, 위치를 선택하십시오.",
  profileRequired: "서버가 요구하는 적용 프로파일을 선택하십시오.",
  profileScopeNote: "정확한 활성 요구사항과 적용 범위는 서버에서 검증합니다.",
  profileUnavailable: "이 범위에서 사용할 수 있는 적용 프로파일 참조가 워크스페이스에 없습니다.",
  warrantyRequiredFields: "인수 참조, 발견 시각, 하자 범위, 설명·원인·운영 영향과 연결 이슈를 입력하십시오.",
  evidenceRefs: "근거 증빙",
  error: "요청을 완료하지 못했습니다. 입력값과 선행조건을 확인하십시오.",
  commandAvailable: "실행 가능", commandBlocked: "선행조건 대기",
  readinessReady: "준비 완료", readinessNotReady: "준비 미완료",
  submittedIssueRefs: "제출 당시 이슈 참조", currentIssueRefs: "현재 이슈 참조", currentOpenIssueRefs: "현재 미결 이슈 참조",
  issueReferenceRefreshHistory: "이슈 참조 갱신 이력", currentPunchIssueRefs: "현재 잔여 이슈 참조",
  currentCorrectionActionRefs: "현재 시정조치 참조", punchReferenceRefreshHistory: "잔여 이슈 참조 갱신 이력",
  currentIssueRef: "현재 연결 이슈 참조", currentActionRefs: "현재 시정조치 참조",
  remedyReferenceRefreshHistory: "보수 참조 갱신 이력", referenceRefreshPrior: "이전 참조", referenceRefreshCurrent: "갱신 참조",
  retestPreserved: "재시험 후에도 실패한 시험결과는 이력에 유지됩니다.",
  partialHandoverBoundary: "부분인수는 정확한 인수 범위와 미결 유보사항을 그대로 유지합니다.",
  warrantyClosureBoundary: "보증 하자 종결은 인수와 별도이며 서버 제공 명령으로만 처리합니다.",
};

export interface CompletionReferenceOption {
  ref: DomainRef;
  label: string;
  status?: string;
  subtype?: string;
}

export function completionItems(items: WorkItem[], machine?: CompletionMachine): WorkItem[] {
  return items.filter((item) => isCompletionMachine(item.machine) && (!machine || item.machine === machine));
}

export function completionData(item: WorkItem): Record<string, unknown> {
  const value = item.record.data;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function completionIdentity(item: WorkItem): string {
  const data = completionData(item);
  return String(data.commissioningNo ?? data.handoverNo ?? data.claimNo ?? item.record.title ?? item.record.id);
}

export function completionReferenceOptions(workspace: Workspace): CompletionReferenceOption[] {
  const refs = new Map<string, CompletionReferenceOption>();
  function add(ref: unknown, hint?: string, catalogRecord?: Record<string, unknown>) {
    if (!isDomainRef(ref)) return;
    const key = `${ref.objectType}:${ref.objectId}:${ref.version}`;
    if (refs.has(key)) return;
    const source = workspace.items.find((item) => item.record.id === ref.objectId);
    const title = source?.record.title || source?.record.workName || hint;
    refs.set(key, {
      ref,
      label: `${title ? `${title} · ` : ""}${ref.objectType} · ${ref.objectId} · v${ref.version}`,
      ...(source?.record.status ? { status: source.record.status } : typeof catalogRecord?.status === "string" ? { status: catalogRecord.status } : {}),
      ...(source?.record.subtype ? { subtype: source.record.subtype } : typeof catalogRecord?.subtype === "string" ? { subtype: catalogRecord.subtype } : {}),
    });
  }
  const referenceCatalog = workspace.context.referenceCatalog as typeof workspace.context.referenceCatalog & {
    evidence?: Array<{ ref: DomainRef; record: Record<string, unknown> }>;
  };
  for (const entry of [...(referenceCatalog?.requirements || []), ...(referenceCatalog?.assets || []), ...(referenceCatalog?.evidence || []), ...(referenceCatalog?.informationItems || []), ...(referenceCatalog?.inspections || []), ...(referenceCatalog?.decisions || []), ...(referenceCatalog?.issues || []), ...(referenceCatalog?.actions || [])]) {
    add(entry.ref, typeof entry.record.title === "string" ? entry.record.title : undefined, entry.record);
  }
  workspace.items.forEach((item) => {
    add(recordReference(item), item.record.title);
    if (item.machine === "requirement") {
      add({ objectType: "Requirement", objectId: item.record.id, version: item.record.version }, item.record.title);
    }
  });
  return Array.from(refs.values());
}

/** Exact visible decisions for the currently selected target version. */
export function completionDecisionReferenceOptions(workspace: Workspace, target: WorkItem): CompletionReferenceOption[] {
  const records = new Map<string, Record<string, unknown>>();
  for (const entry of workspace.context.referenceCatalog?.decisions ?? []) records.set(entry.ref.objectId, entry.record);
  for (const item of workspace.items) if (item.machine === "decision") records.set(item.record.id, item.record);
  return completionReferenceOptions(workspace).filter(option => {
    const ref = records.get(option.ref.objectId)?.targetRef;
    return option.ref.objectType === "Decision" && isDomainRef(ref) && ref.objectId === target.record.id && ref.version === target.record.version;
  });
}

export function completionProfileOptions(
  workspace: Workspace,
  options: CompletionReferenceOption[],
  ruleKey: "commissioningProfile" | "handoverProfile" | "warrantyPeriod",
): CompletionReferenceOption[] {
  const scope = workspace.context.scope;
  const catalog = workspace.context.referenceCatalog?.requirements || [];
  return options.filter((option) => {
    if (option.ref.objectType !== "Requirement") return false;
    const exact = catalog.find((entry) => entry.ref.objectId === option.ref.objectId && entry.ref.version === option.ref.version);
    if (!exact) return false;
    const record = exact.record as Record<string, unknown>;
    const applicability = record.applicability;
    const rule = applicability && typeof applicability === "object" ? (applicability as Record<string, unknown>)[ruleKey] : undefined;
    return record.status === "active"
      && record.packageId === scope.packageId
      && record.locationId === scope.locationId
      && record.discipline === scope.discipline
      && Boolean(rule && typeof rule === "object" && !Array.isArray(rule));
  });
}

export function completionText(value: unknown, empty = "—"): string {
  if (value === undefined || value === null || value === "") return empty;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map((item) => completionText(item)).join(" · ") : empty;
  if (typeof value === "object") {
    const ref = value as Record<string, unknown>;
    if (isDomainRef(ref)) return `${ref.objectType} · ${ref.objectId.slice(0, 8)} · v${ref.version}`;
    return JSON.stringify(value);
  }
  return String(value);
}

export function isDomainRef(value: unknown): value is DomainRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return typeof ref.objectType === "string" && typeof ref.objectId === "string" && typeof ref.version === "number";
}

function isCompletionMachine(value: string): value is CompletionMachine {
  return value === "commissioning_package" || value === "handover_package" || value === "warranty_claim";
}
