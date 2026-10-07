import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommandDescriptor, WorkItem, Workspace } from "../../data/ui-contract";
import type { SupervisionClient } from "../../data/supervision-client";
import { getInspectionCase } from "../../data/inspection-case-flow-client";
import type { InspectionCase } from "../../data/inspection-case-flow-client";
import { commands } from "../../labels";
import "./inspection-case-flow.css";

const titleOf = (item: WorkItem) => item.record.title || item.record.workName || item.record.subtype || item.record.id;
const machineNames: Record<string, string> = { inspection: "검측", issue: "Issue", observation: "관찰", action: "시정조치", report: "발주자 보고" };
const readinessNames: Record<string, string> = {
  stage: "현재 단계", correctionCycle: "시정 주기", correctionSubmitted: "시정조치 제출", correctionVerified: "시정조치 검증",
  currentReinspectionId: "현재 재검측", reinspectionPassed: "재검측 합격", closeReady: "Issue 종결 준비",
  closeBlockedReasons: "종결 차단 사유", ownerReportDraftReady: "종결보고 초안 준비", ownerReportIssuePending: "발주자 보고 발행 대기",
  ownerReceiptPending: "발주자 수령 대기", ownerReceiptConfirmed: "발주자 수령 확인", ownerReportingComplete: "발주자 보고 완료",
};
const readinessValue = (value: unknown) => typeof value === "boolean" ? value ? "예" : "아니요"
  : Array.isArray(value) ? value.length ? value.join(", ") : "없음" : value == null || value === "" ? "없음" : String(value);

function LinkedRecord({ item, workspace, onOpenCommand }: { item: WorkItem; workspace: Workspace; onOpenCommand?: (item: WorkItem, action: CommandDescriptor) => void }) {
  const current = workspace.items.find(candidate => candidate.machine === item.machine && candidate.record.id === item.record.id && candidate.record.version === item.record.version);
  return <article className="inspection-case-record">
    <div className="inspection-case-record-heading"><strong>{titleOf(item)}</strong><span>{machineNames[item.machine] || item.machine} · {item.record.id} · v{item.record.version}</span></div>
    <div className="inspection-case-record-meta">상태 · {item.record.status || "확인 정보 없음"}</div>
    {!!item.actions?.length && <div className="inspection-case-actions">{item.actions.map(action => <button type="button" key={action.command}
      disabled={!current || !onOpenCommand || (!action.ready && !action.requiresInput)} title={!current ? "최신 작업공간 기록과 버전이 일치하지 않습니다." : action.blockedReason?.message || undefined}
      onClick={() => current && onOpenCommand?.(current, action)}>{commands[action.command] || action.command.replaceAll("_", " ")} {action.requiresInput ? "입력 필요" : action.ready ? "열기" : "차단됨"}</button>)}</div>}
    {!current && <small className="inspection-case-muted">최신 작업공간과 버전이 일치하지 않아 명령을 열 수 없습니다.</small>}
  </article>;
}
function CaseIssue({ group, workspace, onOpenCommand }: { group: InspectionCase["issues"][number]; workspace: Workspace; onOpenCommand?: (item: WorkItem, action: CommandDescriptor) => void }) {
  const readiness = group.readiness as unknown as Record<string, unknown>;
  const related: Array<[string, WorkItem[]]> = [["관찰", group.observations], ["시정조치", group.correctiveActions], ["재검측", group.inspections], ["발주자 보고", group.ownerReports]];
  return <article className="inspection-case-issue">
    <div className="inspection-case-issue-title"><h3>Issue · {titleOf(group.issue)}</h3><span>v{group.issue.record.version} · {group.issue.record.status || "상태 확인"}</span></div>
    <p className="inspection-case-muted">서버 준비상태 · 시정 주기 {group.currentCorrectionCycle}</p>
    <div className="inspection-case-readiness">{Object.entries(readiness).filter(([key]) => key in readinessNames).map(([key, value]) => <div key={key}><span>{readinessNames[key]}</span><strong>{readinessValue(value)}</strong></div>)}</div>
    <LinkedRecord item={group.issue} workspace={workspace} onOpenCommand={onOpenCommand} />
    {related.map(([label, items]) => <section className="inspection-case-related" key={label}><h4>{label} <span>({items.length})</span></h4>
      {items.length ? items.map(item => <LinkedRecord key={`${item.machine}:${item.record.id}:${item.record.version}`} item={item} workspace={workspace} onOpenCommand={onOpenCommand} />) : <p className="inspection-case-muted">서버에서 연결된 기록이 없습니다.</p>}
      {label === "발주자 보고" && <p className="inspection-case-muted">보고 초안 생성과 발송·접수는 별도 절차입니다. 이 패널은 보고를 만들거나 보내지 않습니다.</p>}
    </section>)}
  </article>;
}

