import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent, type MouseEvent } from "react";
import {
  ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, CircleDot, ClipboardCheck,
  FilePlus2, FileText, Grid2X2, Layers3, List, MapPin, Maximize, MousePointer2,
  Pencil, Plus, RotateCcw, Search, Upload, X, ZoomIn, ZoomOut,
} from "lucide-react";
import type { SupervisionClient } from "../data/supervision-client";
import type { CommandDescriptor, WorkItem, Workspace } from "../data/ui-contract";
import {
  createSheetPin, drawingPinLabels, loadDrawingSets, loadDrawingSheets, loadSheetPins,
  updateDrawingSheet, uploadDrawingSet, reviewDrawingSheetMetadata,
  type DrawingPinKind, type DrawingSet, type DrawingSheet, type DrawingSheetPin,
} from "../data/drawing-sheet-client";
import { DrawingRevisionDialog } from "./DrawingRevisionDialog";
import "./drawing-sheet-workspace.css";

const OriginalDrawingReviewPage = lazy(() => import("./DrawingReviewPage").then(mod => ({ default: mod.DrawingReviewPage })));

interface Props {
  client: SupervisionClient;
  workspace: Workspace;
  onChanged: () => Promise<void>;
  onSelect: (id: string | null) => void;
  onNavigate: (route: string) => void;
  onOpenCommand: (item: WorkItem, action: CommandDescriptor) => void;
}

type SheetMode = "catalog" | "viewer" | "original";
type PinChoice = DrawingPinKind | null;

