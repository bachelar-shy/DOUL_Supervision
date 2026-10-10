import { recordVersionLabel } from "../../labels";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DomainRef, RecordDTO, WorkItem, Workspace } from "../../data/ui-contract";
import { ApiError, type SupervisionClient } from "../../data/supervision-client";
import { listDrawingPdfBindings, listDrawingRevisions, type DrawingPdfBinding, type DrawingRevisionOption } from "../../data/drawing-pdf-binding-client";
import {
  commandDrawingFieldRevision,
  getDrawingFieldHistory,
  listDrawingFieldRevisions,
  registerDrawingFieldRevision,
  type DrawingFieldCommand,
  type DrawingFieldRegistrationInput,
  type DrawingFieldRevision,
} from "../../data/drawing-field-client";
import { ActionButton, Panel, SectionHeader } from "../../ui";
import "./drawing-field-management.css";
import { DrawingImpactPanel } from "./DrawingImpactPanel";
import { formatDateTime } from "../../i18n/format";
import { commands, reasonLabel, states } from "../../labels";

type Locale = "ko" | "vi" | "en";

const copy: Record<Locale, Record<string, string>> = {
  ko: {
    title: "현장 도면 관리", summary: "등록 · 승인 · 배포 · 수령 · 구본 회수",
    help: "도면번호와 개정은 현장 관리 기록에 직접 입력합니다. 제목에서 번호를 자동 추정하지 않습니다. 이 화면은 승인이나 변경 요청을 생성하거나 승인하지 않습니다.",
    registerTitle: "현장 도면 개정본 등록", binding: "연결된 PDF 도면", selectBinding: "도면과 PDF 연결 선택",
    noBinding: "아직 PDF와 연결된 도면 원본이 없습니다. 먼저 도면 원본을 등록하고 검토 요청을 보내십시오.",
    registerSource: "도면 원본 등록으로 이동", drawingNumber: "도면번호", revision: "개정", purpose: "용도",
    construction: "시공용", review: "검토용", information: "참고용", approval: "연결 승인", noApproval: "승인 없이 등록",
    approved: "승인됨", technicalReview: "기술 검토 중", approvalSource: "승인 원본", serverRechecks: "현장 사용 가능 여부는 업무 시스템이 다시 확인합니다.",
    recipients: "필수 수령자", changeRequestsOptional: "연결 변경 요청 (선택, 기본 없음)", noChanges: "현재 연결할 수 있는 변경 요청이 없습니다.",
    supersedes: "대체하는 기존 개정본 (선택)", none: "없음", linkedChangeCount: "변경 요청 {{count}}건을 현재 원본 작성 차수로 연결합니다. 후속 수정은 새 현장 도면 기록으로 관리합니다.",
    register: "현장 도면 기록 등록", noPermission: "현재 역할에서는 등록할 수 없습니다.",
    statusTitle: "현장 도면 상태", statusSummary: "업무 시스템 상태와 실행 가능한 작업", loading: "현장 도면 기록을 조회하고 있습니다…",
    noRecords: "등록된 현장 도면 기록이 없습니다.", fieldUse: "현장 사용", inUse: "현장 사용 중", blocked: "차단됨", available: "가능",
    drawing: "도면", pdf: "PDF", bindingRecord: "PDF 연결", approvalLabel: "승인", changeRequestLabel: "변경 요청",
    noPredecessor: "선행 개정 없음", current: "최신", oldVersion: "구작성 차수", distributionComplete: "모든 필수 수령자가 수령 확인",
    distributionIncomplete: "배포/수령 미완료", obsoleteCopiesWaiting: "구본 회수 대기 · {{count}}부", obsoleteCopiesLabel: "구본 회수",
    copiesOutstanding: "회수되지 않은 구본이 있습니다", noOutstandingCopies: "미회수 구본 없음", requiredRecipients: "필수 수령자",
    distributionReceipt: "배포 및 수령", notDistributed: "미배포", receiptConfirmed: "수령 확인", receiptPending: "수령 대기",
    distributedAt: "배포", receivedAt: "수령", returnedAt: "구본 회수", chooseRecipients: "배포 대상 선택",
    reason: "사유", currentApproval: "현재 기술 승인", noBasis: "승인 근거 없음", currentChangeBasis: "현재 변경 요청 근거",
    noChangeBasis: "연결할 변경 요청 없음", impacts: "영향 업무 보기", history: "변경 이력 보기", historyLoading: "이력을 조회하고 있습니다…",
    noTime: "시간 미확인", operator: "처리자", unknown: "확인할 수 없음", changedStatus: "변경 후 상태", cause: "사유", noHistory: "이력이 없습니다.",
    confirmSuffix: "확인", confirmCommand: "{{command}} 확인", recordVersion: "기록", sourceDrawing: "도면 원본", releaseCheck: "업무 시스템이 승인, 변경 요청, 도면 최신본 여부와 배포/수령 상태를 확인합니다. 이 확인은 승인을 새로 만들지 않습니다.",
    distributeBoundary: "배포 기록을 남깁니다. 배포만으로 수령 처리되지 않습니다.", acknowledgeBoundary: "현재 사용자 본인의 수령 확인을 기록합니다.", approvalBasis: "승인 근거", changeBasis: "변경 근거",
    confirmRequest: "확인하고 요청", cancel: "취소", statusUnknown: "상태 미확인", status: "상태", sourceVersion: "도면 v", pdfVersion: "PDF 작성 차수 ",
    errAdminOnly: "등록은 현장 관리자 데모 세션에서 할 수 있습니다.", errRequired: "PDF 도면, 도면번호, 개정, 필수 수령자를 지정하십시오.",
    errMissingDrawing: "연결된 원본 도면이 현장의 현재 도면 목록에 없습니다.", errDuplicate: "같은 도면번호와 개정의 현장 관리 기록이 이미 있습니다.",
    errApprovalChanged: "선택한 승인 근거가 변경되었습니다. 현재 승인을 다시 선택하십시오.", errPrepare: "등록 요청을 준비하지 못했습니다. 다시 시도하십시오.",
    errSelectRecipients: "배포할 수령자를 선택하십시오.", errEnterReason: "처리 사유를 입력하십시오.", errSelectApproval: "이 도면의 현재 기술 승인을 워크스페이스에서 선택하십시오.",
    errChangeVersion: "변경 요청 작성 차수가 갱신되었습니다. 현재 변경 요청을 다시 선택하십시오.", errGeneric: "요청을 처리하지 못했습니다. 다시 시도하십시오.",
    reason_APPROVAL_MISSING: "기술 승인을 연결하십시오", reason_APPROVAL_STALE: "승인 기록 작성 차수가 바뀌었습니다",
    reason_APPROVAL_NOT_CURRENT_TECHNICAL: "현재 도면을 대상으로 한 승인된 기술 승인이 필요합니다", reason_APPROVAL_EXPIRED: "승인 유효기간이 지났습니다",
    reason_APPROVAL_INVALID: "승인 상태를 확인할 수 없습니다", reason_SOURCE_STALE: "도면 또는 PDF 원본이 최신 작성 차수가 아닙니다",
    reason_CHANGE_REF_INVALID: "변경 요청 참조를 확인할 수 없습니다", reason_CHANGE_STALE: "변경 요청 기록 작성 차수가 바뀌었습니다",
    reason_CHANGE_NOT_APPROVED: "연결된 변경 요청이 승인되지 않았습니다", reason_CHANGE_TARGET_MISMATCH: "변경 요청이 이 도면을 대상으로 하지 않습니다",
    reason_CHANGE_APPROVAL_INVALID: "변경 요청의 승인 상태를 확인할 수 없습니다", reason_CHANGE_INVALID: "변경 요청 근거를 확인할 수 없습니다",
    reason_DISTRIBUTION_INCOMPLETE: "필수 수령자 전원의 배포와 수령 확인이 필요합니다", reason_NOT_FOR_CONSTRUCTION: "시공용 도면으로 등록해야 현장 사용본을 발행할 수 있습니다",
    status_registered: "등록됨", status_released: "배포 승인", status_superseded: "구본", status_withdrawn: "철회됨",
    command_release: "현장 사용본 발행", command_distribute: "배포 기록", command_acknowledge: "수령 확인", command_return_copy: "구본 회수 확인", command_withdraw: "철회", command_update_basis: "승인 근거 갱신",
    event_registered: "현장 도면 기록 등록", event_superseded: "후속 개정본으로 대체", event_default: "도면 관리 변경",
    created: "현장 도면 기록 {{id}} · 제{{version}}차을 등록했습니다.", actionDone: "{{command}} 요청을 처리했습니다. 현재 상태: {{status}} · 제{{version}}차.",
  },
  vi: {
    title: "Quản lý bản vẽ tại công trường", summary: "Đăng ký · phê duyệt · phân phối · xác nhận nhận · thu hồi bản cũ",
    help: "Nhập trực tiếp số và phiên bản bản vẽ vào hồ sơ quản lý công trường. Không tự suy ra số từ tiêu đề. Màn hình này không tạo hoặc phê duyệt Approval hay yêu cầu thay đổi.",
    registerTitle: "Đăng ký phiên bản bản vẽ công trường", binding: "Bản vẽ PDF được liên kết", selectBinding: "Chọn liên kết bản vẽ và PDF",
    noBinding: "Chưa có bản vẽ nguồn liên kết với PDF. Trước tiên hãy đăng ký bản vẽ nguồn và gửi yêu cầu xem xét.",
    registerSource: "Mở đăng ký bản vẽ nguồn", drawingNumber: "Số bản vẽ", revision: "Phiên bản", purpose: "Mục đích",
    construction: "Thi công", review: "Xem xét", information: "Tham khảo", approval: "Approval được liên kết", noApproval: "Đăng ký không cần Approval",
    approved: "Đã phê duyệt", technicalReview: "Đang xem xét kỹ thuật", approvalSource: "Approval nguồn", serverRechecks: "Máy chủ sẽ kiểm tra lại khả năng sử dụng tại công trường.",
    recipients: "Bên nhận bắt buộc", changeRequestsOptional: "Yêu cầu thay đổi liên kết (tùy chọn, mặc định không có)", noChanges: "Không có yêu cầu thay đổi hiện tại để liên kết.",
    supersedes: "Phiên bản cũ được thay thế (tùy chọn)", none: "Không có", linkedChangeCount: "Liên kết {{count}} yêu cầu thay đổi với phiên bản nguồn hiện tại. Các chỉnh sửa tiếp theo sẽ được quản lý bằng hồ sơ bản vẽ công trường mới.",
    register: "Đăng ký hồ sơ bản vẽ công trường", noPermission: "Vai trò hiện tại không được phép đăng ký.",
    statusTitle: "Trạng thái bản vẽ công trường", statusSummary: "Trạng thái và thao tác khả dụng từ máy chủ", loading: "Đang tải hồ sơ bản vẽ công trường…",
    noRecords: "Chưa có hồ sơ bản vẽ công trường nào được đăng ký.", fieldUse: "Sử dụng tại công trường", inUse: "Đang sử dụng tại công trường", blocked: "Bị chặn", available: "Có thể sử dụng",
    drawing: "Bản vẽ", pdf: "PDF", bindingRecord: "Liên kết PDF", approvalLabel: "Approval", changeRequestLabel: "Yêu cầu thay đổi",
    noPredecessor: "Không có phiên bản trước", current: "Mới nhất", oldVersion: "Phiên bản cũ", distributionComplete: "Tất cả bên nhận bắt buộc đã xác nhận nhận",
    distributionIncomplete: "Chưa hoàn tất phân phối/xác nhận nhận", obsoleteCopiesWaiting: "Đang chờ thu hồi bản cũ · {{count}} bản", obsoleteCopiesLabel: "Thu hồi bản cũ",
    copiesOutstanding: "Còn bản cũ chưa được thu hồi", noOutstandingCopies: "Không còn bản cũ chưa thu hồi", requiredRecipients: "Bên nhận bắt buộc",
    distributionReceipt: "Phân phối và xác nhận nhận", notDistributed: "Chưa phân phối", receiptConfirmed: "Đã xác nhận nhận", receiptPending: "Đang chờ xác nhận nhận",
    distributedAt: "Phân phối", receivedAt: "Đã nhận", returnedAt: "Thu hồi bản cũ", chooseRecipients: "Chọn bên nhận để phân phối",
    reason: "Lý do", currentApproval: "Approval kỹ thuật hiện tại", noBasis: "Không có căn cứ Approval", currentChangeBasis: "Căn cứ yêu cầu thay đổi hiện tại",
    noChangeBasis: "Không có yêu cầu thay đổi để liên kết", impacts: "Xem công việc bị ảnh hưởng", history: "Xem lịch sử thay đổi", historyLoading: "Đang tải lịch sử…",
    noTime: "Không rõ thời gian", operator: "Người xử lý", unknown: "Không xác định", changedStatus: "Trạng thái sau thay đổi", cause: "Lý do", noHistory: "Không có lịch sử.",
    confirmSuffix: "Xác nhận", confirmCommand: "Xác nhận {{command}}", recordVersion: "Hồ sơ", sourceDrawing: "Bản vẽ nguồn", releaseCheck: "Máy chủ kiểm tra Approval, yêu cầu thay đổi, phiên bản bản vẽ mới nhất và trạng thái phân phối/xác nhận nhận. Việc kiểm tra này không tạo Approval mới.",
    distributeBoundary: "Ghi nhận việc phân phối. Chỉ phân phối không đồng nghĩa với đã xác nhận nhận.", acknowledgeBoundary: "Ghi nhận xác nhận nhận của chính người dùng hiện tại.", approvalBasis: "Căn cứ Approval", changeBasis: "Căn cứ thay đổi",
    confirmRequest: "Xác nhận và gửi yêu cầu", cancel: "Hủy", statusUnknown: "Chưa rõ trạng thái", status: "Trạng thái", sourceVersion: "Bản vẽ v", pdfVersion: "PDF v",
    errAdminOnly: "Chỉ có thể đăng ký trong phiên demo của quản trị viên dự án.", errRequired: "Hãy chọn bản vẽ PDF, nhập số bản vẽ và phiên bản, đồng thời chọn bên nhận bắt buộc.",
    errMissingDrawing: "Bản vẽ nguồn được liên kết không nằm trong danh sách bản vẽ hiện tại của dự án.", errDuplicate: "Hồ sơ quản lý công trường cho cùng số bản vẽ và phiên bản đã tồn tại.",
    errApprovalChanged: "Căn cứ Approval đã chọn thay đổi. Hãy chọn lại Approval hiện tại.", errPrepare: "Không thể chuẩn bị yêu cầu đăng ký. Hãy thử lại.",
    errSelectRecipients: "Hãy chọn bên nhận để phân phối.", errEnterReason: "Hãy nhập lý do xử lý.", errSelectApproval: "Hãy chọn Approval kỹ thuật hiện tại của bản vẽ này trong không gian làm việc.",
    errChangeVersion: "Phiên bản yêu cầu thay đổi đã cập nhật. Hãy chọn lại yêu cầu hiện tại.", errGeneric: "Không thể xử lý yêu cầu. Hãy thử lại.",
    reason_APPROVAL_MISSING: "Hãy liên kết Approval kỹ thuật", reason_APPROVAL_STALE: "Phiên bản hồ sơ Approval đã thay đổi",
    reason_APPROVAL_NOT_CURRENT_TECHNICAL: "Cần Approval kỹ thuật đã được phê duyệt cho bản vẽ hiện tại", reason_APPROVAL_EXPIRED: "Approval đã hết hạn",
    reason_APPROVAL_INVALID: "Không thể xác minh trạng thái Approval", reason_SOURCE_STALE: "Bản vẽ hoặc PDF nguồn không phải phiên bản mới nhất",
    reason_CHANGE_REF_INVALID: "Không thể xác minh tham chiếu yêu cầu thay đổi", reason_CHANGE_STALE: "Phiên bản hồ sơ yêu cầu thay đổi đã thay đổi",
    reason_CHANGE_NOT_APPROVED: "Yêu cầu thay đổi được liên kết chưa được phê duyệt", reason_CHANGE_TARGET_MISMATCH: "Yêu cầu thay đổi không áp dụng cho bản vẽ này",
    reason_CHANGE_APPROVAL_INVALID: "Không thể xác minh trạng thái phê duyệt của yêu cầu thay đổi", reason_CHANGE_INVALID: "Không thể xác minh căn cứ yêu cầu thay đổi",
    reason_DISTRIBUTION_INCOMPLETE: "Tất cả bên nhận bắt buộc phải được phân phối và xác nhận nhận", reason_NOT_FOR_CONSTRUCTION: "Phải đăng ký bản vẽ cho mục đích thi công mới có thể phát hành bản dùng tại công trường",
    status_registered: "Đã đăng ký", status_released: "Đã phê duyệt phân phối", status_superseded: "Bản cũ", status_withdrawn: "Đã rút",
    command_release: "Phát hành bản dùng tại công trường", command_distribute: "Ghi nhận phân phối", command_acknowledge: "Xác nhận nhận", command_return_copy: "Xác nhận thu hồi bản cũ", command_withdraw: "Rút hồ sơ", command_update_basis: "Cập nhật căn cứ Approval",
    event_registered: "Đăng ký hồ sơ bản vẽ công trường", event_superseded: "Được thay thế bằng phiên bản mới", event_default: "Thay đổi quản lý bản vẽ",
    created: "Đã đăng ký hồ sơ bản vẽ công trường {{id}} · v{{version}}.", actionDone: "Đã xử lý yêu cầu {{command}}. Trạng thái hiện tại: {{status}} · v{{version}}.",
  },
  en: {
    title: "Field drawing management", summary: "Register · approve · distribute · acknowledge receipt · recover obsolete copies",
    help: "Enter the drawing number and revision directly in the field management record. The number is not inferred from the title. This view does not create or approve an Approval or Change Request.",
    registerTitle: "Register field drawing revision", binding: "Linked PDF drawing", selectBinding: "Select drawing and PDF binding",
    noBinding: "No source drawing is linked to a PDF yet. Register the source drawing and submit it for review first.",
    registerSource: "Open source drawing registration", drawingNumber: "Drawing number", revision: "Revision", purpose: "Purpose",
    construction: "For construction", review: "For review", information: "For information", approval: "Linked Approval", noApproval: "Register without Approval",
    approved: "Approved", technicalReview: "Technical review in progress", approvalSource: "Approval source", serverRechecks: "The server will recheck field-use eligibility.",
    recipients: "Required recipients", changeRequestsOptional: "Linked Change Requests (optional; none by default)", noChanges: "There are no current Change Requests available to link.",
    supersedes: "Existing revision superseded (optional)", none: "None", linkedChangeCount: "Linking {{count}} Change Requests to the current source versions. Later changes are managed as a new field drawing record.",
    register: "Register field drawing record", noPermission: "The current role cannot register a record.",
    statusTitle: "Field drawing status", statusSummary: "Server status and available actions", loading: "Loading field drawing records…",
    noRecords: "No field drawing records are registered.", fieldUse: "Field use", inUse: "In field use", blocked: "Blocked", available: "Available",
    drawing: "Drawing", pdf: "PDF", bindingRecord: "PDF binding", approvalLabel: "Approval", changeRequestLabel: "Change Request",
    noPredecessor: "No predecessor revision", current: "Current", oldVersion: "Outdated", distributionComplete: "All required recipients acknowledged receipt",
    distributionIncomplete: "Distribution or receipt is incomplete", obsoleteCopiesWaiting: "Obsolete copies awaiting recovery · {{count}}", obsoleteCopiesLabel: "Obsolete copy recovery",
    copiesOutstanding: "Obsolete copies remain outstanding", noOutstandingCopies: "No outstanding obsolete copies", requiredRecipients: "Required recipients",
    distributionReceipt: "Distribution and receipt", notDistributed: "Not distributed", receiptConfirmed: "Receipt acknowledged", receiptPending: "Awaiting receipt",
    distributedAt: "Distributed", receivedAt: "Received", returnedAt: "Obsolete copy returned", chooseRecipients: "Select recipients to distribute to",
    reason: "Reason", currentApproval: "Current technical Approval", noBasis: "No Approval basis", currentChangeBasis: "Current Change Request basis",
    noChangeBasis: "No Change Requests to link", impacts: "View impacted work", history: "View change history", historyLoading: "Loading history…",
    noTime: "Time unavailable", operator: "Actor", unknown: "Unknown", changedStatus: "Status after change", cause: "Reason", noHistory: "No history is available.",
    confirmSuffix: "confirmation", confirmCommand: "Confirm {{command}}", recordVersion: "Record", sourceDrawing: "Source drawing", releaseCheck: "The server checks Approval, Change Requests, whether the drawing source is current, and distribution/receipt status. This check does not create a new Approval.",
    distributeBoundary: "Records distribution. Distribution alone does not count as receipt.", acknowledgeBoundary: "Records receipt acknowledgment by the current user.", approvalBasis: "Approval basis", changeBasis: "Change basis",
    confirmRequest: "Confirm and submit", cancel: "Cancel", statusUnknown: "Status unavailable", status: "Status", sourceVersion: "Drawing v", pdfVersion: "PDF v",
    errAdminOnly: "Registration is available only in a project administrator demo session.", errRequired: "Select a PDF drawing, enter a drawing number and revision, and select at least one required recipient.",
    errMissingDrawing: "The linked source drawing is not in the project's current drawing list.", errDuplicate: "A field management record for this drawing number and revision already exists.",
    errApprovalChanged: "The selected Approval basis changed. Select the current Approval again.", errPrepare: "Could not prepare the registration request. Try again.",
    errSelectRecipients: "Select recipients for distribution.", errEnterReason: "Enter a reason for this action.", errSelectApproval: "Select the current technical Approval for this drawing from the workspace.",
    errChangeVersion: "A Change Request version was updated. Select the current request again.", errGeneric: "Could not complete the request. Try again.",
    reason_APPROVAL_MISSING: "Link a technical Approval", reason_APPROVAL_STALE: "The Approval record version changed",
    reason_APPROVAL_NOT_CURRENT_TECHNICAL: "An approved technical Approval for the current drawing is required", reason_APPROVAL_EXPIRED: "The Approval has expired",
    reason_APPROVAL_INVALID: "The Approval status could not be verified", reason_SOURCE_STALE: "The drawing or PDF source is not the latest version",
    reason_CHANGE_REF_INVALID: "The Change Request reference could not be verified", reason_CHANGE_STALE: "The Change Request record version changed",
    reason_CHANGE_NOT_APPROVED: "The linked Change Request is not approved", reason_CHANGE_TARGET_MISMATCH: "The Change Request does not target this drawing",
    reason_CHANGE_APPROVAL_INVALID: "The Change Request approval status could not be verified", reason_CHANGE_INVALID: "The Change Request basis could not be verified",
    reason_DISTRIBUTION_INCOMPLETE: "Every required recipient must receive the distribution and acknowledge receipt", reason_NOT_FOR_CONSTRUCTION: "Register the drawing for construction use before issuing it for field use",
    status_registered: "Registered", status_released: "Released for distribution", status_superseded: "Superseded", status_withdrawn: "Withdrawn",
    command_release: "Issue for field use", command_distribute: "Record distribution", command_acknowledge: "Acknowledge receipt", command_return_copy: "Confirm obsolete copy return", command_withdraw: "Withdraw", command_update_basis: "Update Approval basis",
    event_registered: "Field drawing record registered", event_superseded: "Superseded by a later revision", event_default: "Drawing management change",
    created: "Registered field drawing record {{id}} · v{{version}}.", actionDone: "Processed {{command}} request. Current status: {{status}} · v{{version}}.",
  },
};