export function InspectionCaseFlowPanel({ client, workspace, onSelect, onOpenCommand }: {
  client: SupervisionClient; workspace: Workspace; onChanged?: () => void; onSelect?: (id: string | null) => void;
  onOpenCommand?: (item: WorkItem, action: CommandDescriptor) => void;
}) {
  const inspections = useMemo(() => workspace.items.filter(item => item.machine === "inspection"), [workspace.items]);
  const [selectedId, setSelectedId] = useState(""); const [graph, setGraph] = useState<InspectionCase | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const seq = useRef(0);
  const roleKey = `${workspace.project.id}:${workspace.role.id}:${workspace.role.roleCode}`;
  const selected = inspections.find(item => item.record.id === selectedId) || inspections[0];
  const load = useCallback(async (inspectionId: string) => {
    const requestId = ++seq.current; setLoading(true); setError(""); setGraph(null);
    try { const value = await getInspectionCase(client, inspectionId); if (requestId === seq.current) setGraph(value); }
    catch (cause) { if (requestId === seq.current) { const message = cause instanceof Error ? cause.message : String(cause); setError(/409|VERSION_CONFLICT|stale/i.test(message) ? "기록 버전이 변경되었습니다. 최신 작업공간에서 다시 조회하십시오." : message); } }
    finally { if (requestId === seq.current) setLoading(false); }
  }, [client]);
  useEffect(() => {
    setGraph(null); setError(""); setSelectedId(inspections[0]?.record.id || "");
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
    <header className="inspection-case-flow-header"><div><h2>검측 사례 흐름</h2><p>서버가 명시적으로 연결한 원 검측 · Issue · 시정조치 · 재검측 · 발주자 보고와 준비상태를 조회합니다.</p></div>
      <button type="button" onClick={() => selected && void load(selected.record.id)} disabled={!selected || loading}>{loading ? "조회 중…" : "새로고침"}</button></header>
    <label className="inspection-case-picker">원 검측<select aria-label="원 검측 선택" value={selected?.record.id || ""} onChange={event => { const id = event.target.value; setSelectedId(id); onSelect?.(id || null); }}>
      <option value="">검측 선택</option>{inspections.map(item => <option key={item.record.id} value={item.record.id}>{titleOf(item)} · {item.record.id} · v{item.record.version}</option>)}
    </select></label>
    {!inspections.length && <p className="inspection-case-empty">현재 작업공간에서 열람할 수 있는 원 검측이 없습니다.</p>}
    {graph && <LinkedRecord item={graph.rootInspection} workspace={workspace} onOpenCommand={onOpenCommand} />}
    {loading && <p role="status">검측 사례 그래프를 조회하는 중…</p>}{error && <div role="alert" className="inspection-case-error">{error}</div>}
    {graph && <><div className="inspection-case-summary" role="status"><strong>서버 판정 · {graph.readiness.complete ? "사례 완료" : "진행 중"}</strong><span>열린 Issue {graph.readiness.openIssueIds.length}</span><span>발주자 보고 대기 {graph.readiness.ownerReportingPendingIssueIds.length}</span><span>{graph.issues.length}개 연결 Issue</span></div>
      {!graph.issues.length && <p className="inspection-case-empty">이 검측에 서버가 연결한 Issue가 없습니다. 다른 검측 사례를 선택할 수 있습니다.</p>}
      <div className="inspection-case-issues">{graph.issues.map(group => <CaseIssue key={group.issue.record.id} group={group} workspace={workspace} onOpenCommand={onOpenCommand} />)}</div>
      {!!graph.ownerReports.length && <section className="inspection-case-related inspection-case-overall-reports"><h3>사례 발주자 보고</h3>{graph.ownerReports.map(report => <LinkedRecord key={report.record.id} item={report} workspace={workspace} onOpenCommand={onOpenCommand} />)}<p className="inspection-case-muted">이 화면은 발주자 보고를 발송하거나 접수 처리하지 않습니다.</p></section>}
      {!!graph.timeline.length && <details className="inspection-case-timeline"><summary>서버 감사 이력 ({graph.timeline.length})</summary><ol>{graph.timeline.map(event => <li key={event.id}><time>{event.at}</time><strong>{event.command}</strong><span>{event.beforeState} → {event.afterState}</span><small>{event.objectRef.objectType} · {event.objectRef.objectId} · v{event.objectRef.version}</small></li>)}</ol></details>}
    </>}
  </section>;
}
