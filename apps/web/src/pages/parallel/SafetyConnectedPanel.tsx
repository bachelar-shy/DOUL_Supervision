import { recordVersionLabel } from "../../labels";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CommandDescriptor, RecordDTO, WorkItem, Workspace } from "../../data/ui-contract";
import { ApiError, type SupervisionClient } from "../../data/supervision-client";
import { ActionButton, Panel, SectionHeader, StatusBadge } from "../../ui";
import { reasonLabel, states } from "../../labels";
import "./safety-connected.css";

type Link = {
  relation: string;
  sourceField: string;
  status: string;
  reference?: { objectType: string; objectId: string; version: number | null };
  versionResolution?: string;
  record?: { version?: number; subtype?: string; status?: string; locationId?: string | null };
};
type Trace = { readOnly: boolean; officialStateChanged: boolean; links: Link[]; diagnostics: Array<{ relation: string; status: string; sourceField: string }> };
type Locale = "ko" | "vi" | "en";

const copy: Record<Locale, Record<string, string>> = {
  ko: {
    title: "안전 연결 추적",
    readOnly: "읽기 전용 조회",
    description: "작업중지 지시의 정확한 참조와 현재 업무 처리 처리 가능 여부을 확인합니다. 이 화면은 발주처 보고서를 자동 발송하지 않습니다.",
    picker: "작업중지 원본",
    sourceSelect: "원본 선택",
    noSource: "현재 표시 가능한 작업중지 지시가 없습니다.",
    stopOrder: "작업중지",
    statusUnavailable: "상태 확인",
    commands: "현재 작업중지 업무 처리",
    commandsDescription: "업무 시스템이 제공한 업무 처리만 표시합니다. 작업 재개는 기존 증빙과 선행조건을 확인한 뒤 처리합니다.",
    noCommands: "현재 작성 차수에서 열 수 있는 업무 처리가 없습니다.",
    open: "열기",
    status: "상태",
    inputAndServerCheck: "입력 후 업무 시스템 검증",
    loading: "연결 기록을 읽는 중…",
    readOnlyUnchanged: "읽기 전용 조회 · 공식 상태 변경 없음",
    stateUnknown: "상태 변경 여부를 확인할 수 없습니다.",
    linkedRecord: "연결 기록",
    noStatus: "상태 정보 없음",
    currentNoVersion: "원본에 작성 차수가 없는 현재 조회",
    sourceVersion: "기록 작성 차수 ",
    currentReadOnly: "현재 조회 전용 · 원본 참조 작성 차수 미기록",
    historicalInactive: "역사 또는 미확인 작성 차수 · 변경 업무 처리 비활성",
    currentVersionMatch: "현재 업무 화면 작성 차수와 일치",
    readDetails: "상세 읽기",
    sourceDetail: "원본 상세",
    ownerReportBoundary: "발주자 보고는 별도 발송·접수 절차로 처리됩니다. 이 화면은 보고를 발송하지 않습니다.",
    diagnostics: "참조 진단",
    staleSource: "원본 작성 차수가 변경되었습니다. 최신 업무 화면을 새로고침하십시오.",
    staleCommand: "업무 처리 기준 작성 차수가 변경되었습니다. 최신 업무 화면을 새로고침하십시오.",
    readFailed: "연결 추적 정보를 조회하지 못했습니다.",
    detailFailed: "연결 기록 상세를 조회하지 못했습니다.",
  },
  vi: {
    title: "Truy xuất liên kết an toàn",
    readOnly: "Chỉ đọc",
    description: "Kiểm tra các tham chiếu chính xác và lệnh hiện có của SafetyStopOrder. Màn hình này không tự động gửi OwnerReport.",
    picker: "Hồ sơ nguồn lệnh dừng công việc",
    sourceSelect: "Chọn hồ sơ nguồn",
    noSource: "Không có SafetyStopOrder nào hiển thị.",
    stopOrder: "Lệnh dừng công việc",
    statusUnavailable: "Chưa có trạng thái",
    commands: "Lệnh hiện có của lệnh dừng",
    commandsDescription: "Chỉ hiển thị lệnh do máy chủ cung cấp. Lệnh tiếp tục phải qua kiểm tra bằng chứng hiện có và điều kiện tiên quyết.",
    noCommands: "Không có lệnh nào mở được ở phiên bản hiện tại.",
    open: "Mở",
    status: "Trạng thái",
    inputAndServerCheck: "Nhập dữ liệu rồi máy chủ kiểm tra",
    loading: "Đang tải hồ sơ liên kết…",
    readOnlyUnchanged: "Chỉ đọc · Không thay đổi trạng thái chính thức",
    stateUnknown: "Không thể xác nhận liệu trạng thái có thay đổi hay không.",
    linkedRecord: "Hồ sơ liên kết",
    noStatus: "Chưa có thông tin trạng thái",
    currentNoVersion: "Truy vấn hiện tại, nguồn không có phiên bản",
    sourceVersion: "Nguồn v",
    currentReadOnly: "Chỉ truy vấn hiện tại · Nguồn không ghi nhận phiên bản tham chiếu",
    historicalInactive: "Phiên bản lịch sử hoặc chưa xác định · Đã vô hiệu hóa lệnh thay đổi",
    currentVersionMatch: "Khớp phiên bản trong không gian làm việc hiện tại",
    readDetails: "Xem chi tiết chỉ đọc",
    sourceDetail: "Chi tiết nguồn",
    ownerReportBoundary: "Báo cáo Chủ đầu tư có quy trình phát hành và xác nhận tiếp nhận riêng. Màn hình này không gửi báo cáo.",
    diagnostics: "Chẩn đoán tham chiếu",
    staleSource: "Phiên bản nguồn đã thay đổi. Hãy làm mới không gian làm việc mới nhất.",
    staleCommand: "Phiên bản làm căn cứ cho lệnh đã thay đổi. Hãy làm mới không gian làm việc mới nhất.",
    readFailed: "Không thể truy vấn thông tin truy xuất liên kết.",
    detailFailed: "Không thể truy vấn chi tiết hồ sơ liên kết.",
  },
  en: {
    title: "Safety link traceability",
    readOnly: "Read-only query",
    description: "Review exact SafetyStopOrder references and current command availability. This view does not dispatch Owner Reports automatically.",
    picker: "Source stop order",
    sourceSelect: "Select source record",
    noSource: "No SafetyStopOrder is visible in the current workspace.",
    stopOrder: "Stop order",
    statusUnavailable: "Status unavailable",
    commands: "Current stop order commands",
    commandsDescription: "Only server-provided commands are shown. Resumption commands still require existing evidence and prerequisite checks.",
    noCommands: "No commands can be opened for the current version.",
    open: "Open",
    status: "Status",
    inputAndServerCheck: "Input required; server will recheck",
    loading: "Loading linked records…",
    readOnlyUnchanged: "Read-only query · No official state change",
    stateUnknown: "Unable to confirm whether the state changed.",
    linkedRecord: "Linked record",
    noStatus: "Status unavailable",
    currentNoVersion: "Current lookup; source has no version",
    sourceVersion: "Source v",
    currentReadOnly: "Current lookup only · Source reference version not recorded",
    historicalInactive: "Historical or unverified version · Change commands disabled",
    currentVersionMatch: "Matches the current workspace version",
    readDetails: "Read details",
    sourceDetail: "Source details",
    ownerReportBoundary: "Owner Reports have separate dispatch and receipt steps. This view does not dispatch reports.",
    diagnostics: "Reference diagnostics",
    staleSource: "The source version changed. Refresh the latest workspace.",
    staleCommand: "The command basis version changed. Refresh the latest workspace.",
    readFailed: "Could not query safety traceability information.",
    detailFailed: "Could not query linked record details.",
  },
};

