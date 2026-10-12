import { useEffect, useMemo, useState } from "react";
import type { SupervisionClient } from "../data/supervision-client";
import type { Workspace, WorkItem } from "../data/ui-contract";
import "./field-checklist.css";

type Item = { key: string; label: string; type: "pass_fail" | "number" | "text" | "choice"; required?: boolean; options?: string[] };
type Template = { id: string; projectId: string; title: string; version: number; status: "draft" | "published" | "superseded"; items: Item[] };
type Answer = { value: string | number | null; checkedAt: string; checkedBy: string };
type Run = { id: string; version: number; templateId: string; templateVersion: number; templateSnapshot: Template; subjectRef: { objectType: string; objectId: string; version: number }; answers: Record<string, Answer>; status: "draft" };
type TemplatesResponse = { items: Template[] };
type RunsResponse = { items: Run[] };
const newItem = (): Item => ({ key: crypto.randomUUID(), label: "", type: "pass_fail", required: false });

const machineType: Record<string, string> = { inspection: "Inspection", issue: "Issue", action: "Action", report: "Report" };
export function FieldChecklistPanel({ client, workspace, online, subject }: {
  client: SupervisionClient; workspace: Workspace; online: boolean; subject?: WorkItem | null;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<Item[]>([newItem()]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState(false);
  const isAdmin = workspace.role.actorGroup === "ADM";
  const currentSubject = subject?.record;
  const pid = workspace.project.id;
  const subjectRef = useMemo(() => currentSubject
    ? { objectType: machineType[subject?.machine || ""] || (currentSubject.subtype === "Report" ? "WorkItem" : "WorkItem"),
        objectId: currentSubject.id, version: currentSubject.version }
    : null, [currentSubject, subject?.machine]);

  useEffect(() => {
    let cancelled = false;
    if (!online) return;
    const templateReq = client.request<TemplatesResponse>(client.path("/field/checklists/templates"));
    const runReq = currentSubject ? client.request<RunsResponse>(
      client.path("/field/checklists/runs?subjectId=" + encodeURIComponent(currentSubject.id)))
      : Promise.resolve({ items: [] as Run[] });
    void Promise.all([templateReq, runReq]).then(([templatesRes, runsRes]) => {
      if (cancelled) return;
      setTemplates(templatesRes.items);
      setRuns(runsRes.items);
      setError("");
    }).catch(() => { if (!cancelled) setError("체크리스트를 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, [client, pid, currentSubject?.id, refresh, online]);

  const published = templates.filter(item => item.status === "published");
  const draft = templates.find(item => item.id === selectedTemplate && item.status === "draft");
  async function api<T>(path: string, body: object): Promise<T> {
    return client.request<T>(client.path(path), {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
    });
  }
  async function saveTemplate() {
    if (!isAdmin || !online) return;
    const clean = items.map(i => ({ ...i, label: i.label.trim(),
      options: i.type === "choice" ? i.options?.filter(Boolean) || [] : undefined }));
    setBusy(true); setError("");
    try {
      await api("/field/checklists/templates", { title, items: clean });
      setTitle(""); setItems([newItem()]); setEditing(false); setRefresh(v => v + 1);
    } catch { setError("양식을 저장하지 못했습니다. 항목과 관리자 권한을 확인하십시오."); }
    finally { setBusy(false); }
  }
  async function publishTemplate(template: Template) {
    setBusy(true); setError("");
    try {
      await api("/field/checklists/templates/" + template.id + "/publish", { expectedVersion: template.version });
      setRefresh(v => v + 1);
    } catch { setError("발행할 수 없습니다. 최신 개정을 확인하십시오."); }
    finally { setBusy(false); }
  }
  async function reviseTemplate(template: Template) {
    setBusy(true); setError("");
    try {
      await api("/field/checklists/templates/" + template.id + "/revise",
        { expectedVersion: template.version, title: template.title, items: template.items });
      setSelectedTemplate(template.id); setRefresh(v => v + 1);
    } catch { setError("새 개정을 작성하지 못했습니다."); }
    finally { setBusy(false); }
  }
  async function attach() {
    const current = published.find(item => item.id === selectedTemplate)
      || published.find(item => item.id === published[0]?.id);
    if (!subjectRef || !current) return;
    setBusy(true); setError("");
    try {
      await api("/field/checklists/runs", { subjectRef, templateId: current.id, templateVersion: current.version });
      setRefresh(v => v + 1);
    } catch { setError("해당 업무에 체크리스트를 연결할 수 없습니다. 권한과 기록 버전을 확인하십시오."); }
    finally { setBusy(false); }
  }
  async function changeAnswer(run: Run, item: Item, value: string | number | null) {
    if (!online) { setError("오프라인 답변은 로컬 작업함에 보관 후 동기화해야 합니다."); return; }
    setBusy(true); setError("");
    try {
      const result = await api<{ run: Run }>("/field/checklists/runs/" + run.id + "/answers",
        { expectedVersion: run.version, answers: { [item.key]: value } });
      setRuns(prev => prev.map(old => old.id === run.id ? result.run : old));
    } catch { setError("체크 결과를 기록하지 못했습니다. 다른 담당자가 변경했는지 확인하십시오."); }
    finally { setBusy(false); }
  }
  function updateItem(index: number, change: Partial<Item>) {
    setItems(prev => prev.map((row, i) => i === index ? { ...row, ...change } : row));
  }

  return <section className="fw-checklists" aria-label="공통 검측 체크리스트">
    <header className="fw-checklist-header">
      <div><h3>공통 검측 체크리스트</h3><p>공종별 점검표의 발행본을 연결합니다. 작성 기록은 공식 검측 판정과 별개입니다.</p></div>
      <span>{published.length}개 발행본</span>
    </header>
    {error && <p role="alert">{error}</p>}
    {subjectRef && <div className="fw-checklist-attach">
      <label>업무에 체크리스트 추가<select aria-label="체크리스트 선택" value={selectedTemplate}
        onChange={event => setSelectedTemplate(event.target.value)}>
        <option value="">점검표 선택</option>
        {published.map(t => <option key={t.id + ":" + t.version} value={t.id}>{t.title} · v{t.version}</option>)}
      </select></label>
      <button type="button" disabled={!online || busy || !published.length || !selectedTemplate}
        onClick={() => void attach()}>추가</button>
    </div>}
    {runs.map(run => <div className="fw-checklist-run" key={run.id}>
      <h4>{run.templateSnapshot.title} <small>v{run.templateVersion} · 작성본</small></h4>
      <div className="fw-checklist-lines">
        {run.templateSnapshot.items.map(item => {
          const answer = run.answers[item.key];
          return <label key={item.key} className="fw-checklist-line">
            <span>{item.label}{item.required ? " *" : ""}</span>
            {item.type === "pass_fail" ?
              <select aria-label={item.label} value={answer?.value == null ? "" : String(answer.value)}
                disabled={busy || !online} onChange={e => void changeAnswer(run, item, e.target.value)}>
                <option value="">미점검</option><option value="pass">적합</option><option value="fail">부적합</option><option value="na">해당없음</option>
              </select> : item.type === "choice" ?
              <select aria-label={item.label} value={answer?.value == null ? "" : String(answer.value)}
                disabled={busy || !online} onChange={e => void changeAnswer(run, item, e.target.value)}>
                <option value="">선택</option>{(item.options || []).map(o => <option key={o}>{o}</option>)}
              </select> :
              <input aria-label={item.label} defaultValue={answer?.value == null ? "" : String(answer.value)}
                key={run.version} type={item.type === "number" ? "number" : "text"} disabled={busy || !online}
                onBlur={e => { const value = e.target.value; if (value) void changeAnswer(run, item, item.type === "number" ? Number(value) : value); }} />}
            {answer && <small>{takeDate(answer.checkedAt)} · {answer.checkedBy.slice(0, 8)}</small>}
          </label>;
        })}
      </div>
      <p className="fw-checklist-disclaimer">확인 결과는 현재 업무에 첨부된 참고 점검기록입니다. 공식 검측 합격·승인 상태는 변경되지 않습니다.</p>
    </div>)}
    {!runs.length && subjectRef && <p className="fw-checklist-empty">이 업무에 등록된 체크리스트가 없습니다.</p>}
    {isAdmin && <details className="fw-checklist-admin" open={editing}>
      <summary onClick={() => setEditing(v => !v)}>점검표 양식 관리</summary>
      <div className="fw-checklist-admin-list">{templates.map(t => <div key={t.id + ":" + t.version}>
        <span>{t.title} · v{t.version} · {t.status === "draft" ? "편집중" : "발행됨"}</span>
        {t.status === "draft" && <button disabled={busy} onClick={() => void publishTemplate(t)}>발행</button>}
        {t.status === "published" && <button disabled={busy} onClick={() => void reviseTemplate(t)}>개정본 만들기</button>}
      </div>)}</div>
      <h4>새 점검표</h4>
      <label>양식명<input value={title} onChange={e => setTitle(e.target.value)} /></label>
      {items.map((item, index) => <div className="fw-checklist-editor-row" key={item.key}>
        <input aria-label={"점검항목 " + (index + 1)} placeholder="검측 항목" value={item.label}
          onChange={e => updateItem(index, { label: e.target.value })} />
        <select aria-label="답변 유형" value={item.type}
          onChange={e => updateItem(index, { type: e.target.value as Item["type"] })}>
          <option value="pass_fail">적합/부적합</option><option value="number">수치</option>
          <option value="text">문자</option><option value="choice">선택형</option>
        </select>
        <label><input type="checkbox" checked={!!item.required} onChange={e => updateItem(index, { required: e.target.checked })} />필수</label>
        {item.type === "choice" && <input aria-label="선택지" placeholder="선택지1, 선택지2"
          value={(item.options || []).join(", ")} onChange={e => updateItem(index, { options: e.target.value.split(",").map(s => s.trim()) })} />}
        <button type="button" disabled={items.length === 1} onClick={() => setItems(prev => prev.filter((_,i) => i !== index))}>삭제</button>
      </div>)}
      <div className="fw-checklist-actions">
        <button type="button" onClick={() => setItems(prev => prev.length < 500 ? [...prev,newItem()] : prev)} disabled={items.length >= 500}>항목 추가</button>
        <button type="button" className="primary" disabled={!online || busy || !title.trim() || items.some(i => !i.label.trim())} onClick={() => void saveTemplate()}>양식 저장</button>
      </div>
      {draft && <p>편집 중인 개정본: {draft.title} · v{draft.version} (기존 발행본 유지)</p>}
    </details>}
  </section>;
}
function takeDate(timestamp?: string) { return timestamp?.slice(0, 16).replace("T", " ") || ""; }
