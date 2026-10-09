import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CommandDescriptor, WorkItem, Workspace } from "../../data/ui-contract";
import type { SupervisionClient } from "../../data/supervision-client";
import { ApiError } from "../../data/supervision-client";
import { getInspectionCase } from "../../data/inspection-case-flow-client";
import type { InspectionCase } from "../../data/inspection-case-flow-client";
import { commands, reasonLabel, states } from "../../labels";
import { machineLabels } from "../../app/routes";
import { formatDateTime } from "../../i18n/format";
import { InspectionCaseAuthoringPanel } from "./InspectionCaseAuthoringPanel";
import "./inspection-case-flow.css";

type Locale = "ko" | "vi" | "en";

const copy: Record<Locale, Record<string, string>> = {
  ko: {
    header: "검측 사례 흐름",
    description: "서버가 명시적으로 연결한 원 검측 · Issue · 시정조치 · 재검측 · 발주자 보고와 준비상태를 조회합니다.",
    refresh: "새로고침",
    refreshing: "조회 중…",
    rootInspection: "원 검측",
    inspectionPicker: "원 검측 선택",
    selectInspection: "검측 선택",
    noInspection: "현재 작업공간에서 열람할 수 있는 원 검측이 없습니다.",
    graphLoading: "검측 사례 그래프를 조회하는 중…",
    stale: "기록 버전이 변경되었습니다. 최신 작업공간에서 다시 조회하십시오.",
    loadError: "검측 사례 흐름을 불러오지 못했습니다.",
    complete: "사례 완료",
    inProgress: "진행 중",
    openIssues: "열린 Issue",
    reportsPending: "발주자 보고 대기",
    linkedIssues: "연결 Issue",
    noLinkedIssues: "이 검측에 서버가 연결한 Issue가 없습니다. 다른 검측 사례를 선택할 수 있습니다.",
    ownerReports: "사례 발주자 보고",
    ownerReportBoundary: "이 화면은 발주자 보고를 발송하거나 접수 처리하지 않습니다.",
    auditHistory: "서버 감사 이력",
    issuePrefix: "Issue",
    status: "상태",
    noStatus: "상태 확인",
    serverReadiness: "서버 준비상태",
    serverDecision: "서버 판정",
    correctionCycle: "시정 주기",
    relatedObservation: "관찰",
    relatedAction: "시정조치",
    relatedReinspection: "재검측",
    relatedOwnerReport: "발주자 보고",
    noRelatedRecords: "서버에서 연결된 기록이 없습니다.",
    reportDraftBoundary: "보고 초안 생성과 발송·접수는 별도 절차입니다. 초안 작성 후 발행과 수령 확인을 각각 진행하십시오.",
    currentStage: "현재 단계",
    correctionSubmitted: "시정조치 제출",
    correctionVerified: "시정조치 검증",
    currentReinspection: "현재 재검측",
    reinspectionPassed: "재검측 합격",
    closeReady: "Issue 종결 준비",
    closeBlockedReasons: "종결 차단 사유",
    ownerReportDraftReady: "종결보고 초안 준비",
    ownerReportIssuePending: "발주자 보고 발행 대기",
    ownerReceiptPending: "발주자 수령 대기",
    ownerReceiptConfirmed: "발주자 수령 확인",
    ownerReportingComplete: "발주자 보고 완료",
    yes: "예",
    no: "아니요",
    none: "없음",
    staleAction: "최신 작업공간 기록과 버전이 일치하지 않습니다.",
    needsInput: "입력 필요",
    openCommand: "열기",
    blocked: "차단됨",
    version: "v",
    stage_corrective_action: "시정조치 진행",
    stage_reinspection_request: "재검측 요청 준비",
    stage_reinspection: "재검측 진행",
    stage_closure: "종결 검토",
    stage_owner_report: "발주자 보고",
    stage_terminal: "종결 단계",
    reason_ISSUE_NOT_IN_REINSPECTION: "Issue가 재검측 단계에 있지 않습니다",
    reason_CURRENT_ACTIONS_NOT_VERIFIED: "현재 시정조치가 모두 검증되지 않았습니다",
    reason_REINSPECTION_NOT_PASSED: "현재 재검측이 합격하지 않았습니다",
    reason_CLOSURE_ACTION_EVIDENCE_REQUIRED: "시정조치 종결 증빙이 필요합니다",
    reason_CLOSURE_REINSPECTION_EVIDENCE_REQUIRED: "재검측 종결 증빙이 필요합니다",
    unknownStage: "확인되지 않은 단계",
    unknownReason: "확인되지 않은 차단 사유",
  },
  vi: {
    header: "Luồng hồ sơ nghiệm thu",
    description: "Xem nghiệm thu gốc, Issue, hành động khắc phục, nghiệm thu lại, báo cáo Chủ đầu tư và trạng thái sẵn sàng do máy chủ liên kết rõ ràng.",
    refresh: "Làm mới",
    refreshing: "Đang tải…",
    rootInspection: "Nghiệm thu gốc",
    inspectionPicker: "Chọn hồ sơ nghiệm thu gốc",
    selectInspection: "Chọn hồ sơ nghiệm thu",
    noInspection: "Không có hồ sơ nghiệm thu gốc nào để xem trong không gian làm việc hiện tại.",
    graphLoading: "Đang tải sơ đồ hồ sơ nghiệm thu…",
    stale: "Phiên bản hồ sơ đã thay đổi. Hãy tải lại từ không gian làm việc mới nhất.",
    loadError: "Không thể tải luồng hồ sơ nghiệm thu.",
    complete: "Hồ sơ hoàn tất",
    inProgress: "Đang thực hiện",
    openIssues: "Issue đang mở",
    reportsPending: "Báo cáo Chủ đầu tư đang chờ",
    linkedIssues: "Issue được liên kết",
    noLinkedIssues: "Máy chủ chưa liên kết Issue nào với hồ sơ nghiệm thu này. Bạn có thể chọn hồ sơ khác.",
    ownerReports: "Báo cáo Chủ đầu tư trong hồ sơ",
    ownerReportBoundary: "Màn hình này không gửi hoặc xác nhận tiếp nhận báo cáo Chủ đầu tư.",
    auditHistory: "Lịch sử kiểm toán máy chủ",
    issuePrefix: "Issue",
    status: "Trạng thái",
    noStatus: "Chưa có trạng thái",
    serverReadiness: "Trạng thái sẵn sàng từ máy chủ",
    serverDecision: "Kết luận của máy chủ",
    correctionCycle: "Chu kỳ khắc phục",
    relatedObservation: "Quan sát",
    relatedAction: "Hành động khắc phục",
    relatedReinspection: "Nghiệm thu lại",
    relatedOwnerReport: "Báo cáo Chủ đầu tư",
    noRelatedRecords: "Máy chủ không có hồ sơ liên kết.",
    reportDraftBoundary: "Tạo bản nháp, phát hành và xác nhận tiếp nhận báo cáo là các bước riêng. Hãy tạo bản nháp, sau đó phát hành và xác nhận tiếp nhận riêng.",
    currentStage: "Giai đoạn hiện tại",
    correctionSubmitted: "Đã nộp hành động khắc phục",
    correctionVerified: "Đã xác minh hành động khắc phục",
    currentReinspection: "Nghiệm thu lại hiện tại",
    reinspectionPassed: "Nghiệm thu lại đạt",
    closeReady: "Sẵn sàng đóng Issue",
    closeBlockedReasons: "Lý do chưa thể đóng",
    ownerReportDraftReady: "Bản nháp báo cáo đóng hồ sơ sẵn sàng",
    ownerReportIssuePending: "Đang chờ phát hành báo cáo Chủ đầu tư",
    ownerReceiptPending: "Đang chờ Chủ đầu tư xác nhận tiếp nhận",
    ownerReceiptConfirmed: "Chủ đầu tư đã xác nhận tiếp nhận",
    ownerReportingComplete: "Đã hoàn tất báo cáo Chủ đầu tư",
    yes: "Có",
    no: "Không",
    none: "Không có",
    staleAction: "Hồ sơ hoặc phiên bản không còn khớp với không gian làm việc mới nhất.",
    needsInput: "Cần nhập dữ liệu",
    openCommand: "Mở",
    blocked: "Đang bị chặn",
    version: "v",
    stage_corrective_action: "Đang thực hiện khắc phục",
    stage_reinspection_request: "Chuẩn bị yêu cầu nghiệm thu lại",
    stage_reinspection: "Đang nghiệm thu lại",
    stage_closure: "Xem xét đóng Issue",
    stage_owner_report: "Báo cáo Chủ đầu tư",
    stage_terminal: "Giai đoạn kết thúc",
    reason_ISSUE_NOT_IN_REINSPECTION: "Issue chưa ở giai đoạn nghiệm thu lại",
    reason_CURRENT_ACTIONS_NOT_VERIFIED: "Chưa xác minh tất cả hành động khắc phục hiện tại",
    reason_REINSPECTION_NOT_PASSED: "Nghiệm thu lại hiện tại chưa đạt",
    reason_CLOSURE_ACTION_EVIDENCE_REQUIRED: "Cần có bằng chứng đóng hành động khắc phục",
    reason_CLOSURE_REINSPECTION_EVIDENCE_REQUIRED: "Cần có bằng chứng đóng nghiệm thu lại",
    unknownStage: "Giai đoạn chưa xác định",
    unknownReason: "Lý do chặn chưa xác định",
  },
  en: {
    header: "Inspection case flow",
    description: "View the source inspection, Issue, corrective actions, reinspection, Owner Reports, and readiness explicitly linked by the server.",
    refresh: "Refresh",
    refreshing: "Loading…",
    rootInspection: "Source inspection",
    inspectionPicker: "Select source inspection",
    selectInspection: "Select inspection",
    noInspection: "No source inspection is available in the current workspace.",
    graphLoading: "Loading inspection case graph…",
    stale: "The record version changed. Reload it from the latest workspace.",
    loadError: "Could not load the inspection case flow.",
    complete: "Case complete",
    inProgress: "In progress",
    openIssues: "Open Issues",
    reportsPending: "Owner Reports pending",
    linkedIssues: "Linked Issues",
    noLinkedIssues: "The server has not linked an Issue to this inspection. Select another inspection case if needed.",
    ownerReports: "Case Owner Reports",
    ownerReportBoundary: "This view does not dispatch or acknowledge receipt of Owner Reports.",
    auditHistory: "Server audit history",
    issuePrefix: "Issue",
    status: "Status",
    noStatus: "Status unavailable",
    serverReadiness: "Server readiness",
    serverDecision: "Server decision",
    correctionCycle: "Correction cycle",
    relatedObservation: "Observation",
    relatedAction: "Corrective action",
    relatedReinspection: "Reinspection",
    relatedOwnerReport: "Owner Report",
    noRelatedRecords: "No records are linked by the server.",
    reportDraftBoundary: "Draft creation, dispatch, and receipt confirmation are separate steps. Create the draft, then dispatch it and confirm receipt separately.",
    currentStage: "Current stage",
    correctionSubmitted: "Correction submitted",
    correctionVerified: "Correction verified",
    currentReinspection: "Current reinspection",
    reinspectionPassed: "Reinspection passed",
    closeReady: "Issue ready to close",
    closeBlockedReasons: "Closure blockers",
    ownerReportDraftReady: "Closure report draft ready",
    ownerReportIssuePending: "Owner Report awaiting dispatch",
    ownerReceiptPending: "Owner receipt pending",
    ownerReceiptConfirmed: "Owner receipt confirmed",
    ownerReportingComplete: "Owner reporting complete",
    yes: "Yes",
    no: "No",
    none: "None",
    staleAction: "The record or version does not match the latest workspace.",
    needsInput: "Input required",
    openCommand: "Open",
    blocked: "Blocked",
    version: "v",
    stage_corrective_action: "Corrective action in progress",
    stage_reinspection_request: "Preparing reinspection request",
    stage_reinspection: "Reinspection in progress",
    stage_closure: "Closure review",
    stage_owner_report: "Owner reporting",
    stage_terminal: "Terminal stage",
    reason_ISSUE_NOT_IN_REINSPECTION: "The Issue is not in reinspection",
    reason_CURRENT_ACTIONS_NOT_VERIFIED: "Current corrective actions are not all verified",
    reason_REINSPECTION_NOT_PASSED: "The current reinspection has not passed",
    reason_CLOSURE_ACTION_EVIDENCE_REQUIRED: "Corrective action closure evidence is required",
    reason_CLOSURE_REINSPECTION_EVIDENCE_REQUIRED: "Reinspection closure evidence is required",
    unknownStage: "Unrecognized stage",
    unknownReason: "Unrecognized blocker",
  },
};

