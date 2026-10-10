import type { CreationCapability, RecordDTO, WorkItem } from "./ui-contract";

export type PaymentMachine = "contract_boq" | "quantity_measurement" | "payment_claim";

export type PaymentCreateCapability = CreationCapability;

export type PaymentLabelKey =
  | "title" | "description" | "boq" | "measurements" | "claims"
  | "claimed" | "verified" | "blocked" | "recommended" | "approved" | "paid" | "disputed"
  | "status" | "commands" | "history" | "paymentRecords" | "loading" | "empty"
  | "error" | "retry" | "period" | "boqVersion" | "quantity" | "unit" | "currency"
  | "recordedAt" | "reference" | "kind" | "amount" | "partialPaymentNote" | "correctionNote"
  | "create" | "cancel" | "saveDraft" | "titleField" | "number" | "revision"
  | "amountClaimed" | "amountVerified" | "amountRecommended" | "amountApproved" | "amountPaid"
  | "cumulativePaid" | "blockedReasons" | "lineItems" | "eligibleVariation" | "retention"
  | "advanceRecovery" | "otherDeduction" | "paymentReference" | "paymentDate"
  | "effectiveFrom" | "periodStart" | "periodEnd" | "createUnavailable"
  | "tableDescription" | "rate" | "contractAmount" | "draftBoundary" | "selectToInspect"
  | "noCommands" | "backToList" | "closeDialog" | "offlineSave" | "mockSave" | "requiredFields" | "saving" | "sourceVersion"
  | "recordPayment" | "recordCorrection" | "recordCancellation" | "ownerDecision" | "decisionReason" | "decisionReference" | "recommendedSnapshot"
  | "formula" | "rounding" | "reservation" | "paymentEvidence" | "calculationBoundary";

export const paymentLabelKeys: readonly PaymentLabelKey[] = [
  "title", "description", "boq", "measurements", "claims", "claimed", "verified", "blocked",
  "recommended", "approved", "paid", "disputed", "status", "commands", "history",
  "paymentRecords", "loading", "empty", "error", "retry", "period", "boqVersion", "quantity",
  "unit", "currency", "recordedAt", "reference", "kind", "amount", "partialPaymentNote",
  "correctionNote", "create", "cancel", "saveDraft", "titleField", "number", "revision",
  "amountClaimed", "amountVerified", "amountRecommended", "amountApproved", "amountPaid",
  "cumulativePaid", "blockedReasons", "lineItems", "eligibleVariation", "retention",
  "advanceRecovery", "otherDeduction", "paymentReference", "paymentDate",
  "effectiveFrom", "periodStart", "periodEnd", "createUnavailable", "tableDescription", "rate",
  "contractAmount", "draftBoundary", "selectToInspect", "noCommands", "backToList", "closeDialog",
  "offlineSave", "mockSave", "requiredFields", "saving", "sourceVersion", "recordPayment", "recordCorrection", "recordCancellation",
  "ownerDecision", "decisionReason", "decisionReference", "recommendedSnapshot",
  "formula", "rounding", "reservation",
  "paymentEvidence",
  "calculationBoundary",
];

