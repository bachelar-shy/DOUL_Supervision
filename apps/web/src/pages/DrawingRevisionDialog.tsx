import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeftRight, X } from "lucide-react";
import type { SupervisionClient } from "../data/supervision-client";
import type { DrawingSheet } from "../data/drawing-sheet-client";
import {
  addDrawingSheetVersionLink, getDrawingSheetVersionLinks,
  type DrawingSheetVersionLink,
} from "../data/drawing-sheet-revisions-client";
import "./drawing-revision-dialog.css";

interface Props {
  client: SupervisionClient;
  selected: DrawingSheet;
  sheets: DrawingSheet[];
  canLink: boolean;
  onClose: () => void;
}

function AuthenticatedDrawingImage({client, sheet}: {client: SupervisionClient; sheet: DrawingSheet}) {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl: string | null = null;
    let active = true;
    setSource(null);
    setFailed(false);
    if (sheet.status !== "ready" || client.kind !== "http") {
      setFailed(true);
      return () => { active = false; };
    }
    void client.drawingSheetImage(sheet.id, "preview", abort.signal).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
    }).catch(() => { if (active && !abort.signal.aborted) setFailed(true); });
    return () => {
      active = false;
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, sheet.id, sheet.status]);
  return source ? <img src={source} alt={sheet.number + " " + sheet.title} draggable={false}/>
    : <div className="drawing-revision-image-wait" role="status">
      {failed ? "도면 이미지 조회 실패" : "도면을 불러오는 중…"}
    </div>;
}

