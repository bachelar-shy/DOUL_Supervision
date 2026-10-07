import { useEffect, useRef, useState } from "react";
import type { CommandDescriptor, RecordDTO, WorkItem, Workspace } from "../../data/ui-contract";
import type { SupervisionClient } from "../../data/supervision-client";
import { ActionButton, Panel, SectionHeader, StatusBadge } from "../../ui";
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
const titles: Record<string, string> = {
  affectedPermitRefs: "영향 작업허가", issueRefs: "연결 Issue", correctiveActionRefs: "시정조치",
  resumeVerificationRefs: "재개 재검증", ownerReportRefs: "발주자 보고", "issue.actionIds": "Issue 조치",
  "issue.inspectionIds": "Issue 재검사", "stopOrder.drawing": "도면", "stopOrder.location": "위치",
  "stopOrder.evidence": "안전 증빙",
};
const statuses: Record<string, string> = { readable: "열람 가능", missing: "대상 없음", unauthorized: "열람 권한 없음", foreign_project: "다른 프로젝트", invalid_reference: "참조 확인 필요" };
const collections: Record<string, string> = { safety_permit: "safety-permits", safety_stop_order: "safety-stop-orders", safety_equipment_inspection: "safety-equipment-inspections", issue: "issues", action: "actions", inspection: "inspections", report: "owner-reports", evidence: "evidence" };
const commandNames: Record<string, string> = { acknowledge_stop: "작업중지 확인", start_correction: "시정 시작", request_resume: "재개 요청", start_resume_verification: "재개 재검증 시작", lift_stop: "작업중지 해제", close_stop: "작업중지 종료" };