export const paymentFallbackLabels: Record<PaymentLabelKey, string> = {
  calculationBoundary: "화면은 원본 값과 업무 시스템이 제공한 업무 처리를 표시합니다. 단계 사이의 수량·금액은 서로 합치거나 다시 계산하지 않습니다.",
  title: "물량 · 기성 · 지급", description: "계약내역서 기준, 현장 물량 검증, 지급추천, 발주처 결정과 실제 지급 이력을 연결합니다.",
  boq: "계약내역서", measurements: "물량 측정", claims: "기성 신청", claimed: "청구", verified: "검증",
  blocked: "보류", recommended: "감리 추천", approved: "발주처 승인", paid: "지급", disputed: "분쟁",
  status: "상태", commands: "업무 시스템 제공 업무 처리", history: "지급 기록 이력", paymentRecords: "개별 지급 기록",
  loading: "업무 시스템에서 물량 · 기성 자료를 불러오는 중입니다.", empty: "표시할 원본 기록이 없습니다.",
  error: "자료를 불러오지 못했습니다.", retry: "다시 불러오기", period: "기간", boqVersion: "계약내역서 작성 차수",
  quantity: "수량", unit: "단위", currency: "통화", recordedAt: "기록 시각", reference: "외부 참조",
  kind: "종류", amount: "금액", partialPaymentNote: "부분지급은 각각 별도 기록으로 보존됩니다.",
  correctionNote: "정정·취소는 기존 지급 기록을 유지하고 연결된 새 기록으로 표시됩니다.",
  create: "기록 추가", cancel: "취소", saveDraft: "초안 저장", titleField: "제목", number: "번호",
  revision: "리비전", amountClaimed: "청구액", amountVerified: "검증액", amountRecommended: "추천액",
  amountApproved: "승인액", amountPaid: "지급액", cumulativePaid: "누계 지급", blockedReasons: "보류 사유",
  lineItems: "계약내역 항목", eligibleVariation: "승인 설계변경", retention: "유보금", advanceRecovery: "선급금 상계",
  otherDeduction: "기타 공제", paymentReference: "지급 참조", paymentDate: "지급일",
  effectiveFrom: "적용 시작일", periodStart: "시작일", periodEnd: "종료일",
  createUnavailable: "업무 시스템이 현재 역할과 범위에서 초안 작성을 허용하지 않았습니다.",
  tableDescription: "설명", rate: "단가", contractAmount: "계약 금액",
  draftBoundary: "초안은 업무 시스템에 저장됩니다. 검증, 추천, 승인 및 지급은 업무 시스템이 반환한 업무 처리과 권한으로만 진행됩니다.",
  selectToInspect: "목록에서 원본을 선택하면 업무 시스템 저장값, 금액 단계와 사용 가능한 업무 처리를 확인할 수 있습니다.",
  noCommands: "현재 역할에서 사용할 수 있는 업무 처리가 없습니다.", backToList: "목록", closeDialog: "닫기",
  offlineSave: "연결 복구 후 다시 저장하십시오.", mockSave: "화면 미리보기에서는 초안을 저장하지 않습니다.",
  requiredFields: "제목과 번호를 입력하십시오.", saving: "저장 중…",
  sourceVersion: "원본",
  recordPayment: "지급", recordCorrection: "정정", recordCancellation: "취소",
  ownerDecision: "발주처 결정", decisionReason: "조정 사유", decisionReference: "결정 참조", recommendedSnapshot: "감리 추천 확인 당시 기록",
  formula: "계산 규칙", rounding: "반올림 규칙", reservation: "유보 의견",
  paymentEvidence: "지급 증빙",
};

export function paymentRecordData(item: WorkItem): Record<string, unknown> {
  const record = item.record as RecordDTO & { boq?: Record<string, unknown> };
  return object(item.machine === "contract_boq" ? record.boq : record.data);
}

export function paymentItems(items: WorkItem[], machine?: PaymentMachine): WorkItem[] {
  return items.filter((item) =>
    (item.machine === "contract_boq" || item.machine === "quantity_measurement" || item.machine === "payment_claim")
    && (!machine || item.machine === machine),
  );
}

export function paymentText(value: unknown, empty = "—"): string {
  if (value === undefined || value === null || value === "") return empty;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map((item) => paymentText(item)).join(" · ") : empty;
  if (typeof value === "object") {
    const ref = value as Record<string, unknown>;
    if (typeof ref.objectId === "string") return `${String(ref.objectType || "Object")} · ${ref.objectId} · v${paymentText(ref.version, "?")}`;
    return JSON.stringify(value);
  }
  return String(value);
}

export function paymentIdentity(item: WorkItem): string {
  const data = paymentRecordData(item);
  return paymentText(data.paymentClaimNo ?? data.measurementNo ?? data.boqNo ?? item.record.title ?? item.record.id);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
