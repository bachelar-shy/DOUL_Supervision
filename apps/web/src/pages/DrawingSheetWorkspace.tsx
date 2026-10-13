import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent, type MouseEvent } from "react";
import {
  ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, CircleDot, ClipboardCheck,
  FilePlus2, FileText, Grid2X2, Layers3, List, MapPin, Maximize, MousePointer2,
  Pencil, Plus, RotateCcw, Search, Upload, X, ZoomIn, ZoomOut,
  Square, Circle, Cloud, Type, Minus, ArrowUpRight, Undo2, Redo2, Eraser, Ruler,
} from "lucide-react";
import type { SupervisionClient } from "../data/supervision-client";
import type { CommandDescriptor, WorkItem, Workspace } from "../data/ui-contract";
import {
  createSheetPin, drawingPinLabels, loadDrawingSets, loadDrawingSheets, loadSheetPins,
  createSheetMarkup, loadSheetMarkups, changeSheetMarkup,
  type DrawingSheetMarkup, type DrawingMarkupKind, type NewSheetMarkup,
  updateDrawingSheet, uploadDrawingSet, reviewDrawingSheetMetadata,
  type DrawingPinKind, type DrawingSet, type DrawingSheet, type DrawingSheetPin,
} from "../data/drawing-sheet-client";
import { DrawingMarkupCanvas } from "./DrawingMarkupCanvas";
import { DrawingRevisionDialog } from "./DrawingRevisionDialog";
import "./drawing-sheet-workspace.css";
import { FIELD_DRAWING_FOCUS_EVENT, consumeDrawingFocus } from "../data/drawing-focus";
import { FieldPinPhotosPanel } from "./FieldPinPhotosPanel";
import { DrawingPinDiscussion } from "./DrawingPinDiscussion";
import { DrawingPinCountBadges, DrawingThumbnailPins, type PinMarker } from "./DrawingPinIndicators";
import { loadDrawingPinIndex, type DrawingPinActivity } from "../data/drawing-pin-activity-client";

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

function SheetPinImage({ client, sheet, size, label, pins }: {
  client: SupervisionClient; sheet: DrawingSheet; size: "thumb" | "preview";
  label: string; pins: readonly PinMarker[];
}) {
  const [naturalSize, setNaturalSize] = useState<{width:number;height:number} | null>(null);
  return <div className="drawing-thumbnail-wrap">
    <ImageAsset client={client} sheet={sheet} size={size} label={label}
      onLoad={(width, height) => setNaturalSize({width, height})}/>
    <DrawingThumbnailPins pins={pins} naturalSize={naturalSize}/>
  </div>;
}

const workRefType: Record<string, string> = {
  inspection: "Inspection", observation: "Observation", issue: "Issue", action: "Action",
};
const availableKinds: DrawingPinKind[] = ["issue", "inspection", "site"];
const markupButtons = [
  {tool:"pen", label:"자유선", Icon:Pencil},
  {tool:"line", label:"직선", Icon:Minus},
  {tool:"arrow", label:"화살표", Icon:ArrowUpRight},
  {tool:"rectangle", label:"사각형", Icon:Square},
  {tool:"ellipse", label:"원·타원", Icon:Circle},
  {tool:"cloud", label:"수정구름", Icon:Cloud},
  {tool:"text", label:"문자", Icon:Type},
  {tool:"measure", label:"거리 측정", Icon:Ruler},
  {tool:"eraser", label:"마크업 삭제", Icon:Eraser},
] as const;

