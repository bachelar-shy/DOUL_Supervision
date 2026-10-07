import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommandDescriptor, Fields, WorkItem, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { commands } from "../labels";
import { ActionButton, Panel, SectionHeader } from "../ui";
import { CommandModal } from "./CommandModal";
import "./parallel-work-inbox.css";

type Candidate = CommandDescriptor & { requiresInput?: boolean; blockedReason?: unknown };
type InboxRow = { machine: string; record: WorkItem["record"]; commandCandidates: Candidate[] };
type InboxResponse = { records?: InboxRow[]; total?: number; nextCursor?: string | null; limit?: number };
type Props = { client: SupervisionClient; workspace: Workspace; onChanged?: () => void; onNavigate?: (route: string) => void };
const machineRoutes: Record<string, string> = { shop_drawing: "drawings", material_approval: "materials", issue: "issues", safety_stop_order: "safety", rfi: "rfi", delay_event: "schedule", inspection: "inspections", evidence: "capture" };
const titleOf = (row: InboxRow) => row.record.title || String(row.record.data?.title ?? row.record.data?.name ?? row.machine);
const messageOf = (candidate: Candidate) => {
  if (!candidate.blockedReason) return "";
  if (typeof candidate.blockedReason === "string") return candidate.blockedReason;
  const value = candidate.blockedReason as unknown as Record<string, unknown>;
  return String(value.message ?? value.detail ?? value.code ?? "선행 조건 확인 필요");
};

export function WorkInboxActionsPanel({ client, workspace, onChanged, onNavigate }: Props) {
  const [page, setPage] = useState<InboxResponse>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{ item: WorkItem; action: Candidate } | null>(null);
  const requestId = useRef(0);
  const alive = useRef(true);
  const roleKey = `${workspace.project.id}:${workspace.role.id}`;
  const load = useCallback(async (pageCursor: string | null) => {
    const id = ++requestId.current;
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (pageCursor) query.set("cursor", pageCursor);
      const result = await client.request<InboxResponse>(client.path(`/parallel/work-inbox?${query.toString()}`));
      if (alive.current && requestId.current === id) setPage(result);
    } catch (e) {
      if (alive.current && requestId.current === id) setError(e instanceof Error ? e.message : String(e));
    } finally { if (alive.current && requestId.current === id) setLoading(false); }
  }, [client, roleKey]);
  useEffect(() => { alive.current = true; setCursor(null); setCursorStack([]); void load(null); return () => { alive.current = false; requestId.current++; }; }, [load, roleKey]);
  const rows = useMemo(() => page.records ?? [], [page.records]);
  async function execute(payload: Fields, evidenceIds: string[]) {
    if (!dialog || submitting) return;
    setSubmitting(true); setError("");
    const item: WorkItem = { machine: rows.find(row => row.record.id === dialog.item.record.id)?.machine ?? dialog.item.machine, record: dialog.item.record, actions: [dialog.action] };
    try {
      await client.execute(item, dialog.action.command, payload, evidenceIds);
      setDialog(null); onChanged?.(); await load(cursor);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setError(/409|conflict|stale|version/i.test(text) ? `기록이 다른 변경으로 갱신되었습니다. 최신 작업함을 다시 불러왔습니다. (${text})` : text);
      if (/409|conflict|stale|version/i.test(text)) await load(cursor);
    } finally { setSubmitting(false); }
  }
  return <div className="work-inbox-actions" data-testid="work-inbox-actions">
    <Panel>
      <SectionHeader title="작업함" meta={`${workspace.project.name} · ${workspace.role.roleCode}`} />
      <p className="muted">현재 역할에 대해 서버가 제공한 기록과 명령 후보입니다. 후보는 실행 권한이나 선행 조건 통과를 보장하지 않습니다.</p>
      <div className="work-inbox-toolbar"><span>{typeof page.total === "number" ? `전체 ${page.total}건` : "서버 조회"}</span><ActionButton onClick={() => void load(cursor)} disabled={loading || submitting}>새로고침</ActionButton></div>
      {loading && <div role="status">작업함을 불러오는 중…</div>}
      {error && <div role="alert" className="error-box"><p>{error}</p><ActionButton onClick={() => void load(cursor)} disabled={loading}>다시 불러오기</ActionButton></div>}
      {!loading && !error && rows.length === 0 && <div className="empty-state"><strong>표시할 작업이 없습니다.</strong><p>이 역할에 대해 서버가 반환한 작업함이 비어 있습니다.</p></div>}
      {!loading && rows.length > 0 && <div className="work-inbox-list">{rows.map(row => <article className="work-inbox-card" key={`${row.machine}:${row.record.id}`}>
        <div className="work-inbox-record"><h3>{titleOf(row)}</h3><span className="badge">{row.machine}</span></div>
        <div className="work-inbox-meta"><span>ID {row.record.id}</span><span>v{row.record.version}</span><span>상태 {row.record.status}</span></div>
        <div className="work-inbox-actions-list">{(row.commandCandidates ?? []).map((candidate, index) => {
          const canOpen = candidate.ready || candidate.requiresInput;
          const mapped: CommandDescriptor = { command: candidate.command, to: candidate.to, fields: candidate.fields ?? [], authority: candidate.authority, requiresInput: Boolean(candidate.requiresInput), ready: Boolean(candidate.ready), blockedReason: candidate.blockedReason as never, expectedVersion: candidate.expectedVersion ?? row.record.version, requiresEvidence: Boolean(candidate.requiresEvidence) };
          return <button key={`${candidate.command}:${index}`} type="button" className="secondary work-inbox-candidate" disabled={!canOpen || submitting} title={messageOf(candidate) || undefined} onClick={() => setDialog({ item: { machine: row.machine, record: row.record, actions: [mapped] }, action: { ...mapped, requiresInput: Boolean(candidate.requiresInput), blockedReason: candidate.blockedReason } })}>
            <span>{commands[candidate.command] ?? candidate.command}</span><small>{candidate.ready ? `전이: ${candidate.to}` : candidate.requiresInput ? "입력 후 서버 재검증" : messageOf(candidate) || "현재 실행할 수 없음"}</small>
          </button>;
        })}</div>
        {machineRoutes[row.machine] && onNavigate && <button className="text-button" type="button" onClick={() => onNavigate(machineRoutes[row.machine])}>상세 화면 열기</button>}
      </article>)}</div>}
      <div className="work-inbox-pagination"><ActionButton onClick={() => { const previous = cursorStack.at(-1) ?? null; setCursorStack(stack => stack.slice(0, -1)); setCursor(previous); void load(previous); }} disabled={!cursorStack.length || loading}>이전</ActionButton><span>{rows.length}건 표시</span><ActionButton onClick={() => { if (!page.nextCursor) return; setCursorStack(stack => [...stack, cursor]); setCursor(page.nextCursor!); void load(page.nextCursor!); }} disabled={!page.nextCursor || loading}>다음</ActionButton></div>
    </Panel>
    {dialog && <CommandModal key={`${dialog.item.machine}:${dialog.item.record.id}:${dialog.action.command}:${workspace.role.id}`} dialog={dialog} workspace={workspace} onClose={() => setDialog(null)} onSubmit={execute} />}
  </div>;
}