const refKey = (ref: DomainRef) => `${ref.objectType}:${ref.objectId}:${ref.version}`;
const sameRef = (left: unknown, right: DomainRef | undefined): left is DomainRef => !!right && !!left
  && typeof left === "object" && (left as DomainRef).objectType === right.objectType
  && (left as DomainRef).objectId === right.objectId && (left as DomainRef).version === right.version;
const title = (record: RecordDTO): string => String(record.title || record.workName || record.name || record.subtype || record.id);
const refFor = (objectType: string, record: RecordDTO): DomainRef => ({ objectType, objectId: record.id, version: record.version });
const commandName = (command: DrawingFieldCommand) => command.command;
const lookup = (locale: Locale, key: string, options?: Record<string, unknown>) => {
  let value = copy[locale][key] || copy.en[key] || key;
  for (const [name, replacement] of Object.entries(options || {})) value = value.replaceAll(`{{${name}}}`, String(replacement));
  return value;
};
const refLabel = (ref: DomainRef | null, locale: Locale) => ref
  ? `${({ Approval: lookup(locale, "approvalLabel"), WorkItem: lookup(locale, "changeRequestLabel"), Evidence: lookup(locale, "pdf"), Drawing: lookup(locale, "drawing") } as Record<string, string>)[ref.objectType] || ref.objectType} · ${ref.objectId} · ${recordVersionLabel(ref.version)}`
  : lookup(locale, "none");
