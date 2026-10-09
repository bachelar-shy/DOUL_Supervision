import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CommandDescriptor, Fields, WorkItem, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { ApiError } from "../data/supervision-client";
import { commands, reasonLabel, roles, states } from "../labels";
import { machineLabels } from "../app/routes";
import { formatNumber } from "../i18n/format";
import { ActionButton, Panel, SectionHeader } from "../ui";
import { CommandModal } from "./CommandModal";
import "./parallel-work-inbox.css";

type Candidate = CommandDescriptor & { requiresInput?: boolean; blockedReason?: unknown };
type InboxRow = { machine: string; record: WorkItem["record"]; commandCandidates: Candidate[] };
type InboxResponse = { records?: InboxRow[]; total?: number; nextCursor?: string | null; limit?: number };
type Props = { client: SupervisionClient; workspace: Workspace; onChanged?: () => void; onNavigate?: (route: string) => void };
type Locale = "en" | "ko" | "vi";
const machineRoutes: Record<string, string> = {
  shop_drawing: "drawings", material_approval: "materials", issue: "issues", safety_stop_order: "safety",
  rfi: "rfi", delay_event: "schedule", inspection: "inspections", evidence: "capture",
};
type LabelKey =
  | "title" | "intro" | "total" | "serverQuery" | "refresh" | "loading" | "emptyTitle" | "emptyDescription"
  | "id" | "version" | "status" | "transition" | "inputThenCheck" | "cannotExecute" | "openDetails"
  | "previous" | "next" | "rowsDisplayed" | "genericError" | "staleRefreshed" | "unknownState"
  | "unknownMachine" | "unknownCommand" | "unknownRole";

const copy: Record<Locale, Record<LabelKey, string>> = {
  ko: {
    title: "작업함",
    intro: "현재 역할에 대해 서버가 제공한 기록과 명령 후보입니다. 후보는 실행 권한이나 선행 조건 통과를 보장하지 않습니다.",
    total: "전체 {{count}}건", serverQuery: "서버 조회", refresh: "새로고침", loading: "작업함을 불러오는 중…",
    emptyTitle: "표시할 작업이 없습니다.", emptyDescription: "이 역할에 대해 서버가 반환한 작업함이 비어 있습니다.",
    id: "ID", version: "버전", status: "상태", transition: "전이: {{state}}", inputThenCheck: "입력 후 서버 재검증",
    cannotExecute: "현재 실행할 수 없음", openDetails: "상세 화면 열기", previous: "이전", next: "다음",
    rowsDisplayed: "{{count}}건 표시", genericError: "작업함 요청을 완료할 수 없습니다. 연결을 확인한 뒤 다시 시도하세요.",
    staleRefreshed: "기록이 변경되었습니다. 최신 작업함을 다시 불러왔습니다.", unknownState: "알 수 없는 상태",
    unknownMachine: "기타 기록", unknownCommand: "사용 가능한 명령", unknownRole: "역할",
  },
  vi: {
    title: "Hộp công việc",
    intro: "Các hồ sơ và lệnh đề xuất do máy chủ cung cấp cho vai trò hiện tại. Lệnh đề xuất không bảo đảm bạn có quyền thực hiện hoặc các điều kiện tiên quyết đã đạt.",
    total: "Tổng {{count}} hồ sơ", serverQuery: "Dữ liệu từ máy chủ", refresh: "Làm mới", loading: "Đang tải hộp công việc…",
    emptyTitle: "Không có công việc để hiển thị.", emptyDescription: "Máy chủ không trả về công việc nào cho vai trò này.",
    id: "ID", version: "Phiên bản", status: "Trạng thái", transition: "Chuyển trạng thái: {{state}}", inputThenCheck: "Nhập dữ liệu rồi máy chủ kiểm tra lại",
    cannotExecute: "Hiện chưa thể thực hiện", openDetails: "Mở màn hình chi tiết", previous: "Trước", next: "Tiếp",
    rowsDisplayed: "Đang hiển thị {{count}} hồ sơ", genericError: "Không thể tải hộp công việc. Hãy kiểm tra kết nối rồi thử lại.",
    staleRefreshed: "Hồ sơ đã thay đổi. Hộp công việc mới nhất đã được tải lại.", unknownState: "Trạng thái không xác định",
    unknownMachine: "Hồ sơ khác", unknownCommand: "Lệnh khả dụng", unknownRole: "Vai trò",
  },
  en: {
    title: "Work inbox",
    intro: "Records and command candidates returned by the server for the current role. A candidate does not guarantee execution authority or that prerequisites have passed.",
    total: "{{count}} records total", serverQuery: "Server results", refresh: "Refresh", loading: "Loading the work inbox…",
    emptyTitle: "There is no work to show.", emptyDescription: "The server returned an empty inbox for this role.",
    id: "ID", version: "Version", status: "Status", transition: "Transition: {{state}}", inputThenCheck: "Enter details; the server will check again",
    cannotExecute: "Cannot execute now", openDetails: "Open details", previous: "Previous", next: "Next",
    rowsDisplayed: "{{count}} records shown", genericError: "The work inbox request could not be completed. Check the connection and try again.",
    staleRefreshed: "The record changed. The latest work inbox has been reloaded.", unknownState: "Unknown state",
    unknownMachine: "Other record", unknownCommand: "Available command", unknownRole: "Role",
  },
};