const relationNames: Record<Locale, Record<string, string>> = {
  ko: {
    affectedPermitRefs: "영향 작업허가", issueRefs: "연결 지적사항", correctiveActionRefs: "시정조치",
    resumeVerificationRefs: "재개 재검증", ownerReportRefs: "발주자 보고", "issue.actionIds": "지적사항 조치",
    "issue.inspectionIds": "지적사항 재검사", "stopOrder.drawing": "도면", "stopOrder.location": "위치", "stopOrder.evidence": "안전 증빙",
  },
  vi: {
    affectedPermitRefs: "Giấy phép công việc bị ảnh hưởng", issueRefs: "Issue được liên kết", correctiveActionRefs: "Hành động khắc phục",
    resumeVerificationRefs: "Xác minh lại việc tiếp tục", ownerReportRefs: "Báo cáo Chủ đầu tư", "issue.actionIds": "Hành động của Issue",
    "issue.inspectionIds": "Nghiệm thu lại Issue", "stopOrder.drawing": "Bản vẽ", "stopOrder.location": "Vị trí", "stopOrder.evidence": "Bằng chứng an toàn",
  },
  en: {
    affectedPermitRefs: "Affected work permits", issueRefs: "Linked Issues", correctiveActionRefs: "Corrective actions",
    resumeVerificationRefs: "Resumption reverifications", ownerReportRefs: "Owner Reports", "issue.actionIds": "Issue actions",
    "issue.inspectionIds": "Issue reinspections", "stopOrder.drawing": "Drawing", "stopOrder.location": "Location", "stopOrder.evidence": "Safety evidence",
  },
};