const statusText = (status: string, locale: Locale) => lookup(locale, `status_${status}`) === `status_${status}` ? states[status] || status : lookup(locale, `status_${status}`);
const statusValue = (status: unknown, locale: Locale) => typeof status === "string" ? statusText(status, locale) : lookup(locale, "statusUnknown");
const labelCommand = (command: DrawingFieldCommand, locale: Locale) => lookup(locale, `command_${command.command}`) === `command_${command.command}` ? commands[command.command] || command.command : lookup(locale, `command_${command.command}`);
const recordError = (cause: unknown, fallback: string) => cause instanceof ApiError ? `reason:${cause.detail.code}` : `error:${fallback}`;
const displayError = (value: string, locale: Locale) => value.startsWith("reason:")
  ? (copy[locale][`reason_${value.slice(7)}`] || reasonLabel(value.slice(7)))
  : value.startsWith("error:") ? lookup(locale, value.slice(6)) : value;
const isEligibleApproval = (item: WorkItem) => item.machine === "approval"
  && (String(item.record.status) === "approved" || String(item.record.status).includes("pending")
    || String(item.record.status) === "technical_review");
interface PendingAction {
  revisionId: string;
  command: string;
  expectedVersion: number;
  payload: Record<string, unknown>;
  key: string;
}