const extraMachineLabels: Record<Locale, Record<string, string>> = {
  ko: { shop_drawing: "Shop 도면", material_approval: "자재 승인" },
  vi: { shop_drawing: "Bản vẽ thi công", material_approval: "Phê duyệt vật liệu" },
  en: { shop_drawing: "Shop drawing", material_approval: "Material approval" },
};

function localeFor(language: string): Locale {
  const languageCode = language.toLowerCase().split("-")[0];
  return languageCode === "ko" || languageCode === "vi" ? languageCode : "en";
}

function interpolate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ""));
}

function titleOf(row: InboxRow, fallback: string) {
  return row.record.title || String(row.record.data?.title ?? row.record.data?.name ?? fallback);
}

function messageOf(candidate: Candidate) {
  if (!candidate.blockedReason) return "";
  const failure = candidate.blockedReason;
  const failureRecord = failure && typeof failure === "object" ? failure as unknown as Record<string, unknown> : null;
  const code = typeof failure === "string"
    ? failure
    : failureRecord && typeof failureRecord.code === "string"
      ? failureRecord.code
      : undefined;
  return reasonLabel(code);
}

function localizedApiError(cause: unknown, genericError: string) {
  return cause instanceof ApiError ? reasonLabel(cause.detail.code) : genericError;
}