const titleOf = (item: WorkItem) => item.record.title || item.record.workName || item.record.subtype || item.record.id;

function errorLabel(cause: unknown): { code?: string; key?: string } {
  if (cause instanceof ApiError) return { code: cause.detail.code };
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/409|VERSION_CONFLICT|stale/i.test(message)) return { key: "stale" };
  return { key: "loadError" };
}

function readinessValue(key: string, value: unknown, tx: (key: string) => string) {
  if (key === "stage") {
    if (typeof value !== "string") return tx("unknownStage");
    const label = tx(`stage_${value}`);
    return label === `stage_${value}` ? tx("unknownStage") : label;
  }
  if (key === "closeBlockedReasons" && Array.isArray(value)) {
    return value.length ? value.map(reason => {
      const code = String(reason);
      const label = tx(`reason_${code}`);
      return label === `reason_${code}` ? tx("unknownReason") : label;
    }).join(", ") : tx("none");
  }
  if (typeof value === "boolean") return tx(value ? "yes" : "no");
  if (Array.isArray(value)) return value.length ? value.join(", ") : tx("none");
  return value == null || value === "" ? tx("none") : String(value);
}

function LinkedRecord({ item, workspace, onOpenCommand, tx }: {
  item: WorkItem;
  workspace: Workspace;
  onOpenCommand?: (item: WorkItem, action: CommandDescriptor) => void;
  tx: (key: string) => string;
}) {
  const current = workspace.items.find(candidate => candidate.machine === item.machine && candidate.record.id === item.record.id && candidate.record.version === item.record.version);
  const status = item.record.status ? states[item.record.status] || item.record.status : tx("noStatus");
  return <article className="inspection-case-record">
    <div className="inspection-case-record-heading"><strong>{titleOf(item)}</strong><span>{machineLabels[item.machine] || item.machine} · {item.record.id} · {tx("version")}{item.record.version}</span></div>
    <div className="inspection-case-record-meta">{tx("status")} · {status}</div>
    {!!item.actions?.length && <div className="inspection-case-actions">{item.actions.map(action => {
      const reason = action.blockedReason?.code ? reasonLabel(action.blockedReason.code) : undefined;
      return <button type="button" key={action.command}
        disabled={!current || !onOpenCommand || (!action.ready && !action.requiresInput)}
        title={!current ? tx("staleAction") : reason}
        onClick={() => current && onOpenCommand?.(current, action)}>
        {commands[action.command] || action.command.replaceAll("_", " ")} {action.requiresInput ? tx("needsInput") : action.ready ? tx("openCommand") : tx("blocked")}
      </button>;
    })}</div>}
    {!current && <small className="inspection-case-muted">{tx("staleAction")}</small>}
  </article>;
}

