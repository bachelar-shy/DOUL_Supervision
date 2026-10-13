import { useCallback, useEffect, useRef, useState } from "react";
import type { SupervisionClient } from "../data/supervision-client";
import { drawingPinLabels } from "../data/drawing-sheet-client";
import { formatDateTime } from "../i18n/format";
import { loadDrawingPinIndex, type DrawingPinActivity } from "../data/drawing-pin-activity-client";
import "./today-drawing-activity.css";

/** The view is a read-only projection of persisted pins, never a new formal Issue. */
export function TodayDrawingActivity({ client, onOpenPin }: {
  client: SupervisionClient;
  onOpenPin: (sheetId: string, pinId: string) => void;
}) {
  const [pins, setPins] = useState<DrawingPinActivity[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(true);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const generation = ++sequence.current;
    try {
      const index = await loadDrawingPinIndex(client);
      if (generation !== sequence.current) return;
      setPins(index.items);
      setError("");
    } catch {
      if (generation === sequence.current) setError("최근 도면 이슈를 조회할 수 없습니다.");
    } finally {
      if (generation === sequence.current) setPending(false);
    }
  }, [client]);
  useEffect(() => {
    setPins([]); setPending(true);
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void load();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("doul-drawing-pin-activity", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 5000);
    return () => {
      ++sequence.current;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("doul-drawing-pin-activity", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [load]);
  const recent = pins.slice(0, 20);
  const draftCount = pins.filter(item => item.status === "draft").length;
  return <section className="today-pin-activity" aria-label="최근 도면 지적 검측 현장상황">
    <header className="today-pin-activity-header">
      <strong>도면 지적·검측·현장상황 <small>{pins.length}건</small></strong>
      <span>미연결 초안 {draftCount}건</span>
    </header>
    {error && <p role="alert">{error}</p>}
    {pending && <p role="status" className="today-pin-empty">도면 현장기록 확인 중…</p>}
    {!pending && !pins.length && <p className="today-pin-empty">등록된 도면 현장 마크가 없습니다.</p>}
    <div className="today-pin-activity-list">
      {recent.map(pin => <button type="button" className="today-pin-activity-row"
        key={pin.pinId} onClick={() => onOpenPin(pin.sheetId, pin.pinId)}
        aria-label={pin.sheetNumber + " " + drawingPinLabels[pin.kind] + " " + pin.comment + " 상세 열기"}>
        <span className={"today-pin-kind " + pin.kind}>{drawingPinLabels[pin.kind]}</span>
        <span className="today-pin-content">
          <strong>{pin.comment}</strong>
          <small>{pin.sheetNumber} · {pin.sheetTitle} · {pin.status === "linked" ? "업무 연결" : "미연결 초안"}</small>
          {pin.latestReply && <small className="today-pin-latest">최근 답글: {pin.latestReply}</small>}
        </span>
        <span className="today-pin-tail">
          <small>{pin.replyCount ? "댓글 " + pin.replyCount : ""}</small>
          <small>{formatDateTime(pin.lastActivityAt)}</small>
        </span>
      </button>)}
    </div>
    {pins.length > 20 && <p className="today-pin-empty">최근 20건 표시 · 전체 {pins.length}건은 도면조회에서 확인</p>}
  </section>;
}