const collections: Record<string, string> = {
  safety_permit: "safety-permits",
  safety_stop_order: "safety-stop-orders",
  safety_equipment_inspection: "safety-equipment-inspections",
  issue: "issues",
  action: "actions",
  inspection: "inspections",
  report: "owner-reports",
  evidence: "evidence",
};

const linkStatuses: Record<Locale, Record<string, string>> = {
  ko: { readable: "열람 가능", missing: "대상 없음", unauthorized: "열람 권한 없음", foreign_project: "다른 현장", invalid_reference: "참조 확인 필요" },
  vi: { readable: "Có thể xem", missing: "Không tìm thấy đối tượng", unauthorized: "Không có quyền xem", foreign_project: "Dự án khác", invalid_reference: "Cần kiểm tra tham chiếu" },
  en: { readable: "Readable", missing: "Target missing", unauthorized: "Not authorized to read", foreign_project: "Different project", invalid_reference: "Reference needs review" },
};

const commandNames: Record<Locale, Record<string, string>> = {
  ko: { acknowledge_stop: "작업중지 확인", start_correction: "시정 시작", request_resume: "재개 요청", start_resume_verification: "재개 재검증 시작", lift_stop: "작업중지 해제", close_stop: "작업중지 종료" },
  vi: { acknowledge_stop: "Xác nhận lệnh dừng", start_correction: "Bắt đầu khắc phục", request_resume: "Yêu cầu tiếp tục công việc", start_resume_verification: "Bắt đầu xác minh tiếp tục", lift_stop: "Dỡ lệnh dừng công việc", close_stop: "Đóng lệnh dừng công việc" },
  en: { acknowledge_stop: "Acknowledge stop order", start_correction: "Start correction", request_resume: "Request resumption", start_resume_verification: "Start resumption verification", lift_stop: "Lift stop order", close_stop: "Close stop order" },
};

