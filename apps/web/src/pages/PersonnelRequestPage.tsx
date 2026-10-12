import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { SupervisionClient } from "../data/supervision-client";
import type { Workspace } from "../data/ui-contract";

type RequestedRole = "SUP" | "CON" | "OWN";
type RequestStatus = "pending" | "approved" | "rejected";
interface PersonnelRequest {
  id: string; projectId: string; version: number;
  name: string; organization: string; requestedRole: RequestedRole; reason: string;
  status: RequestStatus; createdAt: string; requesterName: string;
  reviewNote: string; reviewedAt: string | null;
}
interface RequestInbox { projectId: string; canReview: boolean; pendingCount: number; items: PersonnelRequest[] }
const roles: Record<RequestedRole, string> = { SUP: "감리자", CON: "시공사", OWN: "발주처" };
const statuses: Record<RequestStatus, string> = { pending: "관리자 검토 대기", approved: "관리자 승인 · 계정 미발급", rejected: "반려" };
const empty = { name: "", organization: "", requestedRole: "CON" as RequestedRole, reason: "" };

export function PersonnelRequestPage({ client, workspace, online }: {
  client: SupervisionClient; workspace: Workspace; online: boolean;
}) {
  const { i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language).split("-")[0];
  const admin = workspace.role.actorGroup === "ADM";
  const [data, setData] = useState<RequestInbox | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState(empty);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const attempt = useRef<{ payload: string; key: string } | null>(null);

  useEffect(() => {
    let current = true;
    setData(null); setLoading(true); setError("");
    if (client.kind !== "http") {
      setLoading(false);
      return () => { current = false; };
    }
    void client.request<RequestInbox>(client.path("/personnel-requests"))
      .then(next => { if (current) setData(next); })
      .catch(() => { if (current) setError("요청 목록을 불러오지 못했습니다. 로그인과 프로젝트 배정을 확인하십시오."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, workspace.project.id, workspace.role.id, refresh]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (admin || !online || busy || client.kind !== "http") return;
    const body = JSON.stringify(draft);
    if (attempt.current?.payload !== body) attempt.current = { payload: body, key: crypto.randomUUID() };
    setBusy(true); setError(""); setNotice("");
    try {
      await client.request(client.path("/personnel-requests"), {
        method: "POST", headers: { "Idempotency-Key": attempt.current.key }, body,
      });
      attempt.current = null; setDraft({ ...empty });
      setNotice("인원 추가 요청을 해당 프로젝트 관리자 접수함에 전달했습니다. 관리자 승인 전에는 계정이 생성되지 않습니다.");
      setRefresh(value => value + 1);
    } catch {
      setError("요청을 접수하지 못했습니다. 입력 내용과 연결 상태를 확인한 후 다시 시도하십시오.");
    } finally { setBusy(false); }
  }

  async function review(item: PersonnelRequest, status: "approved" | "rejected") {
    if (!admin || !data?.canReview || !online || busy || client.kind !== "http") return;
    const note = notes[item.id]?.trim() || "";
    if (status === "rejected" && !note) { setError("반려 사유를 입력하십시오."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await client.request(client.path("/personnel-requests/" + encodeURIComponent(item.id) + "/decision"), {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ expectedVersion: item.version, status, note }),
      });
      setNotice(status === "approved"
        ? "요청을 승인했습니다. 실제 담당자와 로그인 계정은 관리자 메뉴에서 별도로 등록하십시오."
        : "요청을 반려했습니다. 요청자는 처리 상태와 사유를 확인할 수 있습니다.");
      setRefresh(value => value + 1);
    } catch {
      setError("처리하지 못했습니다. 요청이 변경되었을 수 있으므로 목록을 다시 불러오십시오.");
    } finally { setBusy(false); }
  }

  const items = (data?.items ?? []).slice().sort((a, b) =>
    (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1)
    || b.createdAt.localeCompare(a.createdAt));
  const readOnly = !online || busy || client.kind !== "http";

  return <section className="grid gap-4" data-ui-component="personnel-requests" aria-label={admin ? "인원 추가 요청 접수함" : "인원 추가 요청"}>
    <header className="grid gap-1">
      <h2 className="text-lg font-semibold">{admin ? "인원 추가 요청 접수함" : "인원 추가 요청"}</h2>
      <p className="text-sm text-muted-foreground">{workspace.project.name} · {admin
        ? "해당 프로젝트의 요청만 표시됩니다. 검토 승인만으로 인원이나 계정이 생성되지는 않습니다."
        : "담당자나 로그인 계정의 추가는 프로젝트 관리자만 수행합니다. 이 양식은 관리자에게 전달하는 요청입니다."}</p>
    </header>
    {language !== "ko" && <p className="text-xs text-muted-foreground">This personnel request workflow is currently shown in Korean. Account approval and issuance remain administrator-only.</p>}
    {!online && <p role="status">오프라인에서는 인원 추가 요청을 전송하거나 처리할 수 없습니다.</p>}
    {client.kind !== "http" && <p role="status">미리보기에서는 실제 관리자에게 요청을 전달하지 않습니다.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!admin && <form className="grid gap-3 rounded-lg border p-4" onSubmit={event => void submit(event)} aria-label="인원 추가 요청 작성">
      <label className="grid gap-1">추가 요청 인원 이름
        <input required maxLength={120} className="min-h-11 rounded border px-3" value={draft.name}
          onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="grid gap-1">소속 회사
        <input required maxLength={160} className="min-h-11 rounded border px-3" value={draft.organization}
          onChange={event => setDraft({ ...draft, organization: event.target.value })} /></label>
      <label className="grid gap-1">요청 역할
        <select className="min-h-11 rounded border px-3" value={draft.requestedRole}
          onChange={event => setDraft({ ...draft, requestedRole: event.target.value as RequestedRole })}>
          {(["CON", "SUP", "OWN"] as const).map(role => <option key={role} value={role}>{roles[role]}</option>)}
        </select></label>
      <label className="grid gap-1">추가 요청 사유
        <textarea required maxLength={1000} rows={3} className="rounded border p-3" value={draft.reason}
          onChange={event => setDraft({ ...draft, reason: event.target.value })} /></label>
      <div><button className="primary min-h-11" disabled={readOnly} type="submit">{busy ? "전송 중…" : "관리자에게 요청 보내기"}</button></div>
    </form>}
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{admin ? "접수된 요청" : "내가 보낸 요청"}{data ? ` · 검토 대기 ${data.pendingCount}건` : ""}</h3>
        <button type="button" className="secondary min-h-11" disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}>새로고침</button>
      </div>
      {loading && <p role="status">요청 내역을 확인하는 중…</p>}
      {!loading && data && !items.length && <p className="rounded border p-4 text-sm">등록된 요청이 없습니다.</p>}
      {items.map(item => <article key={item.id} className="grid gap-2 rounded-lg border p-4" data-request-status={item.status}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong>{item.name} · {roles[item.requestedRole]}</strong>
          <span className="text-sm">{statuses[item.status]}</span>
        </div>
        <p className="text-sm">{item.organization} · 요청자 {item.requesterName}</p>
        <p className="whitespace-pre-wrap text-sm">{item.reason}</p>
        <small>{new Date(item.createdAt).toLocaleString()} · 요청 번호 {item.id.slice(0, 8)}</small>
        {item.reviewNote && <p className="rounded border p-2 text-sm">관리자 회신: {item.reviewNote}</p>}
        {admin && data?.canReview && item.status === "pending" && <div className="grid gap-2">
          <label className="grid gap-1 text-sm">검토 의견 / 반려 사유
            <textarea rows={2} maxLength={500} className="rounded border p-3" value={notes[item.id] ?? ""}
              onChange={event => setNotes(prev => ({ ...prev, [item.id]: event.target.value }))} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="primary min-h-11" type="button" disabled={readOnly} onClick={() => void review(item, "approved")}>승인 · 등록은 별도</button>
            <button className="secondary min-h-11" type="button" disabled={readOnly} onClick={() => void review(item, "rejected")}>반려</button>
          </div>
        </div>}
      </article>)}
    </div>
  </section>;
}