function ImageAsset({ client, sheet, size, label, className = "", onLoad }: {
  client: SupervisionClient; sheet: DrawingSheet; size: "thumb" | "preview";
  label: string; className?: string; onLoad?: (w: number, h: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    setVisible(false); setSrc(null); setError(false);
    const el = root.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(item => item.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "220px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [sheet.id, size]);
  useEffect(() => {
    if (!visible || sheet.status !== "ready" || client.kind !== "http") return;
    let active = true;
    let objectUrl: string | null = null;
    const abort = new AbortController();
    void client.drawingSheetImage(sheet.id, size, abort.signal).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
    }).catch(() => { if (active && !abort.signal.aborted) setError(true); });
    return () => {
      active = false; abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, sheet.id, sheet.status, size, visible]);
  return <div ref={root} className={"sheet-asset " + className}>
    {src ? <img src={src} alt={label} draggable={false} onLoad={e => {
      onLoad?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
    }} /> : <div className="sheet-asset-placeholder" role="status">
      {error ? "이미지 로딩 실패" : sheet.status === "processing" ? "이미지 변환 중" :
        sheet.status === "failed" ? "변환 오류" : "불러오는 중"}
    </div>}
  </div>;
}

const workRefType: Record<string, string> = {
  inspection: "Inspection", observation: "Observation", issue: "Issue", action: "Action",
};
const availableKinds: DrawingPinKind[] = ["issue", "inspection", "site"];

export function DrawingSheetWorkspace({ client, workspace, onChanged, onSelect, onNavigate, onOpenCommand }: Props) {
  const projectId = workspace.project.id;
  const canWrite = ["ADM", "SUP", "CON"].includes(workspace.role.actorGroup);
  const canReview = ["ADM", "SUP"].includes(workspace.role.actorGroup);
  const [mode, setMode] = useState<SheetMode>("catalog");
  const [sets, setSets] = useState<DrawingSet[]>([]);
  const [sheets, setSheets] = useState<DrawingSheet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pins, setPins] = useState<DrawingSheetPin[]>([]);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [pinChoice, setPinChoice] = useState<PinChoice>(null);
  const [pendingPoint, setPendingPoint] = useState<{ x: number; y: number } | null>(null);
  const [comment, setComment] = useState("");
  const [recordRef, setRecordRef] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [assetSize, setAssetSize] = useState({ width: 1280, height: 900 });
  const [fitSize, setFitSize] = useState({ width: 800, height: 550 });
  const [listView, setListView] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [issueFilter, setIssueFilter] = useState<DrawingPinKind | "all">("all");
  const [hiddenFolders, setHiddenFolders] = useState<string[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewDecision, setReviewDecision] = useState<"verified" | "needs_review">("verified");
  const [reviewNote, setReviewNote] = useState("");
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [editNumber, setEditNumber] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rightOpen, setRightOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageFrameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
  const pinRequest = useRef<{ key: string; serialized: string } | null>(null);

  const refresh = useCallback(async () => {
    if (client.kind !== "http") { setLoading(false); return; }
    try {
      const [catalog, directories] = await Promise.all([loadDrawingSheets(client), loadDrawingSets(client)]);
      setSheets(catalog.items); setSets(directories.items); setError("");
    } catch {
      setError("도면 목록을 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, [client]);

  useEffect(() => {
    setLoading(true); setMode("catalog"); setSelectedId(null); setPins([]); setKeyword(""); setReviewOnly(false);
    void refresh();
  }, [projectId, workspace.role.id, refresh]);

  useEffect(() => {
    if (sets.some(item => item.status === "processing")) {
      const timer = window.setInterval(() => { void refresh(); }, 1800);
      return () => window.clearInterval(timer);
    }
  }, [sets, refresh]);

  const selected = useMemo(() => sheets.find(item => item.id === selectedId) ?? null, [sheets, selectedId]);
  const visibleSheets = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase();
    return sheets.filter(item => (!reviewOnly || item.metadataReview?.status !== "verified") &&
      (!query || [item.number, item.title, item.folder, String(item.pageNo)]
      .some(value => value.toLocaleLowerCase().includes(query))));
  }, [sheets, keyword, reviewOnly]);
  const folders = useMemo(() => {
    const grouped = new Map<string, DrawingSheet[]>();
    visibleSheets.forEach(item => {
      if (!grouped.has(item.setId)) grouped.set(item.setId, []);
      grouped.get(item.setId)?.push(item);
    });
    return sets.map(item => ({ set: item, items: grouped.get(item.id) ?? [] }))
      .filter(group => group.items.length || (!keyword.trim() && !reviewOnly));
  }, [sets, visibleSheets, keyword, reviewOnly]);
  const pageIndex = sheets.findIndex(item => item.id === selectedId);
  const filteredPins = pins.filter(item => issueFilter === "all" || item.kind === issueFilter);
  const related = workspace.items.filter(item => ["inspection", "observation", "issue", "action"].includes(item.machine));
  const selectedPin = pins.find(item => item.id === selectedPinId) ?? null;
  useEffect(() => {
    if (!detailOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailOpen(false);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [detailOpen]);

  useEffect(() => {
    if (!selected || selected.status !== "ready" || client.kind !== "http") { setPins([]); return; }
    let live = true;
    setPins([]); setSelectedPinId(null); setDetailOpen(false);
    void loadSheetPins(client, selected.id).then(result => { if (live) setPins(result.items); })
      .catch(() => { if (live) setError("도면 핀 목록을 불러오지 못했습니다."); });
    return () => { live = false; };
  }, [client, selected?.id, selected?.status]);

  const fit = useCallback(() => {
    const area = viewportRef.current;
    if (!area) return;
    const scale = Math.min((area.clientWidth - 96) / assetSize.width,
      (area.clientHeight - 85) / assetSize.height);
    setFitSize({ width: Math.max(120, assetSize.width * Math.max(scale, .07)),
      height: Math.max(90, assetSize.height * Math.max(scale, .07)) });
    setZoom(1); setPan({ x: 0, y: 0 });
  }, [assetSize]);
  useEffect(() => {
    if (mode !== "viewer" || !selected) return;
    const area = viewportRef.current;
    if (!area) return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(area);
    fit();
    return () => observer.disconnect();
  }, [mode, selected?.id, fit]);

  function openSheet(sheet: DrawingSheet) {
    setMode("viewer"); setSelectedId(sheet.id); setPins([]); setSelectedPinId(null);
    setDetailOpen(false); setPinChoice(null); setPendingPoint(null);
    setEditOpen(false); setReviewMode(false); setRevisionOpen(false);
    setZoom(1); setPan({ x: 0, y: 0 }); setRightOpen(true); setError(""); setNotice("");
  }
  function neighbor(direction: -1 | 1) {
    const target = sheets[pageIndex + direction];
    if (target) openSheet(target);
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !canWrite || busy) return;
    setUploading(true); setError(""); setNotice("");
    try {
      const result = await uploadDrawingSet(client, file, crypto.randomUUID());
      setNotice(`PDF ${result.set.pageCount}장이 분리 대상으로 등록되었습니다. 변환 상태를 확인하십시오.`);
      setMode("catalog"); await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "도면 업로드에 실패했습니다.");
    } finally { setUploading(false); }
  }
  async function saveMetadata(event: FormEvent) {
    event.preventDefault();
    if (!selected || !canWrite || busy) return;
    setBusy(true); setError("");
    try {
      if (reviewMode && !canReview) throw new Error("검수 권한이 없습니다.");
      const updated = reviewMode
        ? await reviewDrawingSheetMetadata(client, selected.id, {
            expectedVersion: selected.version, decision: reviewDecision,
            number: reviewDecision === "verified" ? editNumber.trim() : selected.number,
            title: reviewDecision === "verified" ? editTitle.trim() : selected.title,
            note: reviewNote.trim(),
          }, crypto.randomUUID())
        : await updateDrawingSheet(client, selected, editNumber, editTitle);
      setSheets(previous => previous.map(sheet => sheet.id === selected.id ? updated.sheet : sheet));
      setNotice(reviewMode ? "원본 도면정보 검수 이력이 저장되었습니다." : "도면번호와 도면명이 저장되었습니다.");
      setEditOpen(false);
    } catch { setError("도면 정보 저장 실패. 최신 정보를 확인하십시오."); }
    finally { setBusy(false); }
  }
  function startEdit() {
    if (!selected || !canWrite) return;
    setReviewMode(false); setEditNumber(selected.number); setEditTitle(selected.title); setEditOpen(true);
  }
  function startMetadataReview() {
    if (!selected || !canReview || selected.status !== "ready") return;
    setEditNumber(selected.number); setEditTitle(selected.title);
    setReviewDecision("verified"); setReviewNote(""); setReviewMode(true); setEditOpen(true);
  }
  function choosePin(kind: DrawingPinKind) {
    if (!canWrite) return;
    setPinChoice(kind); setPendingPoint(null); setComment(""); setRecordRef(""); setError("");
    setSelectedPinId(null); setDetailOpen(false); setRightOpen(!window.matchMedia("(max-width: 767px)").matches);
  }
  function onDrawingClick(event: MouseEvent<HTMLDivElement>) {
    if (!pinChoice || !canWrite || drag.current?.moved) return;
    if (event.target instanceof Element && event.target.closest("button[data-pin-id]")) return;
    const bounds = imageFrameRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    setPendingPoint({ x, y });
    setRightOpen(true);
  }
  async function savePin(event: FormEvent) {
    event.preventDefault();
    if (!selected || !pinChoice || !pendingPoint || !comment.trim() || busy) return;
    const target = related.find(item => item.record.id === recordRef);
    const type = target && workRefType[target.machine];
    const payload = {
      ...pendingPoint, kind: pinChoice, comment: comment.trim(),
      recordRef: target && type ? { objectType: type, objectId: target.record.id,
        version: target.record.version } : null,
    };
    const serialized = JSON.stringify(payload);
    if (pinRequest.current?.serialized !== serialized)
      pinRequest.current = { key: crypto.randomUUID(), serialized };
    setBusy(true); setError("");
    try {
      const response = await createSheetPin(client, selected.id, payload, pinRequest.current.key);
      pinRequest.current = null;
      setPins(items => [...items, response.pin]);
      setSelectedPinId(response.pin.id); setDetailOpen(false);
      setPinChoice(null); setPendingPoint(null); setComment(""); setRecordRef("");
      setNotice(payload.recordRef ? "업무와 연결된 도면 핀을 저장했습니다." : "도면 현장 메모를 초안으로 저장했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "도면 핀을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  }
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || pinChoice || (event.target instanceof Element && event.target.closest("button"))) return;
    drag.current = { x: event.clientX, y: event.clientY, startX: pan.x, startY: pan.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function updateDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const diffX = event.clientX - drag.current.x;
    const diffY = event.clientY - drag.current.y;
    if (Math.abs(diffX) + Math.abs(diffY) > 3) drag.current.moved = true;
    setPan({ x: drag.current.startX + diffX, y: drag.current.startY + diffY });
  }
  function stopDrag() { drag.current = null; }
  function openLinkedPin(pin: DrawingSheetPin) {
    if (!pin.recordRef) return;
    const kind = pin.recordRef.objectType;
    const route = kind === "Inspection" ? "inspections" : "corrections";
    onSelect(pin.recordRef.objectId);
    onNavigate(route);
  }

  return <div className="drawing-sheet-workspace" data-ui-component="drawing-sheet-workspace" data-view={mode}>
    <div className="drawing-sheet-commandbar">
      <div className="drawing-sheet-command-left">
        {mode === "viewer" ? <button className="draw-command" type="button" onClick={() => { setMode("catalog"); setPinChoice(null); }}>
          <ArrowLeft size={15} aria-hidden="true" /> 전체 도면
        </button> : <strong className="drawing-sheet-route-label">도면 관리</strong>}
        <span className="draw-command-separator" aria-hidden="true" />
        {mode === "catalog" && canWrite && <button className="draw-command primary-action" type="button"
          disabled={uploading} onClick={() => inputRef.current?.click()}>
          <Plus size={15} aria-hidden="true" /> {uploading ? "업로드 중…" : "새 도면(PDF)"}
        </button>}
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden aria-label="PDF 도면 업로드"
          onChange={event => { void upload(event); }} />
        {mode === "viewer" && selected && <>
          <span className="drawing-current-sheet">{selected.number} · {selected.title}</span>
          {canWrite && <button type="button" className="draw-command" onClick={startEdit} title="도면번호·도면명 수정">
            <Pencil size={14} aria-hidden="true" /> 정보 수정
          </button>}
          {canReview && selected.status === "ready" && <button type="button" className="draw-command"
            onClick={startMetadataReview} aria-label="도면정보 검수">도면정보 검수</button>}
          <small className="drawing-sheet-review-text">{selected.metadataReview?.status === "verified"
            ? "원본정보 확인됨" : "원본정보 미확인"}</small>
        </>}
        {mode === "original" && <button className="draw-command" type="button" onClick={() => setMode("catalog")}>
          <ArrowLeft size={15} aria-hidden="true" /> 장별 도면
        </button>}
      </div>
      <div className="drawing-sheet-command-right">
        {mode === "catalog" && <>
          <button type="button" className={"draw-command icon-control" + (!listView ? " selected" : "")}
            aria-label="썸네일 보기" aria-pressed={!listView} onClick={() => setListView(false)}><Grid2X2 size={16}/></button>
          <button type="button" className={"draw-command icon-control" + (listView ? " selected" : "")}
            aria-label="목록 보기" aria-pressed={listView} onClick={() => setListView(true)}><List size={16}/></button>
        </>}
        {mode === "viewer" && <>
          <button className="draw-command" type="button" onClick={() => setRevisionOpen(true)}
            aria-label="도면 버전 관리" title="기존 원본 PDF의 개정 이력 조회·비교">
            <Layers3 size={15} aria-hidden="true"/> 버전 관리
          </button>
          <span className="drawing-sheet-revision">{selected?.revision ?? "초안"}</span>
          <button className={"draw-command" + (rightOpen ? " selected" : "")} type="button"
            aria-expanded={rightOpen} onClick={() => setRightOpen(value => !value)}>
            <Layers3 size={15} aria-hidden="true" /> 이슈 목록
          </button>
        </>}
        {mode !== "original" && <button type="button" className="draw-command draw-original"
          aria-label="기존 PDF 검토"
          onClick={() => { setPinChoice(null); setMode("original"); }}>
          <FileText size={15} aria-hidden="true" /><span>기존 PDF 검토</span>
        </button>}
      </div>
    </div>

    {notice && <div className="drawing-sheet-flash" role="status">{notice}<button type="button" aria-label="안내 닫기" onClick={() => setNotice("")}><X size={15}/></button></div>}
    {error && <div className="drawing-sheet-error" role="alert">{error}<button type="button" aria-label="오류 닫기" onClick={() => setError("")}><X size={15}/></button></div>}

    {mode === "catalog" && <section className="drawing-sheet-catalog" aria-label="도면 장별 목록">
      <div className="drawing-sheet-search-row">
        <label className="drawing-sheet-search"><Search size={15} aria-hidden="true" />
          <input type="search" aria-label="도면 검색" placeholder="도면번호·도면명 검색"
            value={keyword} onChange={event => setKeyword(event.target.value)} />
        </label>
        <button type="button" className="draw-command" aria-pressed={reviewOnly}
          onClick={() => setReviewOnly(value => !value)}>
          검수 필요 ({sheets.filter(item => item.metadataReview?.status !== "verified").length})
        </button>
        <span>총 {sheets.length}장 · 원본 {sets.length}건</span>
        <button type="button" className="draw-command" onClick={() => { void refresh(); }}>새로고침</button>
      </div>
      {loading && <p className="drawing-sheet-empty" role="status">도면 목록을 불러오는 중…</p>}
      {!loading && sets.length === 0 && <div className="drawing-sheet-empty">
        <FilePlus2 size={35} aria-hidden="true" />
        <strong>등록된 개별 도면이 없습니다.</strong>
        <p>여러 장의 PDF를 업로드하면 페이지별 독립 도면으로 자동 등록되고, 썸네일로 표시됩니다.</p>
        {canWrite && <button className="draw-command primary-action" type="button" onClick={() => inputRef.current?.click()}>
          <Upload size={16} /> PDF 도면집 업로드
        </button>}
      </div>}
      {folders.map(group => <section key={group.set.id} className="drawing-sheet-folder">
        <button className="drawing-sheet-folder-header" type="button"
          aria-expanded={!hiddenFolders.includes(group.set.id)}
          onClick={() => setHiddenFolders(prev => prev.includes(group.set.id)
            ? prev.filter(id => id !== group.set.id) : [...prev, group.set.id])}>
          <ChevronDown size={17} className={hiddenFolders.includes(group.set.id) ? "collapsed" : ""} />
          <span className="folder-icon" aria-hidden="true">▣</span>
          <strong>{group.set.folder}</strong>
          <span>({group.items.length}장)</span>
          {group.set.status === "processing" && <span className="drawing-set-status" role="status">
            분리 중 {group.set.completedPages}/{group.set.pageCount}
          </span>}
          {group.set.status === "failed" && <span className="drawing-set-status failed">변환 실패 · {group.set.error}</span>}
        </button>
        {!hiddenFolders.includes(group.set.id) && <div className={listView
          ? "drawing-sheet-items as-list" : "drawing-sheet-items as-grid"}>
          {group.items.map(sheet => <button key={sheet.id} type="button"
            data-sheet-id={sheet.id} className="drawing-sheet-card"
            onClick={() => openSheet(sheet)}>
            <ImageAsset client={client} sheet={sheet} size="thumb" label={sheet.number + " 도면 미리보기"} />
            <span className="sheet-card-text">
              <strong>{sheet.number}</strong>
              <small>{sheet.title}</small>
              <small className={"drawing-sheet-review-text" +
                (sheet.metadataReview?.status !== "verified" ? " needs-review" : "")}>
                {sheet.metadataReview?.status === "verified" ? "정보 확인됨" : "정보 미확인"}
              </small>
            </span>
            {sheet.status !== "ready" && <span className="sheet-card-status">{sheet.status === "failed" ? "오류" : "처리 중"}</span>}
          </button>)}
        </div>}
      </section>)}
      {sets.length > 0 && visibleSheets.length === 0 && <p className="drawing-sheet-empty">검색 결과가 없습니다.</p>}
    </section>}

    {mode === "viewer" && selected && <div className={"drawing-sheet-viewer" + (rightOpen ? "" : " right-collapsed")}>
      <section className="drawing-sheet-board" aria-label="개별 도면 뷰어">
        <div className="drawing-board-viewport" ref={viewportRef}
          onPointerDown={startDrag} onPointerMove={updateDrag} onPointerUp={stopDrag}
          onPointerCancel={stopDrag}>
          <div className="drawing-board-tools" role="toolbar" aria-label="도면 확대 및 마크업 도구">
            <button type="button" title="도면 맞춤" aria-label="도면 맞춤" onClick={fit}><Maximize size={18}/></button>
            <button type="button" title="확대" aria-label="확대" onClick={() => setZoom(x => Math.min(x * 1.3, 5))}><ZoomIn size={18}/></button>
            <button type="button" title="축소" aria-label="축소" onClick={() => setZoom(x => Math.max(x / 1.3, .4))}><ZoomOut size={18}/></button>
            <span className="draw-tool-divider" />
            {canWrite && availableKinds.map(kind => <button key={kind} type="button"
              title={drawingPinLabels[kind] + " 핀 추가"}
              aria-label={drawingPinLabels[kind] + " 핀 추가"}
              aria-pressed={pinChoice === kind}
              className={pinChoice === kind ? "selected" : ""}
              onClick={() => choosePin(kind)}>
              {kind === "issue" ? <CircleDot size={18}/> :
                kind === "inspection" ? <ClipboardCheck size={18}/> : <MapPin size={18}/>}
            </button>)}
            {canWrite && <button type="button" title="마크업 종료 / 이동" aria-label="이동 도구"
              aria-pressed={pinChoice === null} onClick={() => { setPinChoice(null); setPendingPoint(null); }}>
              <MousePointer2 size={17}/>
            </button>}
            <span className="draw-tool-divider" />
            <button type="button" title="확대 초기화" aria-label="확대 초기화" onClick={() => { setZoom(1); setPan({x:0,y:0}); }}>
              <RotateCcw size={16}/>
            </button>
          </div>
          {selected.status === "ready" ? <div className={"drawing-board-image-frame" + (pinChoice ? " pin-placement" : "")}
            ref={imageFrameRef} style={{
              width: fitSize.width, height: fitSize.height,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }} onClick={onDrawingClick}>
            <ImageAsset key={selected.id} client={client} sheet={selected} size="preview"
              label={selected.number + " " + selected.title} className="board-preview"
              onLoad={(width, height) => {
                if (assetSize.width !== width || assetSize.height !== height) setAssetSize({ width, height });
              }} />
            {pins.map((pin, idx) => <button type="button" key={pin.id} data-pin-id={pin.id}
              className={"drawing-sheet-marker " + pin.kind + (selectedPinId === pin.id ? " active" : "")}
              style={{ left: pin.x * 100 + "%", top: pin.y * 100 + "%" }}
              title={pin.comment} aria-label={drawingPinLabels[pin.kind] + " " + (idx + 1) + " " + pin.comment}
              onClick={event => { event.stopPropagation(); setSelectedPinId(pin.id); setDetailOpen(true); setRightOpen(true); }}>
              {idx + 1}
            </button>)}
            {pendingPoint && <span className="drawing-sheet-marker pending"
              style={{ left: pendingPoint.x * 100 + "%", top: pendingPoint.y * 100 + "%" }} aria-hidden="true"><Plus size={12}/></span>}
          </div> : <div className="drawing-sheet-empty">{selected.status === "failed" ? "도면 변환에 실패했습니다." : "페이지 이미지를 준비 중입니다."}</div>}
          {pinChoice && <div className="drawing-pin-instruction" role="status">도면에서 위치를 클릭한 후 오른쪽에 내용을 입력하십시오.</div>}
        </div>
        <div className="drawing-board-bottom">
          <div className="drawing-board-next">
            <button type="button" aria-label="이전 도면" disabled={pageIndex < 1} onClick={() => neighbor(-1)}><ChevronLeft size={17}/></button>
            <button type="button" aria-label="다음 도면" disabled={pageIndex === sheets.length - 1} onClick={() => neighbor(1)}><ChevronRight size={17}/></button>
          </div>
          <span title={selected.title} className="drawing-board-current-label">{selected.number} - {selected.title}</span>
          <span className="drawing-board-count">{pageIndex + 1} / {sheets.length}장</span>
        </div>
      </section>
      {rightOpen && <aside className="drawing-sheet-issue-rail" aria-label="현재 도면의 검측·현장상황·이슈">
        <div className="drawing-issue-heading">
          <strong>도면 이슈 <span>{pins.length}</span></strong>
          <button type="button" title="이슈 패널 닫기" aria-label="이슈 패널 닫기" onClick={() => setRightOpen(false)}><X size={16}/></button>
        </div>
        <div className="drawing-issue-filters">
          <button type="button" className={issueFilter === "all" ? "active" : ""}
            aria-pressed={issueFilter === "all"} onClick={() => setIssueFilter("all")}>전체 {pins.length}</button>
          {availableKinds.map(kind => <button type="button" key={kind}
            className={issueFilter === kind ? "active" : ""} aria-pressed={issueFilter === kind}
            onClick={() => setIssueFilter(kind)}>
            {drawingPinLabels[kind]} {pins.filter(pin => pin.kind === kind).length}
          </button>)}
        </div>
        {canWrite && !pinChoice && <button type="button" className="drawing-add-issue" onClick={() => choosePin("issue")}>
          <Plus size={16}/> 새 이슈 마크
        </button>}
        {pinChoice && <form aria-label="도면 마크업 핀 작성" className="drawing-pin-form" onSubmit={event => { void savePin(event); }}>
          <strong>{drawingPinLabels[pinChoice]} 마크 작성</strong>
          {pendingPoint ? <p className="small-note">도면 위치 선택 완료 · x {Math.round(pendingPoint.x * 100)}% / y {Math.round(pendingPoint.y * 100)}%</p>
            : <p className="small-note">왼쪽 도면에서 위치를 지정하십시오.</p>}
          <label>내용
            <textarea maxLength={1500} rows={4} value={comment} onChange={event => setComment(event.target.value)}
              placeholder="검측·현장상황 또는 이슈 내용을 입력하십시오." required />
          </label>
          <label>기존 업무 연결 (선택)
            <select value={recordRef} onChange={event => setRecordRef(event.target.value)}>
              <option value="">업무 미연결 · 도면 메모 초안</option>
              {related.map(item => <option key={item.record.id} value={item.record.id}>
                {item.record.title ?? item.record.workName ?? item.record.id.slice(0, 8)}
              </option>)}
            </select>
          </label>
          <div className="pin-form-actions">
            <button type="submit" className="primary-action" disabled={!pendingPoint || !comment.trim() || busy}>
              {busy ? "저장 중…" : "핀 저장"}
            </button>
            <button type="button" onClick={() => { setPinChoice(null); setPendingPoint(null); }}>취소</button>
          </div>
          <small>업무를 연결하지 않으면 현장 메모 초안이며, 공식 검측·시정조치는 별도 승인 절차가 필요합니다.</small>
        </form>}
        <div className="drawing-issue-list" aria-label="현재 도면에 표시된 마크 목록">
          {filteredPins.length === 0 && <div className="drawing-issue-empty">
            이 도면에 표시된 {issueFilter === "all" ? "이슈·검측·현장상황" : drawingPinLabels[issueFilter]} 핀이 없습니다.
          </div>}
          {filteredPins.map((pin) => <button type="button" key={pin.id}
            className={"drawing-issue-row" + (pin.id === selectedPinId ? " selected" : "")}
            onClick={() => { setSelectedPinId(pin.id); setDetailOpen(true); setPinChoice(null); setPendingPoint(null); }}>
            <span className={"issue-number " + pin.kind}>{pins.indexOf(pin) + 1}</span>
            <span className="issue-list-detail">
              <strong>{pin.comment}</strong>
              <small>{drawingPinLabels[pin.kind]} · {pin.status === "linked" ? "업무 연결" : "초안"}</small>
            </span>
            <span className="issue-row-position">{Math.round(pin.x * 100)}%</span>
          </button>)}
        </div>
        {selectedPin && <div className="drawing-pin-detail">
          <strong>선택한 마크 #{pins.indexOf(selectedPin) + 1}</strong>
          <p>{selectedPin.comment}</p>
          {selectedPin.recordRef
            ? <button type="button" onClick={() => openLinkedPin(selectedPin)}>연결된 업무 보기 →</button>
            : <span className="small-note">현장 메모 초안 · 공식 지적 등록 전</span>}
        </div>}
      </aside>}
    </div>}

    setMode("viewer"); setSelectedId(sheet.id); setPins([]); setSelectedPinId(null);
    {revisionOpen && mode === "viewer" && selected &&
      <DrawingRevisionDialog client={client} selected={selected} sheets={sheets}
        canLink={["ADM","SUP"].includes(workspace.role.actorGroup)}
        onClose={() => setRevisionOpen(false)}/>}

    {mode === "viewer" && selected && selectedPin && detailOpen && <div
      className="drawing-issue-dialog-backdrop" role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) setDetailOpen(false); }}>
      <section className="drawing-issue-dialog" role="dialog" aria-modal="true"
        aria-label={"도면 이슈 상세 #" + (pins.indexOf(selectedPin) + 1)}>
        <header className="drawing-issue-dialog-header">
          <span>도면 이슈 #{pins.indexOf(selectedPin) + 1}</span>
          <button type="button" aria-label="이슈 상세 닫기" onClick={() => setDetailOpen(false)}><X size={19}/></button>
        </header>
        <div className="drawing-issue-dialog-main">
          <div className="drawing-issue-dialog-content">
            <strong>{drawingPinLabels[selectedPin.kind]} · {selectedPin.status === "linked" ? "업무 연결" : "미연결 초안"}</strong>
            <p>{selectedPin.comment}</p>
            <h4>관련 업무</h4>
            {selectedPin.recordRef
              ? <button type="button" className="draw-command" onClick={() => openLinkedPin(selectedPin)}>연결된 업무 열기 →</button>
              : <p>공식 업무와 연결되지 않은 도면 마크입니다.</p>}
            <h4>현장 기록</h4>
            <p>현장 사진 및 검측 결과는 연결된 업무에서 확인합니다. 자료가 없으면 임의로 표시하지 않습니다.</p>
          </div>
          <aside className="drawing-issue-dialog-properties">
            <h4>속성</h4>
            <dl>
              <dt>구분</dt><dd>{drawingPinLabels[selectedPin.kind]}</dd>
              <dt>상태</dt><dd>{selectedPin.status === "linked" ? "업무 연결" : "초안"}</dd>
              <dt>도면번호</dt><dd>{selected.number}</dd>
              <dt>도면명</dt><dd>{selected.title}</dd>
              <dt>도면 개정</dt><dd>{selected.revision}</dd>
              <dt>도면 위치</dt><dd>{Math.round(selectedPin.x * 100)}% / {Math.round(selectedPin.y * 100)}%</dd>
            </dl>
            <div className="drawing-issue-dialog-sheet">
              <ImageAsset client={client} sheet={selected} size="thumb" label={selected.number + " 관련 도면"}/>
              <strong>{selected.number}</strong><span>{selected.title}</span>
            </div>
          </aside>
        </div>
      </section>
    </div>}

    {editOpen && selected && <div className="drawing-sheet-edit-backdrop" role="presentation"
      onMouseDown={e => { if (e.target === e.currentTarget) setEditOpen(false); }}>
      <form className="drawing-sheet-edit-dialog" role="dialog" aria-label={reviewMode ? "도면정보 검수" : "도면 정보 수정"} onSubmit={event => { void saveMetadata(event); }}>
        <h3>{reviewMode ? "도면번호·도면명 원본 검수" : "도면 정보 수정"}</h3>
        <label>도면번호<input autoFocus maxLength={60} value={editNumber} required
          onChange={event => setEditNumber(event.target.value)} /></label>
        <label>도면명<input maxLength={220} value={editTitle} required
          onChange={event => setEditTitle(event.target.value)} /></label>
        {reviewMode && <section className="drawing-sheet-extract-inspect">
          <strong>원본 PDF 표제란 자동 추출</strong>
          <p>도면번호: {selected.extractedNumber || "인식 불가"}</p>
          <p>도면명: {selected.extractedTitle || "인식 불가"}</p>
          <p>상태: {selected.metadataReview?.status === "verified" ? "확인 완료" : "미확인"}</p>
          {selected.metadataReview && <p>최근 검수: {selected.metadataReview.note}</p>}
        </section>}
        {reviewMode && <label>검수 결정
          <select aria-label="검수 결정" value={reviewDecision}
            onChange={event => setReviewDecision(event.target.value as "verified" | "needs_review")}>
            <option value="verified">원본 내용 확인 완료</option>
            <option value="needs_review">재검토 필요</option>
          </select>
        </label>}
        {reviewMode && <label>검수 근거 또는 재검토 사유
          <textarea aria-label="검수 의견" required maxLength={500} minLength={2} rows={3}
            value={reviewNote} onChange={event => setReviewNote(event.target.value)} />
        </label>}
        <p>{reviewMode ? "원본 도면정보 검수는 시공용 발행·감리 승인과 별개입니다." :
          "수정 내용은 독립 도면 정보에만 반영됩니다. 원본 PDF와 공식 배포 상태는 변경되지 않습니다."}</p>
        <div><button className="primary-action" type="submit" disabled={busy ||
          (reviewMode && (reviewNote.trim().length < 2 ||
            (reviewDecision === "verified" && editNumber.trim().toLowerCase().startsWith("sheet-"))))}>
            {reviewMode ? "검수 기록" : "저장"}
          </button>
          <button type="button" onClick={() => setEditOpen(false)}>취소</button></div>
      </form>
    </div>}

    {mode === "original" && <div className="drawing-sheet-original">
      <Suspense fallback={<div role="status">기존 PDF 검토 도구를 불러오는 중…</div>}>
        <OriginalDrawingReviewPage client={client} workspace={workspace} onChanged={onChanged}
          onSelect={onSelect} onNavigate={onNavigate} onOpenCommand={onOpenCommand} />
      </Suspense>
    </div>}
  </div>;
}