const safetyStates: Record<Locale, Record<string, string>> = {
  ko: {
    active: "작업 허용", acknowledged: "수령 확인", authorization_pending: "허가 승인 대기", authorized: "허가 승인", cancelled: "취소", closed: "종결",
    completeness_review: "자료 검토", corrective_action: "시정조치", completed: "검사 완료", draft: "작성 중", due: "점검 필요", expired: "유효기간 만료",
    failed: "부적합", issued: "발행", inspecting: "점검 진행", lifted: "중지 해제", passed: "적합", prestart_verification: "작업 전 확인",
    rejected: "반려", requested: "검사 요청", reinspection_due: "재점검 필요", result_pending: "판정 대기", restricted: "사용 제한", resume_requested: "재개 요청",
    resume_review: "재개 검토", safety_review: "안전 검토", scheduled: "점검 예정", submitted: "제출 완료", superseded: "대체됨", suspended: "작업 중지",
    verification: "재개 검증", withdrawn: "요청 철회",
  },
  vi: {
    active: "Được phép làm việc", acknowledged: "Đã xác nhận tiếp nhận", authorization_pending: "Đang chờ cấp phép", authorized: "Giấy phép đã được phê duyệt", cancelled: "Đã hủy", closed: "Đã đóng",
    completeness_review: "Đang xem xét tính đầy đủ", corrective_action: "Đang khắc phục", completed: "Đã kiểm tra", draft: "Bản nháp", due: "Cần kiểm tra", expired: "Đã hết hạn",
    failed: "Không đạt", issued: "Đã ban hành", inspecting: "Đang kiểm tra", lifted: "Đã dỡ lệnh dừng", passed: "Đạt", prestart_verification: "Đang xác minh trước khi bắt đầu",
    rejected: "Đã từ chối", requested: "Đã yêu cầu kiểm tra", reinspection_due: "Cần kiểm tra lại", result_pending: "Đang chờ kết quả", restricted: "Bị hạn chế sử dụng", resume_requested: "Đã yêu cầu tiếp tục",
    resume_review: "Đang xem xét tiếp tục", safety_review: "Đang xem xét an toàn", scheduled: "Đã lên lịch kiểm tra", submitted: "Đã nộp", superseded: "Đã thay thế", suspended: "Đã dừng công việc",
    verification: "Đang xác minh tiếp tục", withdrawn: "Đã rút yêu cầu",
  },
  en: {
    active: "Work authorized", acknowledged: "Receipt acknowledged", authorization_pending: "Authorization pending", authorized: "Permit approved", cancelled: "Cancelled", closed: "Closed",
    completeness_review: "Completeness review", corrective_action: "Corrective action", completed: "Inspection complete", draft: "Draft", due: "Inspection due", expired: "Expired",
    failed: "Failed", issued: "Issued", inspecting: "Under inspection", lifted: "Stop order lifted", passed: "Passed", prestart_verification: "Prestart verification",
    rejected: "Rejected", requested: "Inspection requested", reinspection_due: "Reinspection due", result_pending: "Result pending", restricted: "Use restricted", resume_requested: "Resumption requested",
    resume_review: "Resumption review", safety_review: "Safety review", scheduled: "Inspection scheduled", submitted: "Submitted", superseded: "Superseded", suspended: "Work suspended",
    verification: "Resumption verification", withdrawn: "Request withdrawn",
  },
};

function errorToken(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) return `reason:${cause.detail.code}`;
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message === "SAFETY_CONNECTED_STALE_SOURCE") return "copy:staleSource";
  if (message === "SAFETY_CONNECTED_STALE_COMMAND") return "copy:staleCommand";
  return `copy:${fallback}`;
}

function errorText(value: string, tx: (key: string) => string) {
  if (value.startsWith("reason:")) return reasonLabel(value.slice("reason:".length));
  if (value.startsWith("copy:")) return tx(value.slice("copy:".length));
  return value;
}

function stateName(value: string | undefined, fallback: string, subtype: string | undefined, language: Locale) {
  if (!value) return fallback;
  if (subtype === "SafetyPermit" || subtype === "SafetyStopOrder" || subtype === "SafetyEquipmentInspection") {
    return safetyStates[language][value] || states[value] || value;
  }
  return states[value] || value;
}

function recordTypeName(value: string | undefined, language: Locale) {
  if (!value) return undefined;
  const names: Record<Locale, Record<string, string>> = {
    ko: { SafetyPermit: "안전 작업허가", SafetyStopOrder: "안전 작업중지", SafetyEquipmentInspection: "안전장비 점검", Issue: "지적사항", Action: "조치", Inspection: "검사", OwnerReport: "발주자 보고", Evidence: "증빙", Document: "문서" },
    vi: { SafetyPermit: "Giấy phép công việc an toàn", SafetyStopOrder: "Lệnh dừng công việc an toàn", SafetyEquipmentInspection: "Kiểm tra thiết bị an toàn", Issue: "Issue", Action: "Hành động", Inspection: "Nghiệm thu", OwnerReport: "Báo cáo Chủ đầu tư", Evidence: "Bằng chứng", Document: "Tài liệu" },
    en: { SafetyPermit: "Safety work permit", SafetyStopOrder: "Safety stop order", SafetyEquipmentInspection: "Safety equipment inspection", Issue: "Issue", Action: "Action", Inspection: "Inspection", OwnerReport: "Owner Report", Evidence: "Evidence", Document: "Document" },
  };
  return names[language][value] || value;
}

