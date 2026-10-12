import { useEffect, useMemo, useState } from "react";
import type { SupervisionClient } from "../data/supervision-client";
import type { WorkItem, Workspace } from "../data/ui-contract";
import "./field-task-discussions.css";

type Ref = { objectType: string; objectId: string; version: number };
type Comment = { id: string; createdAt: string; authorPartyId: string; message: string;
  mentionPartyIds: string[]; evidenceRefs: Ref[]; officialDecision: false };
type Thread = { items: Comment[]; count: number; watcherCount: number; watching: boolean };
const kindOf: Record<string, string> = {
  observation: "Observation", inspection: "Inspection", issue: "Issue", action: "Action",
  rfi: "WorkItem", change: "WorkItem", report: "InformationItem", decision: "Decision",
  approval: "Approval", analysis_run: "AnalysisRun",
};

export function FieldTaskDiscussions({ client, workspace, subject, online }: {
  client: SupervisionClient; workspace: Workspace; subject: WorkItem; online: boolean;
}) {
  const ref = useMemo<Ref>(() => ({ objectType: kindOf[subject.machine] || "WorkItem",
    objectId: subject.record.id, version: subject.record.version }),
    [subject.machine, subject.record.id, subject.record.version]);
  const [thread, setThread] = useState<Thread>({ items: [], count: 0, watcherCount: 0, watching: false });
  const [text, setText] = useState("");
  const [mentioned, setMentioned] = useState<string[]>([]);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | "messages" | "attachments">("all");
  const [order, setOrder] = useState<"oldest" | "newest">("oldest");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const projectId = workspace.project.id;
  const names = useMemo(() => new Map(workspace.participants.map(p => [p.partyId, p.name])), [workspace.participants]);
  const availableEvidence = workspace.items.filter(i => i.machine === "evidence").slice(0, 50);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    const params = new URLSearchParams({
      subjectType: ref.objectType, subjectId: ref.objectId,
      version: String(ref.version), sort: order,
    });
    void client.request<Thread>(client.path("/field/discussions?" + params.toString()))
      .then(data => { if (!cancelled) { setThread(data); setError(""); } })
      .catch(() => { if (!cancelled) setError("업무 대화 내용을 불러올 수 없습니다."); });
    return () => { cancelled = true; };
  }, [client, projectId, ref.objectType, ref.objectId, ref.version, order, refresh, online]);

  async function send(path: string, body: object) {
    return client.request(client.path(path), { method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
  }
  async function post() {
    if (!text.trim() || !online || busy) return;
    setBusy(true); setError("");
    try {
      await send("/field/discussions/comments", { subjectRef: ref, message: text.trim(),
        mentionPartyIds: mentioned, evidenceRefs: availableEvidence.filter(i => evidence.includes(i.record.id))
          .map(i => ({ objectType: "Evidence", objectId: i.record.id, version: i.record.version })) });
      setText(""); setMentioned([]); setEvidence([]); setRefresh(v => v + 1);
    } catch { setError("댓글을 등록하지 못했습니다. 참조인·첨부파일의 권한과 업무 버전을 확인하십시오."); }
    finally { setBusy(false); }
  }
  async function toggleWatch() {
    if (!online || busy) return;
    setBusy(true); setError("");
    try {
      await send("/field/discussions/watch", { subjectRef: ref, watch: !thread.watching });
      setRefresh(v => v + 1);
    } catch { setError("참조인 설정을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  }
  const shown = thread.items.filter(m => filter !== "attachments" || m.evidenceRefs.length > 0);
  return <section className="fw-discussion" aria-label="업무별 대화">
    <header className="fw-discussion-header"><h3>업무별 대화 <small>{thread.count}건</small></h3>
      <button type="button" disabled={!online || busy} onClick={() => void toggleWatch()}>
        {thread.watching ? "참조 해제" : "참조하기"} · {thread.watcherCount}
      </button></header>
    <nav className="fw-discussion-controls" aria-label="대화 보기">
      <select aria-label="대화 내용 필터" value={filter}
        onChange={e => setFilter(e.target.value as typeof filter)}>
        <option value="all">전체</option><option value="messages">대화</option><option value="attachments">첨부 포함</option>
      </select>
      <select aria-label="대화 정렬" value={order} onChange={e => setOrder(e.target.value as typeof order)}>
        <option value="oldest">오래된 순</option><option value="newest">최신 순</option>
      </select>
    </nav>
    {error && <p role="alert">{error}</p>}
    <div className="fw-discussion-feed">
      {shown.map(row => <article key={row.id} className="fw-discussion-entry">
        <header><strong>{names.get(row.authorPartyId) || "현장 담당자"}</strong>
          <time>{row.createdAt.slice(0, 16).replace("T", " ")}</time></header>
        <p>{row.message}</p>
        {!!row.mentionPartyIds.length && <div className="fw-discussion-mentions">참조: {row.mentionPartyIds.map(id => names.get(id) || "담당자").join(", ")}</div>}
        {!!row.evidenceRefs.length && <div className="fw-discussion-mentions">첨부 증빙 {row.evidenceRefs.length}건</div>}
      </article>)}
      {!shown.length && <p className="fw-discussion-empty">등록된 업무 대화가 없습니다.</p>}
    </div>
    <form className="fw-discussion-compose" onSubmit={e => { e.preventDefault(); void post(); }}>
      <label>업무 댓글<textarea aria-label="업무 댓글 입력" rows={3} maxLength={4000} value={text}
        onChange={e => setText(e.target.value)} placeholder="현장 확인 내용이나 담당자 협의사항을 기록하십시오." /></label>
      <label>참조인<select aria-label="참조인 선택" multiple size={Math.min(3, Math.max(2, workspace.participants.length))}
        value={mentioned} onChange={e => setMentioned(Array.from(e.target.selectedOptions).map(o => o.value))}>
        {workspace.participants.map(p => <option value={p.partyId} key={p.partyId}>{p.name} · {p.actorGroup}</option>)}
      </select></label>
      {availableEvidence.length > 0 && <label>기존 증빙 첨부<select aria-label="증빙 첨부 선택" multiple size={2} value={evidence}
        onChange={e => setEvidence(Array.from(e.target.selectedOptions).map(o => o.value))}>
        {availableEvidence.map(i => <option key={i.record.id} value={i.record.id}>{i.record.metadata?.name
          ? String(i.record.metadata.name) : i.record.id.slice(0, 8)}</option>)}
      </select></label>}
      <p className="fw-discussion-note">대화·참조 기록은 공식 현장지시, 검측 판정 또는 승인으로 처리되지 않습니다.</p>
      <button type="submit" className="primary" disabled={busy || !online || !text.trim()}>댓글 등록</button>
    </form>
  </section>;
}