export function DrawingRevisionDialog({client, selected, sheets, canLink, onClose}: Props) {
  const [links, setLinks] = useState<DrawingSheetVersionLink[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [previousSheetId, setPreviousSheetId] = useState("");
  const [previousRevision, setPreviousRevision] = useState("");
  const [newRevision, setNewRevision] = useState("");
  const [note, setNote] = useState("");
  const [compareId, setCompareId] = useState("");
  const [comparisonMode, setComparisonMode] = useState<"side-by-side" | "overlay">("side-by-side");
  const [opacity, setOpacity] = useState(50);
  const modalRef = useRef<HTMLDivElement>(null);

  const sheetById = useMemo(() => new Map(sheets.map(sheet => [sheet.id, sheet])), [sheets]);
  const predecessors = useMemo(() => sheets.filter(sheet =>
    sheet.id !== selected.id && sheet.setId !== selected.setId &&
    sheet.status === "ready" && sheet.number.trim().toLowerCase() === selected.number.trim().toLowerCase() &&
    !selected.number.toLowerCase().startsWith("sheet-")), [sheets, selected]);

  async function refresh() {
    setPending(true);
    try {
      const response = await getDrawingSheetVersionLinks(client, selected.id);
      setLinks(response.items);
      setError("");
    } catch {
      setError("도면 개정 이력을 조회하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [client, selected.id]);

  useEffect(() => {
    modalRef.current?.focus();
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const chosenLink = links.find(link => link.id === compareId) ?? links[links.length - 1] ?? null;
  const oldDrawing = chosenLink ? sheetById.get(chosenLink.fromSheetId) : undefined;
  const newDrawing = chosenLink ? sheetById.get(chosenLink.toSheetId) : undefined;

  async function linkVersion(event: FormEvent) {
    event.preventDefault();
    const previous = sheetById.get(previousSheetId);
    if (!previous || !canLink || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await addDrawingSheetVersionLink(client, {
        fromSheetId: previous.id,
        toSheetId: selected.id,
        previousRevision: previousRevision.trim(),
        newRevision: newRevision.trim(),
        expectedFromVersion: previous.version,
        expectedToVersion: selected.version,
        note: note.trim(),
      }, crypto.randomUUID());
      setCompareId(result.link.id);
      setPreviousSheetId("");
      setPreviousRevision("");
      setNewRevision("");
      setNote("");
      setNotice("개정 이력(미승인)이 연결되었습니다.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "개정 이력을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="drawing-revision-backdrop" role="presentation"
    onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="drawing-revision-modal" role="dialog" aria-modal="true"
      ref={modalRef} tabIndex={-1} aria-label="도면 개정 관리">
      <header>
        <div><strong>도면 개정 관리</strong><small>{selected.number} · {selected.title}</small></div>
        <button type="button" aria-label="도면 개정 관리 닫기" onClick={onClose}><X size={18}/></button>
      </header>
      <div className="drawing-revision-content">
        <aside className="drawing-revision-list">
          <strong>개정 이력</strong>
          <p>동일한 도면번호의 원본 PDF를 명시적으로 연결한 이력만 표시합니다.</p>
          {pending && <p role="status">개정 이력 조회 중…</p>}
          {!pending && links.length === 0 && <p>연결된 개정이 없습니다.</p>}
          {links.map(link => <button key={link.id} type="button"
            className={chosenLink?.id === link.id ? "selected" : ""}
            aria-pressed={chosenLink?.id === link.id} onClick={() => setCompareId(link.id)}>
            <span>{link.previousRevision} → {link.newRevision}</span>
            <small>{link.note}</small>
            <small>미승인 개정 연결 · {link.createdAt.slice(0, 10)}</small>
          </button>)}
          {canLink && <form aria-label="이전 원본 도면 연결" onSubmit={event => { void linkVersion(event); }}>
            <strong>개정본 연결</strong>
            <label>이전 도면
              <select value={previousSheetId} onChange={event => setPreviousSheetId(event.target.value)} required>
                <option value="">이전 원본 도면 선택</option>
                {predecessors.map(sheet =>
                  <option key={sheet.id} value={sheet.id}>{sheet.number} · {sheet.folder} · {sheet.pageNo}쪽</option>)}
              </select>
            </label>
            {predecessors.length === 0 && <small>도면번호가 같은 별도 원본 PDF를 등록·확인해야 연결할 수 있습니다.</small>}
            <div className="drawing-revision-version-fields">
              <label>이전 개정<input maxLength={24} value={previousRevision}
                placeholder="예: A" required onChange={e => setPreviousRevision(e.target.value)}/></label>
              <label>신규 개정<input maxLength={24} value={newRevision}
                placeholder="예: B" required onChange={e => setNewRevision(e.target.value)}/></label>
            </div>
            <label>개정 사유<textarea maxLength={500} rows={2} required value={note}
              onChange={e => setNote(e.target.value)}/></label>
            <button type="submit" disabled={!predecessors.length || !previousSheetId ||
              !previousRevision.trim() || !newRevision.trim() || !note.trim() || busy}>
              {busy ? "저장 중…" : "개정 이력 연결"}
            </button>
            <small>이 연결은 개정 관계만 기록합니다. 검토·승인·시공용 발행을 의미하지 않습니다.</small>
          </form>}
        </aside>
        <section className="drawing-revision-compare">
          <div className="drawing-revision-compare-tools">
            <strong><ArrowLeftRight size={16}/> 도면 비교</strong>
            <button type="button" aria-pressed={comparisonMode === "side-by-side"}
              onClick={() => setComparisonMode("side-by-side")}>나란히</button>
            <button type="button" aria-pressed={comparisonMode === "overlay"}
              onClick={() => setComparisonMode("overlay")}>겹쳐 보기</button>
          </div>
          {error && <p role="alert" className="drawing-revision-error">{error}</p>}
          {notice && <p role="status" className="drawing-revision-notice">{notice}</p>}
          {oldDrawing && newDrawing ? <>
            {comparisonMode === "overlay" && <label className="drawing-revision-opacity">
              신규 도면 투명도 {opacity}%
              <input type="range" min={0} max={100} step={5} value={opacity}
                onChange={event => setOpacity(Number(event.target.value))}/>
            </label>}
            <div className={"drawing-revision-images " + comparisonMode}>
              <div className="drawing-revision-older">
                <label>{chosenLink?.previousRevision} · 이전 도면</label>
                <AuthenticatedDrawingImage client={client} sheet={oldDrawing}/>
              </div>
              <div className="drawing-revision-newer" style={comparisonMode === "overlay" ? {
                opacity: opacity / 100,
              } : undefined}>
                <label>{chosenLink?.newRevision} · 신규 도면</label>
                <AuthenticatedDrawingImage client={client} sheet={newDrawing}/>
              </div>
            </div>
            {comparisonMode === "overlay" &&
              <p className="drawing-revision-warning">기본 중앙 정렬입니다. 축척·회전·기준점이 다른 도면은 수동 정합 없이 변경 판정에 사용하지 마십시오.</p>}
          </> : <div className="drawing-revision-image-wait">연결된 개정을 선택하면 두 원본 도면을 비교합니다.</div>}
        </section>
      </div>
    </section>
  </div>;
}
