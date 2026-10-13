import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { SupervisionClient } from "../data/supervision-client";
import { formatDateTime } from "../i18n/format";
import "./drawing-pin-discussion.css";

export interface DrawingPinReply {
  id: string; parentId: string | null; message: string;
  authorName: string; authorRole: string; createdAt: string;
}
type Thread = {items: DrawingPinReply[]; count: number};
const roleLabel: Record<string,string> = {
  ADM: "관리자", SUP: "감리자", CON: "시공사", OWN: "발주처", DES: "설계자",
};

/** A conversation is not an approval, a formal Issue, or an inspection verdict. */
export function DrawingPinDiscussion({ client, sheetId, pinId }: {
  client: SupervisionClient; sheetId: string; pinId: string;
}) {
  const [thread, setThread] = useState<Thread>({items: [], count: 0});
  const [text, setText] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const endpoint = client.path("/drawing-sheets/" + encodeURIComponent(sheetId)
    + "/pins/" + encodeURIComponent(pinId) + "/replies");
  const reload = useCallback(async () => {
    try {
      const result = await client.request<Thread>(endpoint);
      setThread(result);
      setError("");
    } catch {
      setError("이슈 대화 내용을 불러오지 못했습니다.");
    }
  }, [client, endpoint]);

  useEffect(() => {
    let active = true;
    setThread({items: [], count: 0});
    setText(""); setParentId(null); setPending(true);
    void client.request<Thread>(endpoint).then(data => {
      if (active) { setThread(data); setError(""); }
    }).catch(() => { if (active) setError("이슈 대화 내용을 불러오지 못했습니다."); })
      .finally(() => { if (active) setPending(false); });
    const refresh = () => { if (active && document.visibilityState === "visible") void reload(); };
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 5000);
    return () => { active = false; window.removeEventListener("focus", refresh); window.clearInterval(interval); };
  }, [client, endpoint, reload]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy || !navigator.onLine) return;
    setBusy(true); setError("");
    try {
      await client.request(endpoint, {
        method: "POST",
        headers: {"Idempotency-Key": crypto.randomUUID()},
        body: JSON.stringify({ message: text.trim(), parentId }),
      });
      setText(""); setParentId(null);
      await reload();
      window.dispatchEvent(new Event("doul-drawing-pin-activity"));
    } catch {
      setError("댓글을 저장하지 못했습니다. 권한이나 인터넷 연결을 확인하십시오.");
    } finally { setBusy(false); }
  }
  const parent = thread.items.find(item => item.id === parentId);
  return <section className="drawing-pin-discussion" aria-label="도면 이슈 댓글과 답글">
    <div className="drawing-pin-discussion-header">
      <h4>댓글·답글 <small>{thread.count}건</small></h4>
    </div>
    {error && <div role="alert" className="drawing-pin-discussion-error">{error}</div>}
    {pending && <p role="status" className="drawing-pin-discussion-muted">댓글 불러오는 중…</p>}
    <div className="drawing-pin-discussion-stream">
      {thread.items.map(item => <article key={item.id} className={"drawing-pin-reply" + (item.parentId ? " nested" : "")}>
        <header><strong>{item.authorName || roleLabel[item.authorRole] || "관계자"}</strong>
          <small>{roleLabel[item.authorRole] || "참여자"} · {formatDateTime(item.createdAt)}</small></header>
        {item.parentId && <small className="drawing-pin-reply-re">↳ 답글</small>}
        <p>{item.message}</p>
        <button type="button" className="drawing-pin-reply-action"
          onClick={() => setParentId(item.id)}>답글</button>
      </article>)}
      {!pending && !thread.items.length && <p className="drawing-pin-discussion-muted">등록된 댓글이 없습니다.</p>}
    </div>
    <form className="drawing-pin-discussion-compose" onSubmit={event => { void submit(event); }}>
      {parent && <div className="drawing-pin-reply-to">
        <span>{parent.authorName || "관계자"}에게 답글</span>
        <button type="button" aria-label="답글 대상 취소" onClick={() => setParentId(null)}>취소</button>
      </div>}
      <label htmlFor="drawing-pin-reply-entry">{parent ? "답글 작성" : "댓글 작성"}</label>
      <textarea id="drawing-pin-reply-entry" aria-label={parent ? "이슈 답글 입력" : "이슈 댓글 입력"}
        maxLength={4000} rows={3} value={text} onChange={event => setText(event.target.value)}
        placeholder="현장 검토 내용이나 조치 의견을 남기십시오." />
      <div className="drawing-pin-discussion-actions">
        <span>대화 기록은 공식 검측 승인과 별개입니다.</span>
        <button type="submit" className="primary-action"
          disabled={busy || !text.trim() || !navigator.onLine}>
          {busy ? "등록 중…" : parent ? "답글 등록" : "댓글 등록"}
        </button>
      </div>
    </form>
  </section>;
}