export function SafetyConnectedPanel({ client, workspace, onChanged, onSelect, onOpenCommand }: {
  client: SupervisionClient;
  workspace: Workspace;
  onChanged?: () => void;
  onSelect?: (id: string | null) => void;
  onOpenCommand?: (item: WorkItem, action: CommandDescriptor) => void;
}) {
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
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); })
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
      if (dto.version !== ref.version) throw new Error("원본 버전이 변경되었습니다. 최신 작업공간을 새로고침하십시오.");
      const key = link.relation + ref.objectId;
      setDetails(value => ({ ...value, [key]: dto }));
      if (item.machine !== "evidence" && item.machine !== "document") {
        const preflight = await client.request<CommandDescriptor[]>(client.path(path + "/available-actions"));
        if (sequence !== openSequence.current || selectedKey !== activeKeyRef.current) return;
        if (preflight.some(action => action.expectedVersion !== ref.version)) throw new Error("명령 기준 버전이 변경되었습니다. 최신 작업공간을 새로고침하십시오.");
        setActions(value => ({ ...value, [key]: preflight }));
      }
    } catch (reason) {
      if (sequence === openSequence.current && selectedKey === activeKeyRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const rootActions = active?.actions.filter(action =>
    action.expectedVersion === active.record.version && (action.ready || action.requiresInput),
  ) ?? [];

  return <section className="safety-connected" data-ui-component="safety-connected"><Panel>
    <SectionHeader title="안전 연결 추적" meta="읽기 전용 조회" />
    <p className="muted">SafetyStopOrder의 정확한 참조와 현재 명령 가용성을 확인합니다. 이 화면은 OwnerReport를 자동 발송하지 않습니다.</p>
    <div className="safety-connected-picker"><label htmlFor="safety-stop-pick">작업중지 원본</label><select id="safety-stop-pick" value={active?.record.id || ""} onChange={event => { setId(event.target.value); onSelect?.(event.target.value || null); onChanged?.(); }}><option value="">원본 선택</option>{stops.map(item => <option key={item.record.id} value={item.record.id}>{item.record.title || item.record.workName || item.record.id} · v{item.record.version}</option>)}</select></div>
    {!active && <p className="safety-connected-empty">현재 표시 가능한 SafetyStopOrder가 없습니다.</p>}
    {active && <><div className="safety-connected-root"><strong>{active.record.title || active.record.workName || "작업중지"}</strong><span>SafetyStopOrder · {active.record.id} · v{active.record.version}</span><StatusBadge status={active.record.status}>{active.record.status || "상태 확인"}</StatusBadge></div>
      <section className="safety-connected-commands" aria-label="현재 작업중지 명령"><h3>현재 작업중지 명령</h3><p>서버가 제공한 명령만 표시합니다. 재개 명령은 기존 증빙과 선행조건 검증을 거칩니다.</p>{rootActions.length ? rootActions.map(action => <ActionButton key={action.command} disabled={!onOpenCommand} onClick={() => onOpenCommand?.(active, action)}>{commandNames[action.command] || action.command} 열기{action.requiresInput && !action.ready ? " · 입력 후 서버 검증" : ""}</ActionButton>) : <span>현재 버전에서 열 수 있는 명령이 없습니다.</span>}</section>
    </>}
    {loading && <p role="status">연결 기록을 읽는 중…</p>}{error && <div role="alert" className="error-box">{error}</div>}
    {trace && <><p className="safety-connected-note">{trace.readOnly && !trace.officialStateChanged ? "읽기 전용 조회 · 공식 상태 변경 없음" : "상태 변경 여부를 확인할 수 없습니다."}</p><div className="safety-connected-grid">{trace.links.map((link, index) => {
      const ref = link.reference; const key = link.relation + (ref?.objectId || index);
      const current = !!ref && ref.version != null && workspace.items.some(item => item.record.id === ref.objectId && item.record.version === ref.version);
      const row = link.record || {}; const dto = details[key];
      const item = current ? workspace.items.find(candidate => candidate.record.id === ref?.objectId && candidate.record.version === ref?.version) : undefined;
      const exact = ref?.version != null && current && link.versionResolution === "exact_historical_version";
      return <article className="safety-connected-card" key={key}><div className="safety-connected-card-head"><strong>{titles[link.relation] || link.relation}</strong><span>{statuses[link.status] || link.status}</span></div>{link.status === "readable" && <>
        <div className="safety-connected-card-body"><strong>{row.subtype || ref?.objectType || "연결 기록"}</strong><span>{row.status ? `상태 · ${row.status}` : "상태 정보 없음"}</span><span>{ref?.version == null ? "원본에 버전이 없는 현재 조회" : `원본 v${ref.version}`}</span></div>
        <p className="safety-connected-version">{ref?.version == null ? "현재 조회 전용 · 원본 참조 버전 미기록" : !current ? "역사 또는 미확인 버전 · 변경 명령 비활성" : "현재 작업공간 버전과 일치"}</p>
        {exact && <ActionButton onClick={() => void open(link)}>상세 읽기</ActionButton>}
        {dto && <div className="safety-connected-detail"><strong>{dto.title || dto.workName || dto.subtype || "원본 상세"}</strong><span>{dto.status || "상태 없음"} · v{dto.version}</span></div>}
        {item && exact && (actions[key] || []).filter(action => action.expectedVersion === ref?.version && (action.ready || action.requiresInput)).map(action => <ActionButton key={action.command} disabled={!onOpenCommand} onClick={() => onOpenCommand?.(item, action)}>{commandNames[action.command] || action.command} 열기</ActionButton>)}
        {link.relation === "ownerReportRefs" && <p className="safety-connected-report">발주자 보고는 별도 발송·접수 절차로 처리됩니다. 이 화면은 보고를 발송하지 않습니다.</p>}
      </>}</article>;
    })}</div>{trace.diagnostics.length > 0 && <section className="safety-connected-diagnostics"><h3>참조 진단</h3>{trace.diagnostics.map((entry, index) => <p key={index}>{titles[entry.relation] || entry.relation} · {statuses[entry.status] || entry.status}</p>)}</section>}</>}
  </Panel></section>;
}