export function SafetyConnectedPanel({ client, workspace, onChanged, onSelect, onOpenCommand }: {
  client: SupervisionClient;
  workspace: Workspace;
  onChanged?: () => void;
  onSelect?: (id: string | null) => void;
  onOpenCommand?: (item: WorkItem, action: CommandDescriptor) => void;
}) {
  const { i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? i18n.language).slice(0, 2);
  const language: Locale = locale === "ko" || locale === "vi" ? locale : "en";
  const tx = (key: string) => copy[language][key] || copy.en[key] || key;
  const stops = workspace.items.filter(item => item.machine === "safety_stop_order");
  const [id, setId] = useState("");
  const active = stops.find(item => item.record.id === id) || stops[0];
  const activeKey = active ? `${active.record.id}:${active.record.version}` : "";
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  const openSequence = useRef(0);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [details, setDetails] = useState<Record<string, RecordDTO>>({});
  const [actions, setActions] = useState<Record<string, CommandDescriptor[]>>({});

  useEffect(() => {
    let alive = true;
    openSequence.current += 1;
    setTrace(null); setDetails({}); setActions({}); setError("");
    if (!active) { setLoading(false); return () => { alive = false; }; }
    setLoading(true);
    const query = new URLSearchParams({ object_id: active.record.id, version: String(active.record.version) });
    client.request<Trace>(client.path(`/parallel/safety-traceability?${query}`))
      .then(result => { if (alive) setTrace(result); })
      .catch(reason => { if (alive) setError(errorToken(reason, "readFailed")); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; openSequence.current += 1; };
  }, [client, active?.record.id, active?.record.version]);

  async function open(link: Link) {
    const ref = link.reference;
    if (!active || !ref || ref.version == null || link.versionResolution !== "exact_historical_version") return;
    const selectedKey = activeKey;
    const sequence = ++openSequence.current;
    const item = workspace.items.find(candidate => candidate.record.id === ref.objectId && candidate.record.version === ref.version);
    if (!item || !collections[item.machine]) return;
    try {
      const path = `/${collections[item.machine]}/${ref.objectId}`;
      const dto = await client.request<RecordDTO>(client.path(path));
      if (sequence !== openSequence.current || selectedKey !== activeKeyRef.current) return;
      if (dto.version !== ref.version) throw new Error("SAFETY_CONNECTED_STALE_SOURCE");
      const key = link.relation + ref.objectId;
      setDetails(value => ({ ...value, [key]: dto }));
      if (item.machine !== "evidence" && item.machine !== "document") {
        const preflight = await client.request<CommandDescriptor[]>(client.path(path + "/available-actions"));
        if (sequence !== openSequence.current || selectedKey !== activeKeyRef.current) return;
        if (preflight.some(action => action.expectedVersion !== ref.version)) throw new Error("SAFETY_CONNECTED_STALE_COMMAND");
        setActions(value => ({ ...value, [key]: preflight }));
      }
    } catch (reason) {
      if (sequence === openSequence.current && selectedKey === activeKeyRef.current) setError(errorToken(reason, "detailFailed"));
    }
  }

  const rootActions = active?.actions.filter(action =>
    action.expectedVersion === active.record.version && (action.ready || action.requiresInput),
  ) ?? [];
  const rootStatus = stateName(active?.record.status, tx("statusUnavailable"), "SafetyStopOrder", language);

  return <section className="safety-connected" data-ui-component="safety-connected"><Panel>
    <SectionHeader title={tx("title")} meta={tx("readOnly")} />
    <p className="muted">{tx("description")}</p>
    <div className="safety-connected-picker"><label htmlFor="safety-stop-pick">{tx("picker")}</label><select id="safety-stop-pick" value={active?.record.id || ""} onChange={event => { setId(event.target.value); onSelect?.(event.target.value || null); onChanged?.(); }}><option value="">{tx("sourceSelect")}</option>{stops.map(item => <option key={item.record.id} value={item.record.id}>{item.record.title || item.record.workName || item.record.id} · {recordVersionLabel(item.record.version)}</option>)}</select></div>
    {!active && <p className="safety-connected-empty">{tx("noSource")}</p>}
    {active && <><div className="safety-connected-root"><strong>{active.record.title || active.record.workName || tx("stopOrder")}</strong><span>{recordTypeName("SafetyStopOrder", language)} · {active.record.id} · {recordVersionLabel(active.record.version)}</span><StatusBadge status={active.record.status}>{rootStatus}</StatusBadge></div>
      <section className="safety-connected-commands" aria-label={tx("commands")}><h3>{tx("commands")}</h3><p>{tx("commandsDescription")}</p>{rootActions.length ? rootActions.map(action => <ActionButton key={action.command} disabled={!onOpenCommand} onClick={() => onOpenCommand?.(active, action)}>{commandNames[language][action.command] || action.command} {tx("open")}{action.requiresInput && !action.ready ? ` · ${tx("inputAndServerCheck")}` : ""}</ActionButton>) : <span>{tx("noCommands")}</span>}</section>
    </>}
    {loading && <p role="status">{tx("loading")}</p>}{error && <div role="alert" className="error-box">{errorText(error, tx)}</div>}
    {trace && <><p className="safety-connected-note">{trace.readOnly && !trace.officialStateChanged ? tx("readOnlyUnchanged") : tx("stateUnknown")}</p><div className="safety-connected-grid">{trace.links.map((link, index) => {
      const ref = link.reference; const key = link.relation + (ref?.objectId || index);
      const current = !!ref && ref.version != null && workspace.items.some(item => item.record.id === ref.objectId && item.record.version === ref.version);
      const row = link.record || {}; const dto = details[key];
      const item = current ? workspace.items.find(candidate => candidate.record.id === ref?.objectId && candidate.record.version === ref?.version) : undefined;
      const exact = ref?.version != null && current && link.versionResolution === "exact_historical_version";
      const linkTitle = relationNames[language][link.relation] || link.relation;
      const linkStatus = linkStatuses[language][link.status] || link.status;
      return <article className="safety-connected-card" key={key}><div className="safety-connected-card-head"><strong>{linkTitle}</strong><span>{linkStatus}</span></div>{link.status === "readable" && <>
        <div className="safety-connected-card-body"><strong>{recordTypeName(row.subtype || ref?.objectType, language) || tx("linkedRecord")}</strong><span>{row.status ? `${tx("status")} · ${stateName(row.status, tx("noStatus"), row.subtype || ref?.objectType, language)}` : tx("noStatus")}</span><span>{ref?.version == null ? tx("currentNoVersion") : `${tx("sourceVersion")}${ref.version}`}</span></div>
        <p className="safety-connected-version">{ref?.version == null ? tx("currentReadOnly") : !current ? tx("historicalInactive") : tx("currentVersionMatch")}</p>
        {exact && <ActionButton onClick={() => void open(link)}>{tx("readDetails")}</ActionButton>}
        {dto && <div className="safety-connected-detail"><strong>{dto.title || dto.workName || recordTypeName(dto.subtype, language) || tx("sourceDetail")}</strong><span>{stateName(dto.status, tx("noStatus"), dto.subtype, language)} · {recordVersionLabel(dto.version)}</span></div>}
        {item && exact && (actions[key] || []).filter(action => action.expectedVersion === ref?.version && (action.ready || action.requiresInput)).map(action => <ActionButton key={action.command} disabled={!onOpenCommand} onClick={() => onOpenCommand?.(item, action)}>{commandNames[language][action.command] || action.command} {tx("open")}</ActionButton>)}
        {link.relation === "ownerReportRefs" && <p className="safety-connected-report">{tx("ownerReportBoundary")}</p>}
      </>}</article>;
    })}</div>{trace.diagnostics.length > 0 && <section className="safety-connected-diagnostics"><h3>{tx("diagnostics")}</h3>{trace.diagnostics.map((entry, index) => <p key={index}>{relationNames[language][entry.relation] || entry.relation} · {linkStatuses[language][entry.status] || entry.status}</p>)}</section>}</>}
  </Panel></section>;
}
