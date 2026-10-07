import { useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CommandDescriptor, WorkItem, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { ApiError } from "../data/supervision-client";
import { scheduleInputs } from "../data/schedule-fields.generated";
import { describeCommandAvailability } from "../data/ui-presentation";
import { commands, fields, reasonLabel, states } from "../labels";
import { ActionButton, Panel, SectionHeader, StatusBadge } from "../ui";
import { ActionGate, DetailPane, StatusBoundaryGroup } from "../ui/catalog";
import { WorkbenchTemplate } from "../ui/templates";
import { PageBoundary } from "./PageBoundary";
import { recordTitle } from "./record-utils";
import { RecordList } from "./shared";

const tabs = [
  { id: "schedule_baseline", label: "기준공정", description: "승인된 비교 기준입니다. 진도·예측 변경으로 덮어쓰지 않습니다." },
  { id: "schedule_progress", label: "진도기록", description: "기준일별 실적·예측 기록입니다. 확정 후 정정은 새 기록과 사유로 남깁니다." },
  { id: "delay_event", label: "지연사건", description: "지연 사실과 영향평가를 관리합니다. 지연 확인은 공기연장 승인이 아닙니다." },
  { id: "recovery_plan", label: "회복계획", description: "회복계획 수락·실행·효과를 관리합니다. 기준공정과 계약 결정은 별도입니다." },
];
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function display(value: unknown): string {
  if (value === undefined || value === null || value === "") return "기록 없음";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (Array.isArray(value)) return value.length ? value.map(display).join(" · ") : "연결 없음";
  if (typeof value === "object") {
    const ref = object(value);
    if (ref.objectId) return `${ref.objectType} · ${ref.objectId} · v${ref.version}`;
    return JSON.stringify(value);
  }
  return String(value);
}
function scheduleState(item: WorkItem) {
  const state = item.record.status || "";
  if (state === "active" && item.machine === "recovery_plan") return "회복계획 실행 중";
  if (state === "effective" && item.machine === "recovery_plan") return "회복효과 확인";
  if (state === "completed" && item.machine === "recovery_plan") return "회복계획 완료";
  if (state === "verification" && item.machine === "schedule_progress") return "진도 검증";
  return states[state] || state;
}
function sourceData(item: WorkItem) { return object(item.record.schedule ?? item.record.data); }

function ScheduleDetail({ item, workspace }: { item: WorkItem; workspace: Workspace }) {
  const data = sourceData(item);
  const baselineRef = object(data.baselineScheduleRef);
  const baseline = workspace.items.find(x => x.record.id === baselineRef.objectId && x.record.version === baselineRef.version);
  const baselineData = item.machine === "schedule_baseline" ? data : baseline ? sourceData(baseline) : {};
  return <>
    <StatusBoundaryGroup title="공정 기준 · 예측 · 기준일" description="각 값은 저장된 원본을 표시합니다. 기록이 없으면 공정 상태를 추정하지 않습니다."
      items={[
        { id: "baseline", label: "기준공정 완료일", value: display(baselineData.contractualCompletionAt), detail: baseline ? `${recordTitle(baseline.record)} · v${baseline.record.version}` : "해당 원본의 계약 완료일" },
        { id: "forecast", label: "예측 완료일", value: display(data.forecastCompletionAt ?? data.currentForecastCompletionAt), detail: "현재 원본에 기록된 예측" },
        { id: "data-date", label: "기준일", value: display(data.dataDate), detail: "진도 판단의 기준일 보존" },
      ]} />
    <div className="meta-grid mt-3">
      <div><span>원본 ID</span><strong className="break-all">{item.record.id}</strong></div>
      <div><span>원본 버전</span><strong>v{item.record.version}</strong></div>
      <div><span>원본 파일 해시</span><strong className="break-all">{display(data.sourceFileHash)}</strong></div>
      <div><span>공정 원본 파일 버전</span><strong>{display(data.sourceFileVersion)}</strong></div>
    </div>
    <section className="detail-section" aria-label="공정 원본 상세">
      <SectionHeader title="공정 원본 상세" meta="서버 저장값" />
      <dl className="grid gap-3 sm:grid-cols-2">
        {Object.entries(data).map(([key, value]) => <div key={key} className="min-w-0 border-b border-border pb-2">
          <dt className="text-xs text-slate-500">{fields[key] || key}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-all text-xs">{display(value)}</dd>
        </div>)}
      </dl>
    </section>
    <section className="detail-section" aria-label="보고 및 계약 연결">
      <SectionHeader title="발주처 보고 · 계약 연결" />
      <p className="muted">업무 종결과 발주처 후속조치 종결은 각각 확인합니다. 공기연장 결정 기능은 별도 구현 단계입니다.</p>
      <dl className="grid gap-3 sm:grid-cols-2 mt-3">
        {["ownerReportRefs", "decisionRefs", "ownerDecisionRef", "contractNoticeRefs", "claimRefs", "eotDecisionRef", "contractTrackRefs"].map(key =>
          <div key={key}><dt className="text-xs text-slate-500">{fields[key] || key}</dt><dd className="break-all text-xs">{display(data[key])}</dd></div>)}
      </dl>
    </section>
  </>;
}

function CreateSchedule({ machine, workspace, client, online, onCreated, onClose }: {
  machine: string; workspace: Workspace; client: SupervisionClient; online: boolean;
  onCreated: (id: string) => Promise<void>; onClose: () => void;
}) {
  const schema = scheduleInputs[machine];
  const [values, setValues] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const identity = useRef({ id: crypto.randomUUID(), key: crypto.randomUUID(), body: "" });
  const isSchedule = machine.startsWith("schedule_");
  const requiresEvidence = machine === "delay_event";
  const evidenceItems = workspace.items.filter(item => item.machine === "evidence");
  async function submit() {
    setError(""); setBusy(true);
    try {
      if (!online) throw new Error("연결 복구 후 다시 제출하십시오.");
      if (!title.trim()) throw new Error("제목을 입력하십시오.");
      if (requiresEvidence && evidenceIds.length === 0) throw new Error("지연사건에는 현장 증빙을 1건 이상 연결하십시오.");
      const data: Record<string, unknown> = {};
      for (const [key, spec] of Object.entries(schema.fields)) {
        const text = values[key]?.trim();
        if (!text) continue;
        if (spec.type === "number" || spec.type === "integer") {
          const n = Number(text);
          if (!Number.isFinite(n) || (spec.type === "integer" && !Number.isInteger(n))) throw new Error(`${fields[key] || key}: 숫자를 입력하십시오.`);
          data[key] = n;
        } else if (spec.type === "boolean") data[key] = text === "true";
        else if (spec.type === "array" || spec.type === "object") data[key] = JSON.parse(text);
        else data[key] = text;
      }
      for (const key of schema.required) {
        if (key !== "scheduleKind" && data[key] === undefined) throw new Error(`${fields[key] || key}: 필수 입력입니다.`);
      }
      if (isSchedule) data.scheduleKind = machine === "schedule_baseline" ? "baseline" : "progress_update";
      const payload = { ...workspace.context.scope, title: title.trim(),
        ...(requiresEvidence ? { evidenceIds } : {}),
        ...(isSchedule ? { revision: data.revision, fileIds: data.sourceFileRef ? [data.sourceFileRef] : [], schedule: data } : { data }) };
      const body = JSON.stringify(payload);
      if (identity.current.body && identity.current.body !== body) identity.current = { id: crypto.randomUUID(), key: crypto.randomUUID(), body };
      identity.current.body = body;
      const result = await client.create(machine, payload, identity.current.id, identity.current.key);
      await onCreated(result.record.id);
    } catch (e) { setError(e instanceof ApiError ? `${reasonLabel(e.detail.code)} ${e.message}` : String(e)); }
    finally { setBusy(false); }
  }
  function input(key: string) {
    const spec = schema.fields[key];
    return <label key={key}>{fields[key] || key}{schema.required.includes(key) ? " *" : ""}
      {spec.type === "boolean" || spec.enum ? <select value={values[key] || ""} onChange={e => setValues({...values, [key]: e.target.value})}>
        <option value="">선택</option>
        {(spec.enum || ["false", "true"]).map(value => <option value={value} key={value}>{value === "true" ? "예" : value === "false" ? "아니오" : value}</option>)}
      </select> : <textarea value={values[key] || ""} rows={spec.type === "object" || spec.type === "array" ? 3 : 1}
        onChange={e => setValues({...values, [key]: e.target.value})} placeholder={spec.type === "object" || spec.type === "array" ? "JSON · 원본 ID와 버전 참조" : key.endsWith("At") || key === "dataDate" ? "RFC3339 · 시간대 포함" : fields[key] || key} />}
    </label>;
  }
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="공정 기록 추가">
    <div className="section-heading"><h2>{tabs.find(x => x.id === machine)?.label} 기록 추가</h2><button aria-label="대화상자 닫기" onClick={onClose} disabled={busy}>×</button></div>
    <p className="muted">원본 파일과 정확한 버전 참조를 입력하십시오. 권한·공정 연계·필수자료는 제출 시 서버가 검증합니다.</p>
    <div className="modal-fields"><label>제목 *<input value={title} onChange={e => setTitle(e.target.value)} /></label>
      {requiresEvidence && <label>현장 증빙 *<select multiple value={evidenceIds} size={Math.min(6, Math.max(3, evidenceItems.length))}
        onChange={e => setEvidenceIds([...e.target.selectedOptions].map(option => option.value))}>
        {evidenceItems.map(item => <option key={item.record.id} value={item.record.id}>{recordTitle(item.record)} · {item.record.id}</option>)}
      </select><span className="muted">현재 프로젝트에 보존된 증빙을 1건 이상 선택하십시오.</span></label>}
      {schema.required.filter(key => key !== "scheduleKind").map(input)}
    </div>
    <details><summary>추가 공정자료 · 참조 · 정정 사유</summary><div className="modal-fields">{Object.keys(schema.fields).filter(key => !schema.required.includes(key)).map(input)}</div></details>
    {error && <div role="alert" className="error-box">{error}</div>}
    <div className="modal-actions"><button className="secondary" disabled={busy} onClick={onClose}>취소</button><button className="primary" disabled={busy || !online} onClick={() => void submit()}>{busy ? "검증 중…" : "기록 추가"}</button></div>
  </section></div>;
}

export function SchedulePage({ client, workspace, selected, current, online, onSelect, onOpenCommand, refresh }: {
  client: SupervisionClient; workspace: Workspace; selected: string | null; current: WorkItem | null; online: boolean;
  onSelect: (id: string | null) => void; onOpenCommand: (item: WorkItem, action: CommandDescriptor) => void; refresh: () => Promise<void>;
}) {
  const [machine, setMachine] = useState("schedule_baseline");
  const [creating, setCreating] = useState(false);
  const active = current && tabs.some(x => x.id === current.machine) ? current.machine : machine;
  const tab = tabs.find(x => x.id === active)!;
  const items = workspace.items.filter(x => x.machine === active);
  const item = current?.machine === active ? current : null;
  return <PageBoundary name="schedule"><section data-ui-component="schedule-workspace">
    <Tabs value={active} onValueChange={value => { setMachine(value); onSelect(null); }} className="mb-4 gap-0 overflow-hidden rounded-sm border border-border bg-white">
      <TabsList variant="line" className="w-full justify-start flex-wrap h-auto border-b border-border px-3">
        {tabs.map(t => <TabsTrigger key={t.id} value={t.id} className="min-h-11 flex-none px-3 text-xs">{t.label}</TabsTrigger>)}
      </TabsList><p className="px-4 py-3 text-xs text-slate-500">{tab.description}</p>
    </Tabs>
    <WorkbenchTemplate hasDetail={Boolean(item)}>
      <Panel className="list-pane"><SectionHeader title={tab.label} meta={`${items.length}건`} />
        <ActionButton disabled={!online || client.kind === "mock"} onClick={() => setCreating(true)}>공정 기록 추가</ActionButton>
        <RecordList statusLabel={scheduleState} contextLabel={x => `${x.record.packageId || "범위 미기록"} · ${x.record.discipline || "분야 미기록"}`} items={items} selected={selected} onSelect={x => onSelect(x.record.id)} />
      </Panel>
      <DetailPane>{!item ? <div className="empty compact"><h2>{tab.label} 상세</h2><p>원본을 선택해 날짜·버전·연결 기록과 가능한 명령을 확인하십시오.</p></div> : <>
        <button className="mobile-back" onClick={() => onSelect(null)}>← 목록</button>
        <div className="detail-head"><div><span className="eyebrow">{tab.label}</span><h2>{recordTitle(item.record)}</h2></div><StatusBadge status={item.record.status}>{scheduleState(item)}</StatusBadge></div>
        <ScheduleDetail item={item} workspace={workspace} />
        <div className="detail-section"><SectionHeader title="가능한 업무 명령" meta="서버 권한 · 선행조건" />
          {item.actions.length ? <ActionGate actions={item.actions.map(action => {
            const presentation = describeCommandAvailability(action, online);
            return { id: action.command, label: commands[action.command] || action.command, primary: action.ready,
              disabled: presentation.disabled, availability: presentation.availability, availabilityLabel: presentation.label,
              reason: presentation.reason, onAction: () => onOpenCommand(item, action) };
          })} /> : <div className="empty compact">현재 역할과 상태에서 가능한 명령이 없습니다.</div>}
        </div>
      </>}</DetailPane>
    </WorkbenchTemplate>
    {creating && <CreateSchedule machine={active} workspace={workspace} client={client} online={online} onClose={() => setCreating(false)}
      onCreated={async id => { setCreating(false); await refresh(); onSelect(id); }} />}
  </section></PageBoundary>;
}