const readinessLabelKey: Record<string, string> = {
  stage: "currentStage",
  correctionCycle: "correctionCycle",
  correctionSubmitted: "correctionSubmitted",
  correctionVerified: "correctionVerified",
  currentReinspectionId: "currentReinspection",
  reinspectionPassed: "reinspectionPassed",
  closeReady: "closeReady",
  closeBlockedReasons: "closeBlockedReasons",
  ownerReportDraftReady: "ownerReportDraftReady",
  ownerReportIssuePending: "ownerReportIssuePending",
  ownerReceiptPending: "ownerReceiptPending",
  ownerReceiptConfirmed: "ownerReceiptConfirmed",
  ownerReportingComplete: "ownerReportingComplete",
};

function CaseIssue({ client, inspectionId, online, onChanged, group, workspace, onOpenCommand, tx }: {
  client: SupervisionClient;
  inspectionId: string;
  online: boolean;
  onChanged: () => Promise<void>;
  group: InspectionCase["issues"][number];
  workspace: Workspace;
  onOpenCommand?: (item: WorkItem, action: CommandDescriptor) => void;
  tx: (key: string) => string;
}) {
  const readiness = group.readiness as unknown as Record<string, unknown>;
  const related: Array<[string, WorkItem[]]> = [
    [tx("relatedObservation"), group.observations],
    [tx("relatedAction"), group.correctiveActions],
    [tx("relatedReinspection"), group.inspections],
    [tx("relatedOwnerReport"), group.ownerReports],
  ];
  const status = group.issue.record.status ? states[group.issue.record.status] || group.issue.record.status : tx("noStatus");
  return <article className="inspection-case-issue">
    <div className="inspection-case-issue-title"><h3>{tx("issuePrefix")} · {titleOf(group.issue)}</h3><span>{tx("version")}{group.issue.record.version} · {status}</span></div>
    <p className="inspection-case-muted">{tx("serverReadiness")} · {tx("correctionCycle")} {group.currentCorrectionCycle}</p>
    <div className="inspection-case-readiness">{Object.entries(readiness).filter(([key]) => key in readinessLabelKey).map(([key, value]) => <div key={key}><span>{tx(readinessLabelKey[key])}</span><strong>{readinessValue(key, value, tx)}</strong></div>)}</div>
    <LinkedRecord item={group.issue} workspace={workspace} onOpenCommand={onOpenCommand} tx={tx} />
    {related.map(([label, items]) => <section className="inspection-case-related" key={label}><h4>{label} <span>({items.length})</span></h4>
      {items.length ? items.map(item => <LinkedRecord key={`${item.machine}:${item.record.id}:${item.record.version}`} item={item} workspace={workspace} onOpenCommand={onOpenCommand} tx={tx} />) : <p className="inspection-case-muted">{tx("noRelatedRecords")}</p>}
      {label === tx("relatedOwnerReport") && <p className="inspection-case-muted">{tx("reportDraftBoundary")}</p>}
    </section>)}
    <InspectionCaseAuthoringPanel client={client} workspace={workspace} inspectionId={inspectionId} group={group} online={online} onChanged={onChanged} />
  </article>;
}