export function DrawingSheetWorkspace({ client, workspace, onChanged, onSelect, onNavigate, onOpenCommand }: Props) {
  const projectId = workspace.project.id;
  const canWrite = ["ADM", "SUP", "CON"].includes(workspace.role.actorGroup);
  const canReview = ["ADM", "SUP"].includes(workspace.role.actorGroup);
  const [mode, setMode] = useState<SheetMode>("catalog");
  const [sets, setSets] = useState<DrawingSet[]>([]);
  const [sheets, setSheets] = useState<DrawingSheet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pins, setPins] = useState<DrawingSheetPin[]>([]);
  const [pinActivity, setPinActivity] = useState<DrawingPinActivity[]>([]);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [markups, setMarkups] = useState<DrawingSheetMarkup[]>([]);
  const [markupTool, setMarkupTool] = useState<DrawingMarkupKind | "eraser" | "pointer">("pointer");
  const [markupColor, setMarkupColor] = useState("#ef552b");
  const [markupText, setMarkupText] = useState("");
  const [mmPerSheetWidth, setMmPerSheetWidth] = useState<number | null>(null);
  const [markupHistory, setMarkupHistory] = useState<string[]>([]);
  const [redoHistory, setRedoHistory] = useState<DrawingSheetMarkup[]>([]);
  const [markupBusy, setMarkupBusy] = useState(false);
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
  const [focusEpoch, setFocusEpoch] = useState(0);
  const focusPinRef = useRef<{sheetId:string; pinId:string}|null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageFrameRef = useRef<HTMLDivElement>(null);
  // Keep wheel events atomic even when the browser sends several before React paints.
  const wheelTransformRef = useRef({ zoom, pan });
  wheelTransformRef.current = { zoom, pan };
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

  const reloadPinActivity = useCallback(async () => {
    if (client.kind !== "http") return;
    try { const next = await loadDrawingPinIndex(client); setPinActivity(next.items); }
    catch { setPinActivity([]); }
  }, [client]);
  useEffect(() => {
    setPinActivity([]);
    void reloadPinActivity();
    const update = () => { if (document.visibilityState === "visible") void reloadPinActivity(); };
    window.addEventListener("focus", update);
    window.addEventListener("doul-drawing-pin-activity", update);
    const timer = window.setInterval(update, 5000);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("doul-drawing-pin-activity", update);
      window.clearInterval(timer);
    };
  }, [projectId, workspace.role.id, reloadPinActivity]);
  const pinsBySheet = useMemo(() => {
    const grouped = new Map<string, DrawingPinActivity[]>();
    for (const pin of pinActivity) {
      const group = grouped.get(pin.sheetId) ?? [];
      group.push(pin); grouped.set(pin.sheetId, group);
    }
    return grouped;
  }, [pinActivity]);
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
    setMarkups([]); setMarkupHistory([]); setRedoHistory([]); setMarkupTool("pointer");
    setMmPerSheetWidth(null);
    if (!selected || selected.status !== "ready" || client.kind !== "http") return;
    let live = true;
    void loadSheetMarkups(client, selected.id).then(result => {
      if (live) setMarkups(result.items);
    }).catch(() => { if (live) setError("도면 마크업을 조회하지 못했습니다."); });
    return () => { live = false; };
  }, [client, selected?.id, selected?.status]);
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
    void loadSheetPins(client, selected.id).then(result => {
      if (!live) return;
      setPins(result.items);
      const intended = focusPinRef.current;
      if (intended && intended.sheetId === selected.id) {
        focusPinRef.current = null;
        const match = result.items.find(pin => pin.id === intended.pinId);
        if (match) { setSelectedPinId(match.id); setDetailOpen(true); setRightOpen(true); }
        else setNotice("해당 도면 마크가 변경되었거나 현재 계정에서 조회할 수 없습니다.");
      }
    }).catch(() => { if (live) setError("도면 핀 목록을 불러오지 못했습니다."); });
    return () => { live = false; };
  }, [client, selected?.id, selected?.status]);

  useEffect(() => {
    const onFocus = () => setFocusEpoch(value => value + 1);
    window.addEventListener(FIELD_DRAWING_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(FIELD_DRAWING_FOCUS_EVENT, onFocus);
  }, []);
  useEffect(() => {
    if (loading || client.kind !== "http") return;
    const intent = consumeDrawingFocus(projectId);
    if (!intent) return;
    const sheet = sheets.find(row => row.id === intent.sheetId && row.status === "ready");
    if (!sheet) { setNotice("해당 도면이 없거나 현재 프로젝트에서 접근할 수 없습니다."); return; }
    focusPinRef.current = { sheetId: sheet.id, pinId: intent.pinId };
    openSheet(sheet);
  }, [loading, sheets, projectId, focusEpoch, client.kind]);

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

  useEffect(() => {
    if (mode !== "viewer" || selected?.status !== "ready") return;
    const area = viewportRef.current;
    if (!area) return;
    const onWheel = (event: WheelEvent) => {
      // Controls may have their own wheel/scroll behaviour; the drawing owns only
      // wheels over the plan surface (including pins and the markup overlay).
      if (event.target instanceof Element && event.target.closest(
        ".drawing-board-tools, .drawing-markup-options, .drawing-board-bottom, input, select, textarea"
      )) return;
      if (!event.deltaY) return;
      event.preventDefault(); // passive:false is required to stop the document scrolling.
      const previous = wheelTransformRef.current;
      const pixels = event.deltaMode === 1 ? event.deltaY * 16
        : event.deltaMode === 2 ? event.deltaY * area.clientHeight : event.deltaY;
      // Standard Windows wheel and precision trackpad both zoom smoothly.
      const factor = Math.exp(-Math.max(-240, Math.min(240, pixels)) * .0015);
      const nextZoom = Math.min(5, Math.max(.4, previous.zoom * factor));
      if (nextZoom === previous.zoom) return;
      const bounds = area.getBoundingClientRect();
      const cursorX = event.clientX - bounds.left - bounds.width / 2;
      const cursorY = event.clientY - bounds.top - bounds.height / 2;
      const ratio = nextZoom / previous.zoom;
      const nextPan = {
        x: cursorX - (cursorX - previous.pan.x) * ratio,
        y: cursorY - (cursorY - previous.pan.y) * ratio,
      };
      wheelTransformRef.current = { zoom: nextZoom, pan: nextPan };
      setZoom(nextZoom);
      setPan(nextPan);
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => area.removeEventListener("wheel", onWheel);
  }, [mode, selected?.id, selected?.status]);

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
    setMarkupTool("pointer");
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
      void reloadPinActivity();
      window.dispatchEvent(new Event("doul-drawing-pin-activity"));
      setSelectedPinId(response.pin.id); setDetailOpen(false);
      setPinChoice(null); setPendingPoint(null); setComment(""); setRecordRef("");
      setNotice(payload.recordRef ? "업무와 연결된 도면 핀을 저장했습니다." : "도면 현장 메모를 초안으로 저장했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "도면 핀을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  }
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (markupTool !== "pointer") return;
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
  async function addMarkup(body: NewSheetMarkup) {
    if (!selected || !canWrite || markupBusy) return;
    setMarkupBusy(true); setError("");
    try {
      const result = await createSheetMarkup(client, selected.id, body, crypto.randomUUID());
      setMarkups(previous => [...previous, result.markup]);
      setMarkupHistory(previous => [...previous, result.markup.id]);
      setRedoHistory([]);
      setNotice("도면 마크업을 저장했습니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "마크업 저장 실패"); }
    finally { setMarkupBusy(false); }
  }
  async function eraseMarkup(item: DrawingSheetMarkup) {
    if (!selected || !canWrite || markupBusy) return;
    setMarkupBusy(true);
    try {
      await changeSheetMarkup(client, selected.id, item.id, "archive", item.version, crypto.randomUUID());
      setMarkups(previous => previous.filter(value => value.id !== item.id));
      setMarkupHistory(previous => previous.filter(id => id !== item.id));
      setRedoHistory([]);
    } catch { setError("마크업 삭제 실패"); } finally { setMarkupBusy(false); }
  }
  async function undoMarkup() {
    if (!selected || !canWrite || markupBusy) return;
    const id = markupHistory[markupHistory.length - 1];
    const item = markups.find(value => value.id === id);
    if (!item) return;
    setMarkupBusy(true);
    try {
      const result = await changeSheetMarkup(client, selected.id, id, "archive", item.version, crypto.randomUUID());
      setMarkups(previous => previous.filter(value => value.id !== id));
      setMarkupHistory(previous => previous.slice(0, -1));
      setRedoHistory(previous => [...previous, result.markup]);
    } catch { setError("마크업 실행취소 실패"); } finally { setMarkupBusy(false); }
  }
  async function redoMarkup() {
    if (!selected || !canWrite || markupBusy) return;
    const item = redoHistory[redoHistory.length - 1];
    if (!item) return;
    setMarkupBusy(true);
    try {
      const result = await changeSheetMarkup(client, selected.id, item.id, "restore", item.version, crypto.randomUUID());
      setMarkups(previous => [...previous, result.markup]);
      setMarkupHistory(previous => [...previous, item.id]);
      setRedoHistory(previous => previous.slice(0, -1));
    } catch { setError("마크업 다시 실행 실패"); } finally { setMarkupBusy(false); }
  }
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
            <SheetPinImage client={client} sheet={sheet} size="thumb"
              label={sheet.number + " 도면 미리보기"} pins={pinsBySheet.get(sheet.id) ?? []} />
            <span className="sheet-card-text">
              <strong>{sheet.number}</strong>
              <small>{sheet.title}</small>
              <DrawingPinCountBadges pins={pinsBySheet.get(sheet.id) ?? []} />
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
          data-zoom={zoom.toFixed(3)}
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
              aria-pressed={pinChoice === null} onClick={() => { setPinChoice(null); setPendingPoint(null); setMarkupTool("pointer"); }}>
              <MousePointer2 size={17}/>
            </button>}
            {canWrite && <span className="draw-tool-divider" />}
            {canWrite && markupButtons.map(({tool,label,Icon}) =>
              <button key={tool} type="button" aria-label={label} title={label}
                aria-pressed={markupTool === tool} disabled={markupBusy}
                className={markupTool === tool ? "selected" : ""}
                onClick={() => { setPinChoice(null); setPendingPoint(null); setMarkupTool(tool); }}>
                <Icon size={17}/>
              </button>)}
            {canWrite && <button type="button" title="마크업 실행취소" aria-label="마크업 실행취소"
              disabled={!markupHistory.length || markupBusy} onClick={() => { void undoMarkup(); }}>
              <Undo2 size={17}/>
            </button>}
            {canWrite && <button type="button" title="마크업 다시 실행" aria-label="마크업 다시 실행"
              disabled={!redoHistory.length || markupBusy} onClick={() => { void redoMarkup(); }}>
              <Redo2 size={17}/>
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
            <DrawingMarkupCanvas key={selected.id} tool={markupTool} markups={markups}
              sheetVersion={selected.version} color={markupColor} lineWidth={2.5}
              text={markupText} mmPerSheetWidth={mmPerSheetWidth} canWrite={canWrite && !markupBusy}
              onCreate={body => { void addMarkup(body); }} onErase={item => { void eraseMarkup(item); }}/>
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
          {canWrite && markupTool !== "pointer" && <div className="drawing-markup-options"
            onPointerDown={event => event.stopPropagation()}>
            <span>{markupButtons.find(item => item.tool === markupTool)?.label}</span>
            <label>색상<input aria-label="마크업 색상" type="color" value={markupColor}
              onChange={event => setMarkupColor(event.target.value)}/></label>
            {markupTool === "text" && <label>문자<input aria-label="마크업 문자" maxLength={500}
              placeholder="기입할 문자" value={markupText} onChange={event => setMarkupText(event.target.value)}/></label>}
            {markupTool === "measure" && <label>도면 전체 폭(mm)<input aria-label="도면 전체 폭(mm)"
              type="number" min="1" max="100000000" step="any" placeholder="미설정"
              value={mmPerSheetWidth ?? ""} onChange={event => {
                const value = Number(event.target.value);
                setMmPerSheetWidth(value > 0 && value <= 100000000 ? value : null);
              }}/></label>}
            <small>{markupTool === "measure" && !mmPerSheetWidth
              ? "축척 설정 전 실제 길이를 표시하지 않습니다." : "원본 PDF와 분리하여 저장합니다."}</small>
          </div>}
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
            <button type="button" onClick={() => { setPinChoice(null); setPendingPoint(null); setMarkupTool("pointer"); }}>취소</button>
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
        <div className="drawing-markup-rail-count">도면 마크업 {markups.length}개</div>
      </aside>}
    </div>}

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
            <DrawingPinDiscussion client={client} sheetId={selected.id} pinId={selectedPin.id} />
            <h4>현장 기록</h4>
            <FieldPinPhotosPanel key={selectedPin.id} client={client} sheetId={selected.id} pin={selectedPin} />
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
            <button type="button" className="drawing-issue-dialog-sheet" aria-label={selected.number + " 도면 열기"}
              onClick={() => { setDetailOpen(false); setRightOpen(true); }}>
              <SheetPinImage client={client} sheet={selected} size="thumb"
                label={selected.number + " 관련 도면"} pins={pins} />
              <strong>{selected.number}</strong><span>{selected.title}</span>
            </button>
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