export function WorkInboxActionsPanel({ client, workspace, onChanged, onNavigate }: Props) {
  const { i18n } = useTranslation();
  const locale = localeFor(i18n.resolvedLanguage ?? i18n.language);
  const t = copy[locale];
  const copyRef = useRef(t);
  useEffect(() => { copyRef.current = t; }, [t]);
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
    } catch (cause) {
      if (alive.current && requestId.current === id) setError(localizedApiError(cause, copyRef.current.genericError));
    } finally { if (alive.current && requestId.current === id) setLoading(false); }
  }, [client, roleKey]);
  useEffect(() => { alive.current = true; setCursor(null); setCursorStack([]); const timer = window.setTimeout(() => { void load(null); }, 0); return () => { window.clearTimeout(timer); alive.current = false; requestId.current++; }; }, [load, roleKey]);
  const rows = useMemo(() => page.records ?? [], [page.records]);
  async function execute(payload: Fields, evidenceIds: string[]) {
    if (!dialog || submitting) return;
    setSubmitting(true); setError("");
    const item: WorkItem = { machine: rows.find(row => row.record.id === dialog.item.record.id)?.machine ?? dialog.item.machine, record: dialog.item.record, actions: [dialog.action] };
    try {
      await client.execute(item, dialog.action.command, payload, evidenceIds);
      setDialog(null); onChanged?.(); await load(cursor);
    } catch (cause) {
      const conflict = cause instanceof ApiError && (cause.status === 409 || /VERSION_CONFLICT|STALE|VERSION/i.test(cause.detail.code));
      if (conflict) {
        await load(cursor);
        setError(t.staleRefreshed);
      } else setError(localizedApiError(cause, t.genericError));
    } finally { setSubmitting(false); }
  }

  const machineName = (machine: string) => machineLabels[machine] || extraMachineLabels[locale][machine] || t.unknownMachine;
  const stateName = (state: string) => states[state] || t.unknownState;
  const roleName = roles[workspace.role.roleCode] || t.unknownRole;

  return <div className="work-inbox-actions" data-testid="work-inbox-actions">
    <Panel>
      <SectionHeader title={t.title} meta={`${workspace.project.name} · ${roleName}`} />
      <p className="muted">{t.intro}</p>
      <div className="work-inbox-toolbar"><span>{typeof page.total === "number" ? interpolate(t.total, { count: formatNumber(page.total) }) : t.serverQuery}</span><ActionButton onClick={() => void load(cursor)} disabled={loading || submitting}>{t.refresh}</ActionButton></div>
      {loading && <div role="status">{t.loading}</div>}
      {error && <div role="alert" className="error-box"><p>{error}</p><ActionButton onClick={() => void load(cursor)} disabled={loading}>{t.refresh}</ActionButton></div>}
      {!loading && !error && rows.length === 0 && <div className="empty-state"><strong>{t.emptyTitle}</strong><p>{t.emptyDescription}</p></div>}
      {!loading && rows.length > 0 && <div className="work-inbox-list">{rows.map(row => <article className="work-inbox-card" key={`${row.machine}:${row.record.id}`}>
        <div className="work-inbox-record"><h3>{titleOf(row, machineName(row.machine))}</h3><span className="badge">{machineName(row.machine)}</span></div>
        <div className="work-inbox-meta"><span>{t.id} {row.record.id}</span><span>v{formatNumber(row.record.version)}</span><span>{t.status} {stateName(row.record.status || "")}</span></div>
        <div className="work-inbox-actions-list">{(row.commandCandidates ?? []).map((candidate, index) => {
          const canOpen = candidate.ready || candidate.requiresInput;
          const mapped: CommandDescriptor = { command: candidate.command, to: candidate.to, fields: candidate.fields ?? [], authority: candidate.authority, requiresInput: Boolean(candidate.requiresInput), ready: Boolean(candidate.ready), blockedReason: candidate.blockedReason as never, expectedVersion: candidate.expectedVersion ?? row.record.version, requiresEvidence: Boolean(candidate.requiresEvidence) };
          const candidateMessage = messageOf(candidate);
          return <button key={`${candidate.command}:${index}`} type="button" className="secondary work-inbox-candidate" disabled={!canOpen || submitting} title={candidateMessage || undefined} onClick={() => setDialog({ item: { machine: row.machine, record: row.record, actions: [mapped] }, action: { ...mapped, requiresInput: Boolean(candidate.requiresInput), blockedReason: candidate.blockedReason } })}>
            <span>{commands[candidate.command] ?? t.unknownCommand}</span><small>{candidate.ready ? interpolate(t.transition, { state: stateName(candidate.to) }) : candidate.requiresInput ? t.inputThenCheck : candidateMessage || t.cannotExecute}</small>
          </button>;
        })}</div>
        {machineRoutes[row.machine] && onNavigate && <button className="text-button" type="button" onClick={() => onNavigate(machineRoutes[row.machine])}>{t.openDetails}</button>}
      </article>)}</div>}
      <div className="work-inbox-pagination"><ActionButton onClick={() => { const previous = cursorStack.at(-1) ?? null; setCursorStack(stack => stack.slice(0, -1)); setCursor(previous); void load(previous); }} disabled={!cursorStack.length || loading}>{t.previous}</ActionButton><span>{interpolate(t.rowsDisplayed, { count: formatNumber(rows.length) })}</span><ActionButton onClick={() => { if (!page.nextCursor) return; setCursorStack(stack => [...stack, cursor]); setCursor(page.nextCursor!); void load(page.nextCursor!); }} disabled={!page.nextCursor || loading}>{t.next}</ActionButton></div>
    </Panel>
    {dialog && <CommandModal key={`${dialog.item.machine}:${dialog.item.record.id}:${dialog.action.command}:${workspace.role.id}`} dialog={dialog} workspace={workspace} onClose={() => setDialog(null)} onSubmit={execute} />}
  </div>;
}