export function DrawingFieldManagementPanel({ client, workspace, onChanged, onOpenSourceRegistration, onSelect, onNavigate }: {
  client: SupervisionClient;
  workspace: Workspace;
  onChanged?: () => void | Promise<void>;
  onOpenSourceRegistration?: () => void;
  onSelect?: (id: string | null) => void;
  onNavigate?: (route: string) => void;
}) {
  const { i18n } = useTranslation();
  const selectedLocale = (i18n.resolvedLanguage ?? i18n.language).slice(0, 2);
  const locale: Locale = selectedLocale === "ko" || selectedLocale === "vi" ? selectedLocale : "en";
  const tx = (key: string, values?: Record<string, unknown>) => lookup(locale, key, values);
  const projectId = workspace.project.id;
  const session = client.session;
  const scopeKey = `${session?.projectId ?? ""}:${session?.actor.partyId ?? ""}:${session?.actor.roleAssignmentId ?? ""}:${projectId}:${workspace.role.id}:${workspace.role.actorGroup}:${workspace.demo}`;
  const [bindings, setBindings] = useState<DrawingPdfBinding[]>([]);
  const [drawings, setDrawings] = useState<DrawingRevisionOption[]>([]);
  const [revisions, setRevisions] = useState<DrawingFieldRevision[]>([]);
  const [loaded, setLoaded] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [bindingId, setBindingId] = useState("");
  const [drawingNo, setDrawingNo] = useState("");
  const [revision, setRevision] = useState("");
  const [issuedFor, setIssuedFor] = useState<DrawingFieldRegistrationInput["issuedFor"]>("construction");
  const [approvalKey, setApprovalKey] = useState("");
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [supersedesId, setSupersedesId] = useState("");
  const [changeRefs, setChangeRefs] = useState<DomainRef[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [distributionIds, setDistributionIds] = useState<string[]>([]);
  const [basisSelections, setBasisSelections] = useState<Record<string, { approvalRef: DomainRef | null; changeRefs: DomainRef[] }>>({});
  const [history, setHistory] = useState<Record<string, unknown>[] | null>(null);
  const [historyFor, setHistoryFor] = useState("");
  const [impactSelection, setImpactSelection] = useState<{ scope: string; ref: DomainRef } | null>(null);
  const registrationPending = useRef<{ body: string; key: string } | null>(null);
  const alive = useRef(true);
  const sequence = useRef(0);
  const activeScope = useRef(scopeKey);
  if (activeScope.current !== scopeKey) {
    activeScope.current = scopeKey;
    sequence.current += 1;
  }
  const admin = workspace.demo && workspace.role.actorGroup === "ADM" && workspace.role.roleCode === "project_admin"
    && session?.projectId === projectId && session.actor.actorGroup === "ADM"
    && session.actor.roleAssignmentId === workspace.role.id;
  const approvals = useMemo(() => workspace.items.filter(isEligibleApproval), [workspace.items]);
  const changes = useMemo(() => workspace.items.filter(item => item.machine === "change"
    && String(item.record.subtype || "") === "ChangeRequest"), [workspace.items]);
  const selectedBinding = bindings.find(row => row.id === bindingId);
  const bindingApprovals = useMemo(() => approvals.filter(item => {
    const kind = String(item.record.approvalKind || item.record.subtype || "").toLowerCase();
    return (kind === "technical" || kind.includes("technical")) && sameRef(item.record.targetRef, selectedBinding?.drawingRef);
  }), [approvals, selectedBinding]);
  const sameNumber = revisions.filter(row => row.drawingNo === drawingNo.trim());
  const predecessorOptions = sameNumber.filter(row => row.id !== supersedesId && row.status === "released");

  const refresh = useCallback(async () => {
    const scope = scopeKey;
    const requestSequence = ++sequence.current;
    const current = () => alive.current && activeScope.current === scope && sequence.current === requestSequence;
    if (!session || session.projectId !== projectId) {
      if (current()) { setRevisions([]); setBindings([]); setDrawings([]); setLoaded(scope); }
      return;
    }
    try {
      const [rows, bindingRows, drawingRows] = await Promise.all([
        listDrawingFieldRevisions(client, projectId),
        listDrawingPdfBindings(client, projectId),
        listDrawingRevisions(client, projectId),
      ]);
      if (!current()) return;
      setRevisions(rows);
      setBindings(bindingRows);
      setDrawings(drawingRows);
      setLoaded(scope);
      setBindingId(currentId => bindingRows.some(row => row.id === currentId) ? currentId : "");
      setError("");
    } catch (cause) {
      if (!current()) return;
      setRevisions([]);
      setBindings([]);
      setDrawings([]);
      setLoaded(scope);
      setError(recordError(cause, "errGeneric"));
    }
  }, [client, projectId, scopeKey]);

  useEffect(() => {
    alive.current = true;
    setBindings([]); setDrawings([]); setRevisions([]); setLoaded("");
    setError(""); setNotice(""); setPending(null); setHistory(null); setHistoryFor("");
    if (!session) setLoaded(scopeKey);
    return () => { alive.current = false; sequence.current += 1; };
  }, [scopeKey, refresh]);

  useEffect(() => { void refresh(); }, [workspace.items, refresh]);

  function toggleRecipient(id: string) {
    setRecipientIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  async function register() {
    setError(""); setNotice("");
    if (!admin) { setError("error:errAdminOnly"); return; }
    if (!selectedBinding || !drawingNo.trim() || !revision.trim() || recipientIds.length < 1) {
      setError("error:errRequired"); return;
    }
    const matchingDrawing = drawings.find(item => item.domainRef.objectId === selectedBinding.drawingRef.objectId
      && item.domainRef.version === selectedBinding.drawingRef.version);
    if (!matchingDrawing) { setError("error:errMissingDrawing"); return; }
    if (sameNumber.some(row => row.revision.toLocaleLowerCase() === revision.trim().toLocaleLowerCase())) {
      setError("error:errDuplicate"); return;
    }
    const selectedApproval = approvalKey ? bindingApprovals.find(item => item.record.id === approvalKey) : null;
    if (approvalKey && !selectedApproval) { setError("error:errApprovalChanged"); return; }
    const input: DrawingFieldRegistrationInput = {
      bindingId: selectedBinding.id,
      drawingNo: drawingNo.trim(),
      revision: revision.trim(),
      issuedFor,
      requiredRecipientPartyIds: [...new Set(recipientIds)],
      approvalRef: selectedApproval ? refFor("Approval", selectedApproval.record) : null,
      changeRefs: [...changeRefs],
      supersedesId: supersedesId || null,
    };
    const serializedInput = JSON.stringify({ projectId, input });
    if (!registrationPending.current || registrationPending.current.body !== serializedInput) {
      registrationPending.current = { body: serializedInput, key: crypto.randomUUID() };
    }
    const pendingRegistration = registrationPending.current;
    if (!pendingRegistration) { setError("error:errPrepare"); return; }
    const idempotencyKey = pendingRegistration.key;
    setBusy(true);
    try {
      const created = await registerDrawingFieldRevision(client, projectId, input, idempotencyKey);
      registrationPending.current = null;
      setNotice(tx("created", { id: created.id, version: created.version }));
      setDrawingNo(""); setRevision(""); setApprovalKey(""); setRecipientIds([]); setSupersedesId(""); setChangeRefs([]);
      await refresh();
      await onChanged?.();
    } catch (cause) { setError(recordError(cause, "errGeneric")); }
    finally { setBusy(false); }
  }

  function prepareAction(row: DrawingFieldRevision, item: DrawingFieldCommand) {
    const command = commandName(item);
    const payload: Record<string, unknown> = {};
    if (command === "distribute") {
      const selected = distributionIds.filter(id => row.requiredRecipientPartyIds.includes(id));
      if (!selected.length) { setError("error:errSelectRecipients"); return; }
      payload.recipientPartyIds = selected;
    } else if (command === "return_copy" || command === "withdraw") {
      if (!actionReason.trim()) { setError("error:errEnterReason"); return; }
      payload.reason = actionReason.trim();
    } else if (command === "update_basis") {
      const currentChangeRefs = changes.map(candidate => refFor("WorkItem", candidate.record));
      const currentChangeKeys = new Set(currentChangeRefs.map(refKey));
      const selection = basisSelections[row.id] || {
        approvalRef: row.approvalRef,
        changeRefs: row.changeRefs.filter(ref => currentChangeKeys.has(refKey(ref))),
      };
      const currentApproval = selection.approvalRef && approvals.find(candidate =>
        candidate.record.id === selection.approvalRef?.objectId
        && String(candidate.record.approvalKind || candidate.record.subtype || "").toLowerCase().includes("technical")
        && sameRef(candidate.record.targetRef, row.drawingRef));
      if (selection.approvalRef && !currentApproval) {
        setError("error:errSelectApproval");
        return;
      }
      if (selection.changeRefs.some(ref => !currentChangeKeys.has(refKey(ref)))) {
        setError("error:errChangeVersion");
        return;
      }
      payload.approvalRef = currentApproval ? refFor("Approval", currentApproval.record) : null;
      payload.changeRefs = selection.changeRefs;
    }
    setPending({ revisionId: row.id, command, expectedVersion: row.version, payload, key: crypto.randomUUID() });
    setError("");
  }

  async function submitAction() {
    if (!pending) return;
    const command = pending.command;
    setBusy(true); setError(""); setNotice("");
    try {
      const updated = await commandDrawingFieldRevision(client, projectId, pending.revisionId,
        command, pending.expectedVersion, pending.payload, pending.key);
      setNotice(tx("actionDone", { command: tx(`command_${command}`) || command, status: statusText(updated.status, locale), version: updated.version }));
      setPending(null); setActionReason(""); setDistributionIds([]);
      await refresh();
      await onChanged?.();
    } catch (cause) { setError(recordError(cause, "errGeneric")); }
    finally { setBusy(false); }
  }

  async function showHistory(row: DrawingFieldRevision) {
    setHistory(null); setHistoryFor(row.id); setError("");
    try { setHistory(await getDrawingFieldHistory(client, projectId, row.id)); }
    catch (cause) { setError(recordError(cause, "errGeneric")); setHistoryFor(""); }
  }

  const scopeReady = loaded === scopeKey;
  const currentBindings = scopeReady ? bindings : [];
  const currentRevisions = scopeReady ? revisions : [];
  const participants = workspace.participants;
  const selectedRevision = currentRevisions.find(row => row.id === pending?.revisionId);

  return <section className="drawing-field-management" data-testid="drawing-field-management">
    <Panel>
      <SectionHeader title={tx("title")} meta={tx("summary")} />
      <p className="drawing-field-help">{tx("help")}</p>
      {error && <p role="alert" className="drawing-field-error">{displayError(error, locale)}</p>}
      {notice && <p role="status" className="drawing-field-notice">{notice}</p>}
      {admin && <div className="drawing-field-register" data-testid="drawing-field-register">
        <h3>{tx("registerTitle")}</h3>
        <label>{tx("binding")}
          <select aria-label={locale === "ko" ? "연결된 PDF 도면" : tx("binding")} value={bindingId} onChange={event => setBindingId(event.target.value)}>
            <option value="">{tx("selectBinding")}</option>
            {currentBindings.map(binding => <option key={binding.id} value={binding.id}>{binding.drawingRef.objectId} · {tx("sourceVersion")}{binding.drawingRef.version} · PDF {binding.evidenceRef.objectId}</option>)}
          </select>
        </label>
        {scopeReady && currentBindings.length === 0 && <div className="drawing-field-muted">
          <p>{tx("noBinding")}</p>
          {onOpenSourceRegistration && <ActionButton onClick={onOpenSourceRegistration}>{tx("registerSource")}</ActionButton>}
        </div>}
        <div className="drawing-field-grid">
          <label>{tx("drawingNumber")}<input aria-label={locale === "ko" ? "도면번호" : tx("drawingNumber")} value={drawingNo} maxLength={80} onChange={event => { setDrawingNo(event.target.value); setSupersedesId(""); }} /></label>
          <label>{tx("revision")}<input aria-label={locale === "ko" ? "개정" : tx("revision")} value={revision} maxLength={80} onChange={event => setRevision(event.target.value)} /></label>
          <label>{tx("purpose")}<select aria-label={locale === "ko" ? "용도" : tx("purpose")} value={issuedFor} onChange={event => setIssuedFor(event.target.value as DrawingFieldRegistrationInput["issuedFor"])}>
            <option value="construction">{tx("construction")}</option><option value="review">{tx("review")}</option><option value="information">{tx("information")}</option>
          </select></label>
        </div>
        <label>{tx("approval")}
          <select aria-label={locale === "ko" ? "연결 승인" : tx("approval")} value={approvalKey} onChange={event => setApprovalKey(event.target.value)}>
            <option value="">{tx("noApproval")}</option>
            {bindingApprovals.map(item => <option key={item.record.id} value={item.record.id}>
              {title(item.record)} · {String(item.record.status) === "approved" ? tx("approved") : tx("technicalReview")} · {item.record.id} · {recordVersionLabel(item.record.version)}
            </option>)}
          </select>
        </label>
        {bindingApprovals.find(item => item.record.id === approvalKey) && <p className="drawing-field-muted">{tx("approvalSource")} · {refLabel(refFor("Approval", bindingApprovals.find(item => item.record.id === approvalKey)!.record), locale)}. {tx("serverRechecks")}</p>}
        <fieldset><legend>{tx("recipients")}</legend>
          <div className="drawing-field-recipient-list">{participants.map(person =>
            <label key={person.partyId}><input type="checkbox" checked={recipientIds.includes(person.partyId)} onChange={() => toggleRecipient(person.partyId)} />{person.name} · {person.actorGroup} · {person.partyId}</label>
          )}</div>
        </fieldset>
        <fieldset><legend>{tx("changeRequestsOptional")}</legend>
          {changes.length === 0 ? <p className="drawing-field-muted">{tx("noChanges")}</p> : <div className="drawing-field-recipient-list">
            {changes.map(item => {
              const ref = refFor("WorkItem", item.record);
              const key = refKey(ref);
              return <label key={key}><input type="checkbox" checked={changeRefs.some(selected => refKey(selected) === key)}
                onChange={() => setChangeRefs(current => current.some(selected => refKey(selected) === key)
                  ? current.filter(selected => refKey(selected) !== key) : [...current, ref])} />
                {title(item.record)} · {statusValue(item.record.status, locale)} · {refLabel(ref, locale)}
              </label>;
            })}
          </div>}
        </fieldset>
        <label>{tx("supersedes")}
          <select aria-label={locale === "ko" ? "대체하는 기존 개정본" : tx("supersedes")} value={supersedesId} onChange={event => setSupersedesId(event.target.value)}>
            <option value="">{tx("none")}</option>
            {predecessorOptions.map(row => <option key={row.id} value={row.id}>{row.drawingNo} · {row.revision} · {statusText(row.status, locale)} · {row.id}</option>)}
          </select>
        </label>
        <p className="drawing-field-muted">{tx("linkedChangeCount", { count: changeRefs.length })}</p>
        <ActionButton disabled={busy || !scopeReady} onClick={() => void register()}>{tx("register")}</ActionButton>
        {!admin && <p className="drawing-field-muted">{tx("noPermission")}</p>}
      </div>}
    </Panel>
    <Panel>
      <SectionHeader title={tx("statusTitle")} meta={tx("statusSummary")} />
      {!scopeReady && <p role="status">{tx("loading")}</p>}
      {scopeReady && currentRevisions.length === 0 && <p className="drawing-field-muted">{tx("noRecords")}</p>}
      <div className="drawing-field-list">
        {currentRevisions.map(row => {
          const binding = currentBindings.find(item => item.id === row.bindingId);
          const rowCommands = row.availableCommands || [];
          const receipts = row.receipts || [];
          const reasons = row.readinessReasons || [];
          const fieldReady = row.currentForConstruction === true;
          const rowApprovals = approvals.filter(item => {
            const kind = String(item.record.approvalKind || item.record.subtype || "").toLowerCase();
            return kind.includes("technical") && sameRef(item.record.targetRef, row.drawingRef);
          });
          const currentChangeRefs = changes.map(candidate => refFor("WorkItem", candidate.record));
          const currentChangeKeys = new Set(currentChangeRefs.map(refKey));
          const currentApproval = row.approvalRef && rowApprovals.find(candidate => candidate.record.id === row.approvalRef?.objectId);
          const selectedBasis = basisSelections[row.id] || {
            approvalRef: currentApproval ? refFor("Approval", currentApproval.record) : null,
            changeRefs: row.changeRefs.filter(ref => currentChangeKeys.has(refKey(ref))),
          };
          return <article className="drawing-field-record" key={row.id} data-testid={`drawing-field-record-${row.id}`}>
            <header><strong>{row.drawingNo} · {tx("revision")} {row.revision}</strong><span className={`drawing-field-status ${fieldReady ? "is-current" : ""}`}>{statusText(row.status, locale)}{fieldReady ? ` · ${tx("inUse")}` : ""}</span></header>
            <p>{tx("purpose")} · {tx(row.issuedFor === "construction" ? "construction" : row.issuedFor === "review" ? "review" : "information")} · {tx("recordVersion")} {row.id} · {recordVersionLabel(row.version)}</p>
            <p>{tx("drawing")} · {refLabel(row.drawingRef, locale)} · {tx("pdf")} · {refLabel(row.evidenceRef, locale)}</p>
            {binding && <p>{tx("bindingRecord")} · {binding.id} · {tx("pdfVersion")}{binding.fileHash}</p>}
            <p>{tx("approvalLabel")} · {refLabel(row.approvalRef, locale)} · {tx("changeRequestLabel")} {row.changeRefs.length} · {row.supersedesId ? `${tx("supersedes")}: ${row.supersedesId}` : tx("noPredecessor")}</p>
            <p>{tx("fieldUse")} · {fieldReady ? tx("available") : tx("blocked")} · {row.fieldDistributionComplete ? tx("distributionComplete") : tx("distributionIncomplete")} · {tx("drawing")} {row.isCurrentSource === false ? tx("oldVersion") : tx("current")}</p>
            {!!reasons.length && <ul className="drawing-field-reasons">{reasons.map(reason => <li key={reason}>{tx(`reason_${reason}`) === `reason_${reason}` ? reasonLabel(reason) : tx(`reason_${reason}`)}</li>)}</ul>}
            {typeof row.obsoleteCopiesOutstanding === "number" && row.obsoleteCopiesOutstanding > 0
              ? <p>{tx("obsoleteCopiesWaiting", { count: row.obsoleteCopiesOutstanding })}</p>
              : typeof row.obsoleteCopiesOutstanding === "boolean"
                ? <p>{tx("obsoleteCopiesLabel")} · {row.obsoleteCopiesOutstanding ? tx("copiesOutstanding") : tx("noOutstandingCopies")}</p>
                : Array.isArray(row.obsoleteCopiesOutstanding) && row.obsoleteCopiesOutstanding.length > 0
                  ? <p>{tx("obsoleteCopiesWaiting", { count: row.obsoleteCopiesOutstanding.join(", ") })}</p> : null}
            <p>{tx("requiredRecipients")} · {row.requiredRecipientPartyIds.map(id => participants.find(person => person.partyId === id)?.name || id).join(", ")}</p>
            <div className="drawing-field-receipts"><strong>{tx("distributionReceipt")}</strong>
              {row.requiredRecipientPartyIds.map(id => {
                const receipt = receipts.find(item => item.recipientPartyId === id);
                return <span key={id}>{receipt?.recipientName || participants.find(person => person.partyId === id)?.name || id} · {!receipt?.deliveredAt ? tx("notDistributed") : receipt.receivedAt ? tx("receiptConfirmed") : tx("receiptPending")}{receipt?.deliveredAt ? ` · ${tx("distributedAt")} ${formatDateTime(receipt.deliveredAt)}` : ""}{receipt?.receivedAt ? ` · ${tx("receivedAt")} ${formatDateTime(receipt.receivedAt)}` : ""}{receipt?.returnedAt ? ` · ${tx("returnedAt")} ${formatDateTime(receipt.returnedAt)}` : ""}</span>;
              })}
            </div>
            {rowCommands.map(item => {
              const command = commandName(item);
              const allowedRecipients = row.requiredRecipientPartyIds;
              return <div className="drawing-field-action" key={command}>
                {command === "distribute" && <fieldset><legend>{tx("chooseRecipients")}</legend>{allowedRecipients.map(id => <label key={id}><input type="checkbox" checked={distributionIds.includes(id)} onChange={() => setDistributionIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])} />{participants.find(person => person.partyId === id)?.name || id}</label>)}</fieldset>}
                {(command === "return_copy" || command === "withdraw") && <label>{tx("reason")}<input aria-label={`${labelCommand(item, locale)} ${tx("reason")}`} value={actionReason} onChange={event => setActionReason(event.target.value)} /></label>}
                {command === "update_basis" && <div className="drawing-field-basis">
                  <label>{tx("currentApproval")}
                    <select aria-label={locale === "ko" ? `승인 근거 ${row.drawingNo}` : `${tx("approvalBasis")} ${row.drawingNo}`} value={selectedBasis.approvalRef?.objectId || ""}
                      onChange={event => {
                        const candidate = rowApprovals.find(value => value.record.id === event.target.value);
                        const approvalRef = candidate ? refFor("Approval", candidate.record) : null;
                        setBasisSelections(current => ({ ...current, [row.id]: { ...selectedBasis, approvalRef } }));
                      }}>
                      <option value="">{tx("noBasis")}</option>
                      {rowApprovals.map(candidate => <option key={candidate.record.id} value={candidate.record.id}>
                        {title(candidate.record)} · {String(candidate.record.status) === "approved" ? tx("approved") : tx("technicalReview")} · {candidate.record.id} · {recordVersionLabel(candidate.record.version)}
                      </option>)}
                    </select>
                  </label>
                  <fieldset><legend>{tx("currentChangeBasis")}</legend>{changes.length === 0 ? <span>{tx("noChangeBasis")}</span> : changes.map(candidate => {
                    const ref = refFor("WorkItem", candidate.record);
                    const key = refKey(ref);
                    return <label key={key}><input type="checkbox" checked={selectedBasis.changeRefs.some(value => refKey(value) === key)}
                      onChange={() => setBasisSelections(current => ({
                        ...current,
                        [row.id]: {
                          ...selectedBasis,
                          changeRefs: selectedBasis.changeRefs.some(value => refKey(value) === key)
                            ? selectedBasis.changeRefs.filter(value => refKey(value) !== key) : [...selectedBasis.changeRefs, ref],
                        },
                      }))} />
                      {title(candidate.record)} · {String(candidate.record.status ? statusText(String(candidate.record.status), locale) : tx("statusUnknown"))} · {refLabel(ref, locale)}
                    </label>;
                  })}</fieldset>
                </div>}
                <ActionButton disabled={busy} onClick={() => prepareAction(row, item)}>{labelCommand(item, locale)}</ActionButton>
              </div>;
            })}
            <ActionButton onClick={() => setImpactSelection({ scope: scopeKey, ref: row.drawingRef })}>{tx("impacts")}</ActionButton>
            <button type="button" className="drawing-field-history-button" onClick={() => void showHistory(row)}>{tx("history")}</button>
            {historyFor === row.id && <div className="drawing-field-history" aria-live="polite">
              {history === null ? <p>{tx("historyLoading")}</p> : history.length ? history.map((entry, index) => {
                const event = String(entry.event || "");
                const actor = participants.find(person => person.partyId === entry.actorPartyId);
                const after = entry.after && typeof entry.after === "object" ? entry.after as Record<string, unknown> : {};
                const occurredAt = typeof entry.occurredAt === "string" ? formatDateTime(entry.occurredAt) : tx("noTime");
                return <article key={String(entry.id || index)}>
                  <strong>{lookup(locale, `event_${event}`) === `event_${event}` ? lookup(locale, `command_${event}`) === `command_${event}` ? tx("event_default") : lookup(locale, `command_${event}`) : lookup(locale, `event_${event}`)}</strong>
                  <time>{occurredAt}</time>
                  <span>{tx("operator")} · {actor?.name || String(entry.actorPartyId || tx("unknown"))}</span>
                  {typeof after.status === "string" && <span>{tx("changedStatus")} · {statusText(after.status, locale)} · {recordVersionLabel(String(after.version || ""))}</span>}
                  {typeof entry.reason === "string" && entry.reason && <span>{tx("cause")} · {entry.reason}</span>}
                </article>;
              }) : <p>{tx("noHistory")}</p>}
            </div>}
          </article>;
        })}
      </div>
    </Panel>
    {impactSelection?.scope === scopeKey && <DrawingImpactPanel key={JSON.stringify([scopeKey, impactSelection.ref])} client={client} workspace={workspace} drawingRef={impactSelection.ref} onSelect={onSelect} onNavigate={onNavigate} />}
    {pending && <div className="drawing-field-scrim"><section role="dialog" aria-modal="true" aria-labelledby="drawing-field-confirm-title" className="drawing-field-dialog">
      <h2 id="drawing-field-confirm-title">{tx("confirmCommand", { command: labelCommand({ command: pending.command, label: pending.command }, locale) })}</h2>
      <p>{selectedRevision?.drawingNo} · {tx("revision")} {selectedRevision?.revision} · {selectedRevision?.id} · {tx("current")} {recordVersionLabel(pending.expectedVersion)}</p>
      <p>{tx("sourceDrawing")} · {selectedRevision ? refLabel(selectedRevision.drawingRef, locale) : ""}</p>
      {pending.command === "release" && <p>{tx("releaseCheck")}</p>}
      {pending.command === "distribute" && <p>{tx("distributeBoundary")}</p>}
      {pending.command === "acknowledge" && <p>{tx("acknowledgeBoundary")}</p>}
      {pending.command === "update_basis" && <p>{tx("approvalBasis")} · {refLabel((pending.payload.approvalRef || null) as DomainRef | null, locale)} · {tx("changeBasis")} · {Array.isArray(pending.payload.changeRefs) ? (pending.payload.changeRefs as DomainRef[]).map(ref => refLabel(ref, locale)).join(", ") || tx("none") : tx("none")}</p>}
      {(pending.command === "return_copy" || pending.command === "withdraw") && <p>{tx("reason")} · {String(pending.payload.reason || "")}</p>}
      {error && <p role="alert" className="drawing-field-error">{displayError(error, locale)}</p>}
      <div><ActionButton disabled={busy} onClick={() => void submitAction()}>{tx("confirmRequest")}</ActionButton>
        <ActionButton disabled={busy} onClick={() => setPending(null)}>{tx("cancel")}</ActionButton></div>
    </section></div>}
  </section>;
}