export function InspectionCaseFlowPanel({ client, workspace, online, onChanged, onSelect, onOpenCommand }: {
  client: SupervisionClient; workspace: Workspace; online: boolean; onChanged?: () => void; onSelect?: (id: string | null) => void;
  onOpenCommand?: (item: WorkItem, action: CommandDescriptor) => void;
}) {
  const { i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? i18n.language).slice(0, 2);
  const language: Locale = locale === "ko" || locale === "vi" ? locale : "en";
  const tx = useCallback((key: string) => copy[language][key] || copy.en[key] || key, [language]);
  const inspections = useMemo(() => workspace.items.filter(item => item.machine === "inspection"), [workspace.items]);
  const [selectedId, setSelectedId] = useState(""); const [graph, setGraph] = useState<InspectionCase | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState<{ code?: string; key?: string } | null>(null); const seq = useRef(0);
  const roleKey = `${workspace.project.id}:${workspace.role.id}:${workspace.role.roleCode}`;
  const selected = inspections.find(item => item.record.id === selectedId) || inspections[0];
  const load = useCallback(async (inspectionId: string) => {
    const requestId = ++seq.current; setLoading(true); setError(null); setGraph(null);
    try { const value = await getInspectionCase(client, inspectionId); if (requestId === seq.current) setGraph(value); }
    catch (cause) { if (requestId === seq.current) setError(errorLabel(cause)); }
    finally { if (requestId === seq.current) setLoading(false); }
  }, [client]);
  useEffect(() => {
    setGraph(null); setError(null); setSelectedId(inspections[0]?.record.id || "");
    return () => { seq.current += 1; };
  }, [roleKey]);
  useEffect(() => {
    if (selectedId && !inspections.some(item => item.record.id === selectedId)) setSelectedId("");
  }, [inspections, selectedId]);
  useEffect(() => {
    if (selected) void load(selected.record.id);
    else { setGraph(null); setLoading(false); }
  }, [selected?.record.id, selected?.record.version, roleKey, workspace.items, load]);
  return <section className="inspection-case-flow" data-ui-component="inspection-case-flow" data-testid="inspection-case-flow">
    <header className="inspection-case-flow-header"><div><h2>{tx("header")}</h2><p>{tx("description")}</p></div>
      <button type="button" onClick={() => selected && void load(selected.record.id)} disabled={!selected || loading}>{loading ? tx("refreshing") : tx("refresh")}</button></header>
    <label className="inspection-case-picker">{tx("rootInspection")}<select aria-label={tx("inspectionPicker")} value={selected?.record.id || ""} onChange={event => { const id = event.target.value; setSelectedId(id); onSelect?.(id || null); }}>
      <option value="">{tx("selectInspection")}</option>{inspections.map(item => <option key={item.record.id} value={item.record.id}>{titleOf(item)} · {item.record.id} · {tx("version")}{item.record.version}</option>)}
    </select></label>
    {!inspections.length && <p className="inspection-case-empty">{tx("noInspection")}</p>}
    {graph && <LinkedRecord item={graph.rootInspection} workspace={workspace} onOpenCommand={onOpenCommand} tx={tx} />}
    {loading && <p role="status">{tx("graphLoading")}</p>}{error && <div role="alert" className="inspection-case-error">{error.code ? reasonLabel(error.code) : tx(error.key || "loadError")}</div>}
    {graph && <><div className="inspection-case-summary" role="status"><strong>{tx("serverDecision")} · {graph.readiness.complete ? tx("complete") : tx("inProgress")}</strong><span>{tx("openIssues")} {graph.readiness.openIssueIds.length}</span><span>{tx("reportsPending")} {graph.readiness.ownerReportingPendingIssueIds.length}</span><span>{graph.issues.length} {tx("linkedIssues")}</span></div>
      {!graph.issues.length && <p className="inspection-case-empty">{tx("noLinkedIssues")}</p>}
      <div className="inspection-case-issues">{graph.issues.map(group => <CaseIssue key={group.issue.record.id} client={client} inspectionId={graph.rootInspection.record.id} online={online} onChanged={async () => { await onChanged?.(); await load(graph.rootInspection.record.id); }} group={group} workspace={workspace} onOpenCommand={onOpenCommand} tx={tx} />)}</div>
      {!!graph.ownerReports.length && <section className="inspection-case-related inspection-case-overall-reports"><h3>{tx("ownerReports")}</h3>{graph.ownerReports.map(report => <LinkedRecord key={report.record.id} item={report} workspace={workspace} onOpenCommand={onOpenCommand} tx={tx} />)}<p className="inspection-case-muted">{tx("ownerReportBoundary")}</p></section>}
      {!!graph.timeline.length && <details className="inspection-case-timeline"><summary>{tx("auditHistory")} ({graph.timeline.length})</summary><ol>{graph.timeline.map(event => <li key={event.id}><time>{formatDateTime(event.at)}</time><strong>{commands[event.command] || event.command}</strong><span>{states[event.beforeState] || event.beforeState} → {states[event.afterState] || event.afterState}</span><small>{event.objectRef.objectType} · {event.objectRef.objectId} · {tx("version")}{event.objectRef.version}</small></li>)}</ol></details>}
    </>}
  </section>;
}
