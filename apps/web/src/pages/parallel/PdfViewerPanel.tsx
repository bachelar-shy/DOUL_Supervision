import { recordVersionLabel } from "../../labels";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./pdf-viewer.css";
import { ApiError, type SupervisionClient } from "../../data/supervision-client";
import type { Workspace } from "../../data/ui-contract";
import { useTranslation } from "react-i18next";
import { normalizeLanguage } from "@doul/localization";
import { reasonLabel } from "../../labels";
import { cssPointToPdfPoint, pdfPointToCssPoint, type CssPoint, type PdfViewport } from "../../data/pdf-coordinate";
import {
  fetchDrawingPdfBindings,
  fetchPdfPinLocations,
  sameDomainRef,
  savePdfLocationAnchor,
  type DrawingPdfBinding,
  type PdfDrawingAnchor,
  type PdfPinLocation,
} from "../../data/pdf-pin-client";
import { listPdfEvidenceSources, loadPdfEvidence, uploadPdfEvidence } from "../../data/pdf-viewer-client";
import { createPdfDrawingMarkup, deletePdfDrawingMarkup, editPdfDrawingMarkup, fetchPdfDrawingMarkup, fetchPdfDrawingMarkupHistory, fetchPdfDrawingMarkups, type PdfDrawingMarkup, type PdfMarkupHistoryItem, type PdfMarkupRect } from "../../data/pdf-markup-client";

GlobalWorkerOptions.workerSrc = workerSrc;

interface Props { client: SupervisionClient; workspace: Workspace; onChanged?: () => void; onSelectMarkup?: (id: string | null) => void; readOnly?: boolean; selectedReviewSource?: { evidenceId: string; bindingId?: string } }
type Status = { kind: "idle" | "loading" | "ready" | "error"; message?: string };
interface CommittedViewport { page: number; viewport: PdfViewport; sequence: number }
interface PinView { locationName: string; point: CssPoint; anchor: PdfDrawingAnchor }
type Locale = "ko" | "vi" | "en";

const copy: Record<Locale, Record<string, string>> = {
  ko: {
    panel: "PDF 도면 보기", title: "도면 PDF", description: "원본 증빙을 읽기 전용으로 확인합니다.", upload: "PDF 업로드",
    sourceLabel: "원본 선택", sourceSelect: "PDF 원본 선택", evidence: "증빙 · {{name}}", historical: "등록된 역사 원본 · {{id}} · 제{{version}}차", uploaded: "업로드한 PDF · {{id}}",
    search: "문서 검색", searchPlaceholder: "텍스트 검색 (2자 이상)", searching: "검색 중…", pagesFound: "{{count}}개 페이지",
    officialWarning: "도면의 승인 상태·개정·현장 배포 여부는 별도로 확인하십시오.",
    selectOrUpload: "등록된 PDF를 선택하거나 새 PDF를 업로드하세요.", checkingDirectory: "도면 연결과 위치 정보를 불러오는 중…", noBinding: "이 PDF 증빙에 등록된 정확한 도면 연결이 없습니다. 연결을 등록한 뒤 핀을 사용할 수 있습니다.",
    bindingVersion: "도면 작성 차수 선택", chooseBinding: "도면 작성 차수를 선택하세요…", boundDrawing: "연결 도면", registeredEvidence: "등록 증빙", evidenceVersion: "증빙",
    markup: "주석", loading: "불러오는 중…", count: "{{count}}개", rectangleMemo: "사각형 메모", showMarkup: "주석 표시", showPins: "위치 핀 표시", stopDrawing: "주석 그리기 종료", addMemo: "사각형 메모 추가",
    drawingInstructions: "페이지에서 드래그해 영역을 지정하세요. 메모를 입력한 뒤 저장합니다.", memo: "메모", memoLabel: "주석 메모", memoPlaceholder: "이 영역에 대한 메모", editReason: "수정 사유", editReasonLabel: "주석 수정 사유", deleteReasonLabel: "주석 삭제 사유", saving: "저장 중…", saveEdit: "수정 저장", saveMarkup: "주석 저장", savedMarkups: "저장된 도면 주석",
    selectedMarkup: "선택한 주석", version: "작성 차수", deleted: "삭제됨", editMarkup: "주석 수정", deleteMarkup: "주석 삭제", deleteWarning: "이 주석을 삭제하면 새 지적사항 연결에 사용할 수 없게 됩니다. 기존 지적사항 연결과 이력은 보존됩니다.", deleteReason: "삭제 사유", deleting: "삭제 중…", confirmDelete: "삭제 확인", cancel: "취소", reason: "사유", hideHistory: "이력 숨기기", showHistory: "이력 보기", history: "주석 이력", eventReason: "사유: {{reason}}",
    location: "위치 선택", pinLocationLabel: "핀을 연결할 위치", locationSelect: "위치를 선택하세요…", pinInstructions: "페이지를 클릭해 미저장 핀을 놓은 뒤 저장하세요.", pinAdminOnly: "위치 핀은 데모 ADM에서만 저장할 수 있습니다.", savePin: "위치 핀 저장",
    previousPage: "이전 페이지", page: "페이지", pageNumber: "페이지 번호", nextPage: "다음 페이지", zoomOut: "축소", zoomIn: "확대", rotate: "회전", searchResult: "검색 결과 {{page}}", canvasPage: "PDF 페이지 {{page}} / {{count}}", markupArea: "도면 주석 영역", markupItem: "주석: {{text}}", pinLayer: "도면 위치 핀", pinLabel: "{{name}} 위치 핀", rendering: "페이지를 표시하는 중…", readOnly: "읽기 전용 미리보기 · 업로드한 원본은 변경하지 않습니다.",
    checkingBinding: "도면 PDF 연결을 확인하는 중…", chooseRevision: "연결된 도면 작성 차수를 선택하세요.", loadingPdf: "PDF를 불러오는 중…", password: "암호로 보호된 PDF는 현재 열 수 없습니다.", invalidPdf: "파일이 손상되었거나 올바른 PDF가 아닙니다.", openPdfFailed: "PDF를 열지 못했습니다.", canvasUnavailable: "캔버스를 사용할 수 없습니다.", renderFailed: "페이지를 그리지 못했습니다.", searchFailed: "문서 텍스트를 검색할 수 없습니다.", uploadLoading: "업로드 중…", uploadFailed: "PDF 업로드를 완료하지 못했습니다.", markupLoadFailed: "주석을 불러오지 못했습니다.", markupDetailFailed: "주석 상세를 불러오지 못했습니다.", locationLoadFailed: "위치 연결을 불러오지 못했습니다.", bindingLoadFailed: "도면 PDF 연결을 불러오지 못했습니다.", markupSaveFailed: "주석을 저장하지 못했습니다.", markupConflict: "주석 작성 차수가 변경되어 최신 상태를 불러왔습니다. 변경 내용을 확인한 뒤 다시 수정하세요.", markupDeleteFailed: "주석을 삭제하지 못했습니다.", pinConflict: "위치가 다른 곳에서 변경되어 핀을 저장하지 못했습니다. 최신 정보로 다시 불러왔습니다.", pinSaveFailed: "핀을 저장하지 못했습니다.", unsaved: "미저장",
  },
  vi: {
    panel: "Trình xem PDF bản vẽ", title: "PDF bản vẽ", description: "Xem chứng cứ gốc ở chế độ chỉ đọc.", upload: "Tải PDF lên",
    sourceLabel: "Chọn bản gốc", sourceSelect: "Chọn PDF gốc", evidence: "Chứng cứ · {{name}}", historical: "Bản gốc lịch sử đã đăng ký · {{id}} · v{{version}}", uploaded: "PDF đã tải lên · {{id}}",
    search: "Tìm trong tài liệu", searchPlaceholder: "Tìm văn bản (ít nhất 2 ký tự)", searching: "Đang tìm…", pagesFound: "{{count}} trang",
    officialWarning: "Cần kiểm tra phê duyệt, phiên bản và tình trạng phát hành bản vẽ trước khi thi công.",
    selectOrUpload: "Chọn PDF đã đăng ký hoặc tải lên PDF mới.", checkingDirectory: "Đang tải liên kết bản vẽ và thông tin vị trí…", noBinding: "Chứng cứ PDF này chưa có liên kết chính xác với bản vẽ. Hãy đăng ký liên kết trước khi dùng ghim.",
    bindingVersion: "Chọn phiên bản bản vẽ", chooseBinding: "Chọn phiên bản bản vẽ…", boundDrawing: "Bản vẽ liên kết", registeredEvidence: "Chứng cứ đã đăng ký", evidenceVersion: "Chứng cứ",
    markup: "Chú thích", loading: "Đang tải…", count: "{{count}} mục", rectangleMemo: "Ghi chú hình chữ nhật", showMarkup: "Hiện chú thích", showPins: "Hiện ghim vị trí", stopDrawing: "Dừng vẽ chú thích", addMemo: "Thêm ghi chú hình chữ nhật",
    drawingInstructions: "Kéo trên trang để chọn vùng. Nhập ghi chú rồi lưu.", memo: "Ghi chú", memoLabel: "Ghi chú chú thích", memoPlaceholder: "Ghi chú cho vùng này", editReason: "Lý do chỉnh sửa", editReasonLabel: "Lý do sửa chú thích", deleteReasonLabel: "Lý do xóa chú thích", saving: "Đang lưu…", saveEdit: "Lưu chỉnh sửa", saveMarkup: "Lưu chú thích", savedMarkups: "Chú thích bản vẽ đã lưu",
    selectedMarkup: "Chú thích đã chọn", version: "phiên bản", deleted: "đã xóa", editMarkup: "Sửa chú thích", deleteMarkup: "Xóa chú thích", deleteWarning: "Xóa chú thích này sẽ ngăn dùng chú thích cho liên kết sự cố mới. Các liên kết sự cố hiện có và lịch sử vẫn được giữ.", deleteReason: "Lý do xóa", deleting: "Đang xóa…", confirmDelete: "Xác nhận xóa", cancel: "Hủy", reason: "Lý do", hideHistory: "Ẩn lịch sử", showHistory: "Xem lịch sử", history: "Lịch sử chú thích", eventReason: "Lý do: {{reason}}",
    location: "Chọn vị trí", pinLocationLabel: "Vị trí liên kết ghim", locationSelect: "Chọn vị trí…", pinInstructions: "Nhấp vào trang để đặt ghim chưa lưu, sau đó lưu.", pinAdminOnly: "Chỉ tài khoản ADM bản demo mới có thể lưu ghim vị trí.", savePin: "Lưu ghim vị trí",
    previousPage: "Trang trước", page: "Trang", pageNumber: "Số trang", nextPage: "Trang sau", zoomOut: "Thu nhỏ", zoomIn: "Phóng to", rotate: "Xoay", searchResult: "Kết quả tìm kiếm {{page}}", canvasPage: "Trang PDF {{page}} / {{count}}", markupArea: "Vùng chú thích bản vẽ", markupItem: "Chú thích: {{text}}", pinLayer: "Ghim vị trí bản vẽ", pinLabel: "Ghim vị trí {{name}}", rendering: "Đang hiển thị trang…", readOnly: "Bản xem trước chỉ đọc · Bản gốc đã tải lên không bị thay đổi.",
    checkingBinding: "Đang kiểm tra liên kết PDF bản vẽ…", chooseRevision: "Chọn phiên bản bản vẽ đã liên kết.", loadingPdf: "Đang tải PDF…", password: "Hiện không thể mở PDF được bảo vệ bằng mật khẩu.", invalidPdf: "Tệp bị hỏng hoặc không phải PDF hợp lệ.", openPdfFailed: "Không thể mở PDF.", canvasUnavailable: "Không thể sử dụng canvas.", renderFailed: "Không thể hiển thị trang.", searchFailed: "Không thể tìm văn bản trong tài liệu.", uploadLoading: "Đang tải lên…", uploadFailed: "Không thể hoàn tất tải PDF lên.", markupLoadFailed: "Không thể tải chú thích.", markupDetailFailed: "Không thể tải chi tiết chú thích.", locationLoadFailed: "Không thể tải liên kết vị trí.", bindingLoadFailed: "Không thể tải liên kết PDF bản vẽ.", markupSaveFailed: "Không thể lưu chú thích.", markupConflict: "Phiên bản chú thích đã thay đổi; đã tải trạng thái mới nhất. Hãy kiểm tra thay đổi rồi chỉnh sửa lại.", markupDeleteFailed: "Không thể xóa chú thích.", pinConflict: "Vị trí đã được thay đổi ở nơi khác nên không thể lưu ghim. Đã tải lại thông tin mới nhất.", pinSaveFailed: "Không thể lưu ghim.", unsaved: "Chưa lưu",
  },
  en: {
    panel: "PDF drawing viewer", title: "Drawing PDF", description: "View original evidence in read-only mode.", upload: "Upload PDF",
    officialWarning: "Check drawing approval, revision and site distribution status separately.",
    sourceLabel: "Select source", sourceSelect: "Select PDF source", evidence: "Evidence · {{name}}", historical: "Registered historical source · {{id}} · v{{version}}", uploaded: "Uploaded PDF · {{id}}",
    search: "Search document", searchPlaceholder: "Search text (2 or more characters)", searching: "Searching…", pagesFound: "{{count}} pages",
    selectOrUpload: "Select a registered PDF or upload a new PDF.", checkingDirectory: "Loading drawing bindings and location information…", noBinding: "This PDF evidence has no exact drawing binding. Register a binding before using pins.",
    bindingVersion: "Select drawing version", chooseBinding: "Select a drawing version…", boundDrawing: "Bound drawing", registeredEvidence: "Registered evidence", evidenceVersion: "Evidence",
    markup: "Markups", loading: "Loading…", count: "{{count}}", rectangleMemo: "Rectangle note", showMarkup: "Show markups", showPins: "Show location pins", stopDrawing: "Stop drawing markup", addMemo: "Add rectangle note",
    drawingInstructions: "Drag on the page to select an area. Enter a note, then save.", memo: "Note", memoLabel: "Markup note", memoPlaceholder: "Note for this area", editReason: "Edit reason", editReasonLabel: "Markup edit reason", deleteReasonLabel: "Markup deletion reason", saving: "Saving…", saveEdit: "Save edit", saveMarkup: "Save markup", savedMarkups: "Saved drawing markups",
    selectedMarkup: "Selected markup", version: "version", deleted: "deleted", editMarkup: "Edit markup", deleteMarkup: "Delete markup", deleteWarning: "Deleting this markup prevents it from being used for new issue links. Existing issue links and history are retained.", deleteReason: "Deletion reason", deleting: "Deleting…", confirmDelete: "Confirm delete", cancel: "Cancel", reason: "Reason", hideHistory: "Hide history", showHistory: "View history", history: "Markup history", eventReason: "Reason: {{reason}}",
    location: "Select location", pinLocationLabel: "Location to pin", locationSelect: "Select a location…", pinInstructions: "Click the page to place an unsaved pin, then save it.", pinAdminOnly: "Only the demo ADM account can save location pins.", savePin: "Save location pin",
    previousPage: "Previous page", page: "Page", pageNumber: "Page number", nextPage: "Next page", zoomOut: "Zoom out", zoomIn: "Zoom in", rotate: "Rotate", searchResult: "Search result {{page}}", canvasPage: "PDF page {{page}} / {{count}}", markupArea: "Drawing markup area", markupItem: "Markup: {{text}}", pinLayer: "Drawing location pins", pinLabel: "{{name}} location pin", rendering: "Displaying page…", readOnly: "Read-only preview · The uploaded original is unchanged.",
    checkingBinding: "Checking drawing PDF binding…", chooseRevision: "Select the bound drawing version.", loadingPdf: "Loading PDF…", password: "Password-protected PDFs cannot be opened right now.", invalidPdf: "The file is damaged or is not a valid PDF.", openPdfFailed: "Could not open the PDF.", canvasUnavailable: "Canvas is unavailable.", renderFailed: "Could not render the page.", searchFailed: "Could not search the document text.", uploadLoading: "Uploading…", uploadFailed: "Could not complete the PDF upload.", markupLoadFailed: "Could not load markups.", markupDetailFailed: "Could not load markup details.", locationLoadFailed: "Could not load location bindings.", bindingLoadFailed: "Could not load drawing PDF bindings.", markupSaveFailed: "Could not save the markup.", markupConflict: "The markup version changed, and the latest state was loaded. Review the changes before editing again.", markupDeleteFailed: "Could not delete the markup.", pinConflict: "The location changed elsewhere, so the pin could not be saved. The latest information was reloaded.", pinSaveFailed: "Could not save the pin.", unsaved: "Unsaved",
  },
};

function apiErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) return reasonLabel(cause.detail.code);
  return fallback;
}

function validAnchor(value: unknown): value is PdfDrawingAnchor {
  if (!value || typeof value !== "object") return false;
  const anchor = value as Record<string, unknown>;
  return !!anchor.drawingRef && typeof anchor.drawingRef === "object"
    && (anchor.drawingRef as Record<string, unknown>).objectType === "InformationItem"
    && Number.isInteger(anchor.page) && Number(anchor.page) > 0
    && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)
    && anchor.coordinateSystem === "pdf_points";
}

export function PdfViewerPanel({ client, workspace, onChanged, onSelectMarkup, readOnly = false, selectedReviewSource }: Props) {
  const { i18n, t } = useTranslation();
  const language: Locale = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);
  const tx = (key: string, values?: Record<string, string | number>) => {
    let result = copy[language][key] ?? copy.en[key] ?? key;
    for (const [name, value] of Object.entries(values ?? {})) result = result.replaceAll(`{{${name}}}`, String(value));
    return result;
  };
  const sources = useMemo(() => listPdfEvidenceSources(workspace), [workspace]);
  const [selectedId, setSelectedId] = useState(selectedReviewSource?.evidenceId ?? "");
  const [selectedBindingId, setSelectedBindingId] = useState(selectedReviewSource?.bindingId ?? "");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [uploading, setUploading] = useState(false);
  const [savingPin, setSavingPin] = useState(false);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [panMode, setPanMode] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panOrigin = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [rotation, setRotation] = useState(0);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<number[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [bindings, setBindings] = useState<DrawingPdfBinding[]>([]);
  const [locations, setLocations] = useState<PdfPinLocation[]>([]);
  const [bindingError, setBindingError] = useState("");
  const [locationsError, setLocationsError] = useState("");
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [selectedLocationRef, setSelectedLocationRef] = useState("");
  const [pendingPin, setPendingPin] = useState<{ location: PdfPinLocation; anchor: PdfDrawingAnchor } | null>(null);
  const [committedViewport, setCommittedViewport] = useState<CommittedViewport | null>(null);
  const [rendering, setRendering] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [markupMode, setMarkupMode] = useState(false);
  const [markups, setMarkups] = useState<PdfDrawingMarkup[]>([]);
  const [markupError, setMarkupError] = useState("");
  const [markupLoading, setMarkupLoading] = useState(false);
  const [savingMarkup, setSavingMarkup] = useState(false);
  const [markupText, setMarkupText] = useState("");
  const [pendingMarkup, setPendingMarkup] = useState<PdfMarkupRect | null>(null);
  const [selectedMarkupId, setSelectedMarkupId] = useState<string | null>(null);
  const [selectedMarkup, setSelectedMarkup] = useState<PdfDrawingMarkup | null>(null);
  const [markupHistory, setMarkupHistory] = useState<PdfMarkupHistoryItem[]>([]);
  const [showMarkupHistory, setShowMarkupHistory] = useState(false);
  const [showMarkupLayer, setShowMarkupLayer] = useState(true);
  const [showPinLayer, setShowPinLayer] = useState(true);
  const [editingMarkup, setEditingMarkup] = useState(false);
  const [deletingMarkup, setDeletingMarkup] = useState(false);
  const [markupReason, setMarkupReason] = useState("");
  const [markupActionLoading, setMarkupActionLoading] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const loadSequence = useRef(0);
  const searchSequence = useRef(0);
  const renderSequence = useRef(0);
  const previewFiles = useRef(new Map<string, File>());
  const activeDocumentUrl = useRef<string | null>(null);
  const markupSequence = useRef(0);
  const markupDetailSequence = useRef(0);
  const markupContextSequence = useRef(0);
  const drawingStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const onSelectMarkupRef = useRef(onSelectMarkup);
  const markupAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const markupMutationAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  onSelectMarkupRef.current = onSelectMarkup;

  useEffect(() => {
    if (!selectedReviewSource) return;
    setSelectedId(selectedReviewSource.evidenceId);
    setSelectedBindingId(selectedReviewSource.bindingId ?? "");
  }, [selectedReviewSource?.evidenceId, selectedReviewSource?.bindingId]);

  const selectedSource = sources.find((source) => source.id === selectedId);
  const matchingBindings = useMemo(() => {
    if (!selectedId) return [];
    return bindings.filter((binding) => binding.projectId === workspace.project.id
      && binding.evidenceRef.objectType === "Evidence"
      && binding.evidenceRef.objectId === selectedId);
  }, [bindings, selectedId, workspace.project.id]);
  const boundOnlyEvidence = useMemo(() => {
    const listed = new Set(sources.map((source) => source.id));
    const seen = new Set<string>();
    return bindings.filter((binding) => {
      if (binding.projectId !== workspace.project.id || binding.evidenceRef.objectType !== "Evidence"
        || listed.has(binding.evidenceRef.objectId)
        || seen.has(binding.evidenceRef.objectId)) return false;
      seen.add(binding.evidenceRef.objectId);
      return true;
    });
  }, [bindings, sources, workspace.project.id]);
  const activeBinding = matchingBindings.length === 1
    ? matchingBindings[0]
    : matchingBindings.find((binding) => binding.id === selectedBindingId);
  const isDemoAdmin = !readOnly && workspace.demo && client.session?.actor.actorGroup === "ADM";
  const selectedLocation = locations.find((location) => location.reference.objectId === selectedLocationRef);
  const markupSelectionKey = [workspace.project.id, workspace.role.id, selectedId, activeBinding?.id ?? "", page].join(":");
  const markupContextKey = `${markupSelectionKey}:${committedViewport?.sequence ?? ""}`;

  useLayoutEffect(() => {
    ++markupContextSequence.current;
    ++markupSequence.current;
    drawingStart.current = null;
    setPendingMarkup(null);
    setMarkupText("");
    setSavingMarkup(false);
    markupAttemptRef.current = null;
    setMarkupMode(false);
    setEditingMarkup(false);
    setDeletingMarkup(false);
    setMarkupReason("");
    markupMutationAttempt.current = null;
  }, [markupContextKey]);

  // A redraw invalidates geometry and mutation attempts, but the selected
  // server record remains the same. Clear it only when its read scope changes.
  useLayoutEffect(() => {
    setSelectedMarkupId(null);
    setSelectedMarkup(null);
    setMarkupHistory([]);
    onSelectMarkupRef.current?.(null);
  }, [markupSelectionKey]);

  useEffect(() => () => {
    ++markupContextSequence.current;
    ++markupSequence.current;
    drawingStart.current = null;
  }, []);

  useEffect(() => {
    const bindingId = activeBinding?.id;
    if (!bindingId || !committedViewport || committedViewport.page !== page || rendering) {
      setMarkups([]);
      return;
    }
    let active = true;
    const sequence = ++markupSequence.current;
    setMarkupLoading(true);
    setMarkupError("");
    void fetchPdfDrawingMarkups(client, bindingId).then((items) => {
      if (active && sequence === markupSequence.current) setMarkups(items.filter((item) => item.projectId === workspace.project.id && item.bindingId === bindingId
        && sameDomainRef(item.drawingRef, activeBinding?.drawingRef) && sameDomainRef(item.evidenceRef, activeBinding?.evidenceRef)));
    }).catch((reason) => {
      if (active && sequence === markupSequence.current) setMarkupError(apiErrorMessage(reason, tx("markupLoadFailed")));
    }).finally(() => {
      if (active && sequence === markupSequence.current) setMarkupLoading(false);
    });
    return () => { active = false; };
  }, [client, activeBinding?.id, committedViewport?.sequence, page, rendering, workspace.project.id, workspace.role.id]);

  useEffect(() => {
    if (!selectedMarkupId || !activeBinding) { setSelectedMarkup(null); setMarkupHistory([]); return; }
    let active = true;
    const sequence = ++markupDetailSequence.current;
    void (async () => {
      try {
        const [detail, history] = await Promise.all([
          fetchPdfDrawingMarkup(client, selectedMarkupId),
          showMarkupHistory ? fetchPdfDrawingMarkupHistory(client, selectedMarkupId) : Promise.resolve([]),
        ]);
        if (active && sequence === markupDetailSequence.current && detail.bindingId === activeBinding.id && detail.page === page) {
          setSelectedMarkup(detail);
          setMarkupHistory(history);
        }
      } catch (reason) {
        if (active && sequence === markupDetailSequence.current) setMarkupError(apiErrorMessage(reason, tx("markupDetailFailed")));
      }
    })();
    return () => { active = false; };
  }, [client, selectedMarkupId, showMarkupHistory, activeBinding?.id, page]);

  const cancelRender = useCallback(async () => {
    const task = renderRef.current;
    renderRef.current = null;
    if (task) {
      task.cancel();
      try { await task.promise; } catch { /* cancellation is expected */ }
    }
  }, []);

  const pinContextSequence = useRef(0);
  const pinContextKey = [workspace.project.id, workspace.role.id, selectedId, activeBinding?.id ?? "", activeBinding?.evidenceRef.version ?? "", activeBinding?.drawingRef.version ?? "", selectedLocationRef, page].join(":");
  const reloadLocations = useCallback(async (expectedSequence = pinContextSequence.current) => {
    try {
      const latest = await fetchPdfPinLocations(client);
      if (expectedSequence === pinContextSequence.current) {
        setLocations(latest);
        setLocationsError("");
      }
      return latest;
    } catch (reason) {
      if (expectedSequence === pinContextSequence.current) {
        setLocationsError(apiErrorMessage(reason, tx("locationLoadFailed")));
      }
      throw reason;
    }
  }, [client]);

  useLayoutEffect(() => {
    ++pinContextSequence.current;
    setPendingPin(null);
    setSavingPin(false);
  }, [pinContextKey]);

  useEffect(() => {
    let active = true;
    setDirectoryLoading(true);
    setBindingError("");
    setLocationsError("");
    Promise.allSettled([fetchDrawingPdfBindings(client), fetchPdfPinLocations(client)]).then(([bindingResult, locationResult]) => {
      if (!active) return;
      if (bindingResult.status === "fulfilled") setBindings(bindingResult.value);
      else setBindingError(apiErrorMessage(bindingResult.reason, tx("bindingLoadFailed")));
      if (locationResult.status === "fulfilled") setLocations(locationResult.value);
      else setLocationsError(apiErrorMessage(locationResult.reason, tx("locationLoadFailed")));
      setDirectoryLoading(false);
    });
    return () => { active = false; };
  }, [client, workspace.project.id, workspace.role.id, workspace.items]);

  useEffect(() => {
    setSelectedBindingId("");
    setPendingPin(null);
    setCommittedViewport(null);
  }, [selectedId]);

  useEffect(() => {
    setPendingPin(null);
  }, [selectedBindingId, selectedSource?.record.version, matchingBindings.map((binding) => binding.evidenceRef.version).join(",")]);

  useEffect(() => {
    if (!isDemoAdmin) setPendingPin(null);
  }, [isDemoAdmin]);

  useEffect(() => {
    let active = true;
    const sequence = ++loadSequence.current;
    setSearchError("");
    setCommittedViewport(null);
    // A just-uploaded local preview is already available and can be parsed
    // without waiting for a workspace refresh of the binding/location lists.
    // This also keeps corrupt-file errors visible while that refresh is pending.
    if (selectedId && directoryLoading && !previewFiles.current.has(selectedId)) {
      setStatus({ kind: "loading", message: tx("checkingBinding") });
      return () => { active = false; };
    }
    if (selectedId && matchingBindings.length > 1 && !activeBinding) {
      setStatus({ kind: "idle", message: tx("chooseRevision") });
      setPageCount(0);
      setCommittedViewport(null);
      void (async () => {
        await cancelRender();
        try { await loadingRef.current?.destroy(); } catch { /* previous document shutdown */ }
        loadingRef.current = null;
        docRef.current = null;
        if (activeDocumentUrl.current) URL.revokeObjectURL(activeDocumentUrl.current);
        activeDocumentUrl.current = null;
      })();
      return () => { active = false; };
    }
    if (!selectedId) {
      setStatus({ kind: "idle" });
      setPage(1);
      setPageCount(0);
      void (async () => {
        await cancelRender();
        try { await loadingRef.current?.destroy(); } catch { /* previous document shutdown */ }
        loadingRef.current = null;
        docRef.current = null;
        if (activeDocumentUrl.current) URL.revokeObjectURL(activeDocumentUrl.current);
        activeDocumentUrl.current = null;
      })();
      return () => { active = false; };
    }
    setStatus({ kind: "loading", message: tx("loadingPdf") });
    setPage(1);
    setPageCount(0);
    setMatches([]);
    void (async () => {
      try {
        await cancelRender();
        try { await loadingRef.current?.destroy(); } catch { /* previous document shutdown */ }
        loadingRef.current = null;
        docRef.current = null;
        if (activeDocumentUrl.current) URL.revokeObjectURL(activeDocumentUrl.current);
        activeDocumentUrl.current = null;
        const file = previewFiles.current.get(selectedId);
        let blob: Blob;
        if (activeBinding) {
          blob = await client.drawingPdfContent(activeBinding.id);
        } else {
          blob = file ?? await loadPdfEvidence(client, selectedId);
        }
        if (!active || sequence !== loadSequence.current) return;
        const url = URL.createObjectURL(blob);
        activeDocumentUrl.current = url;
        const task = getDocument({ url, maxImageSize: 8_000_000 });
        loadingRef.current = task;
        const doc = await task.promise;
        if (!active || sequence !== loadSequence.current) {
          await task.destroy();
          URL.revokeObjectURL(url);
          if (activeDocumentUrl.current === url) activeDocumentUrl.current = null;
          return;
        }
        docRef.current = doc;
        setPageCount(doc.numPages);
        setStatus({ kind: "ready" });
      } catch (reason) {
        if (active && sequence === loadSequence.current) {
          const error = reason as Error;
          const message = error?.name === "PasswordException" ? tx("password") : error?.name === "InvalidPDFException" || error?.name === "FormatError" ? tx("invalidPdf") : apiErrorMessage(reason, tx("openPdfFailed"));
          setStatus({ kind: "error", message });
        }
      }
    })();
    return () => { active = false; };
  }, [client, selectedId, activeBinding?.id, matchingBindings.length, directoryLoading, cancelRender]);

  useEffect(() => () => {
    ++loadSequence.current;
    ++searchSequence.current;
    void (async () => {
      await cancelRender();
      try { await loadingRef.current?.destroy(); } catch { /* unmount cleanup */ }
      loadingRef.current = null;
      docRef.current = null;
      if (activeDocumentUrl.current) URL.revokeObjectURL(activeDocumentUrl.current);
      activeDocumentUrl.current = null;
      previewFiles.current.clear();
    })();
  }, [cancelRender]);

  useEffect(() => {
    const doc = docRef.current;
    const visibleCanvas = canvasRef.current;
    if (!doc || !visibleCanvas || status.kind !== "ready") return;
    let active = true;
    const sequence = ++renderSequence.current;
    setRendering(true);
    void (async () => {
      await cancelRender();
      if (!active || sequence !== renderSequence.current || docRef.current !== doc) return;
      let scratchCanvas: HTMLCanvasElement | null = null;
      try {
        const pdfPage = await doc.getPage(page);
        if (!active || sequence !== renderSequence.current || docRef.current !== doc) return;
        const effectiveRotation = ((pdfPage.rotate || 0) + rotation) % 360;
        const viewport = pdfPage.getViewport({ scale: zoom, rotation: effectiveRotation });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cap = Math.sqrt(8_000_000 / (viewport.width * viewport.height * dpr * dpr));
        const outputScale = Math.min(dpr, cap, 2);
        const width = Math.max(1, Math.floor(viewport.width * outputScale));
        const height = Math.max(1, Math.floor(viewport.height * outputScale));
        scratchCanvas = document.createElement("canvas");
        scratchCanvas.width = width;
        scratchCanvas.height = height;
        const task = pdfPage.render({
          canvas: scratchCanvas,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        renderRef.current = task;
        await task.promise;
        if (!active || sequence !== renderSequence.current || docRef.current !== doc) return;

        // Commit pixels and the matching viewport together only after a complete page render.
        visibleCanvas.width = width;
        visibleCanvas.height = height;
        visibleCanvas.style.width = viewport.width + "px";
        visibleCanvas.style.height = "auto";
        const context = visibleCanvas.getContext("2d");
        if (!context) throw new Error(tx("canvasUnavailable"));
        context.drawImage(scratchCanvas, 0, 0);
        const rect = visibleCanvas.getBoundingClientRect();
        setCanvasSize({ width: rect.width, height: rect.height });
        setCommittedViewport({ page, viewport, sequence });
        setRendering(false);
        pdfPage.cleanup();
        if (renderRef.current === task) renderRef.current = null;
      } catch (reason) {
        if (active && sequence === renderSequence.current && !(reason instanceof Error && reason.name === "RenderingCancelledException")) {
          setStatus({ kind: "error", message: tx("renderFailed") });
          setRendering(false);
        }
      } finally {
        if (scratchCanvas) { scratchCanvas.width = 0; scratchCanvas.height = 0; }
      }
    })();
    return () => { active = false; };
  }, [page, zoom, rotation, status.kind, cancelRender, pageCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      setCanvasSize((current) => current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [status.kind]);

  useEffect(() => {
    const doc = docRef.current;
    const term = query.trim().toLocaleLowerCase();
    const sequence = ++searchSequence.current;
    setMatches([]);
    setSearchError("");
    if (!doc || term.length < 2) { setSearching(false); return; }
    let active = true;
    setSearching(true);
    void (async () => {
      const found: number[] = [];
      const limit = Math.min(doc.numPages, 80);
      try {
        for (let number = 1; number <= limit && found.length < 100; number += 1) {
          if (!active || sequence !== searchSequence.current) return;
          const pdfPage = await doc.getPage(number);
          const content = await pdfPage.getTextContent();
          if (content.items.some((item) => "str" in item && item.str.toLocaleLowerCase().includes(term))) found.push(number);
        }
        if (active && sequence === searchSequence.current) setMatches(found);
      } catch {
        if (active && sequence === searchSequence.current) setSearchError(tx("searchFailed"));
      } finally { if (active && sequence === searchSequence.current) setSearching(false); }
    })();
    return () => { active = false; };
  }, [query, selectedId, pageCount]);

  const overlayPins = useMemo<PinView[]>(() => {
    if (!activeBinding || !committedViewport || committedViewport.page !== page || canvasSize.width <= 0 || canvasSize.height <= 0) return [];
    const anchored = locations.flatMap((location) => location.drawingAnchors.flatMap((value) => {
      if (!validAnchor(value) || !sameDomainRef(value.drawingRef, activeBinding.drawingRef) || value.page !== page) return [];
      const point = pdfPointToCssPoint(committedViewport.viewport, canvasSize, { x: value.x, y: value.y });
      return point ? [{ locationName: location.name, point, anchor: value }] : [];
    }));
    if (pendingPin && sameDomainRef(pendingPin.anchor.drawingRef, activeBinding.drawingRef) && pendingPin.anchor.page === page) {
      const point = pdfPointToCssPoint(committedViewport.viewport, canvasSize, pendingPin.anchor);
      if (point) anchored.push({ locationName: pendingPin.location.name + " · " + tx("unsaved"), point, anchor: pendingPin.anchor });
    }
    return anchored;
  }, [activeBinding, committedViewport, page, canvasSize, locations, pendingPin]);

  const overlayMarkups = useMemo(() => {
    if (!committedViewport || committedViewport.page !== page || canvasSize.width <= 0 || canvasSize.height <= 0) return [];
    return markups.filter((item) => item.bindingId === activeBinding?.id && item.page === page).flatMap((item) => {
      const corners = [
        { x: item.rect.x1, y: item.rect.y1 }, { x: item.rect.x2, y: item.rect.y1 },
        { x: item.rect.x2, y: item.rect.y2 }, { x: item.rect.x1, y: item.rect.y2 },
      ].map((point) => pdfPointToCssPoint(committedViewport.viewport, canvasSize, point));
      return corners.every((point) => point !== null) ? [{ item, points: corners as CssPoint[] }] : [];
    });
  }, [markups, activeBinding?.id, committedViewport, page, canvasSize]);

  const pendingMarkupPoints = useMemo(() => {
    if (!pendingMarkup || !committedViewport || committedViewport.page !== page || canvasSize.width <= 0 || canvasSize.height <= 0) return null;
    const corners = [
      { x: pendingMarkup.x1, y: pendingMarkup.y1 }, { x: pendingMarkup.x2, y: pendingMarkup.y1 },
      { x: pendingMarkup.x2, y: pendingMarkup.y2 }, { x: pendingMarkup.x1, y: pendingMarkup.y2 },
    ].map((point) => pdfPointToCssPoint(committedViewport.viewport, canvasSize, point));
    return corners.every((point) => point !== null) ? corners as CssPoint[] : null;
  }, [pendingMarkup, committedViewport, page, canvasSize]);

  async function chooseFile(file?: File) {
    if (readOnly || !file) return;
    setUploading(true);
    setStatus({ kind: "loading", message: tx("uploadLoading") });
    try {
      const record = await uploadPdfEvidence(client, workspace, file);
      previewFiles.current.clear();
      previewFiles.current.set(record.id, file);
      setSelectedId(record.id);
      onChanged?.();
    } catch (reason) {
      setStatus({ kind: "error", message: apiErrorMessage(reason, tx("uploadFailed")) });
    } finally { setUploading(false); }
  }

  function stagePin(event: React.MouseEvent<HTMLDivElement>) {
    if (!isDemoAdmin || !activeBinding || !selectedLocation || !committedViewport || rendering
      || committedViewport.page !== page || !canvasRef.current || !(event.target instanceof HTMLCanvasElement)) return;
    const point = cssPointToPdfPoint(committedViewport.viewport, canvasRef.current.getBoundingClientRect(), event.clientX, event.clientY);
    if (!point) return;
    setPendingPin({
      location: selectedLocation,
      anchor: { drawingRef: activeBinding.drawingRef, page, x: point.x, y: point.y, coordinateSystem: "pdf_points" },
    });
  }

  function cssEventToPdf(event: React.PointerEvent<SVGSVGElement>) {
    if (!committedViewport || committedViewport.page !== page || rendering || !canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    return cssPointToPdfPoint(committedViewport.viewport, rect, event.clientX, event.clientY);
  }

  function beginMarkupDraw(event: React.PointerEvent<SVGSVGElement>) {
    if (!markupMode || !isDemoAdmin || !activeBinding || !committedViewport || rendering) return;
    const point = cssEventToPdf(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingStart.current = { ...point, pointerId: event.pointerId };
    markupAttemptRef.current = null;
    setPendingMarkup({ x1: point.x, y1: point.y, x2: point.x, y2: point.y });
    setMarkupText(editingMarkup && selectedMarkup ? selectedMarkup.text : "");
    if (!editingMarkup) {
      setSelectedMarkupId(null);
      setSelectedMarkup(null);
      onSelectMarkupRef.current?.(null);
    }
  }

  function moveMarkupDraw(event: React.PointerEvent<SVGSVGElement>) {
    const start = drawingStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const point = cssEventToPdf(event);
    if (!point) return;
    setPendingMarkup({ x1: Math.min(start.x, point.x), y1: Math.min(start.y, point.y), x2: Math.max(start.x, point.x), y2: Math.max(start.y, point.y) });
  }

  function finishMarkupDraw(event: React.PointerEvent<SVGSVGElement>) {
    const start = drawingStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    drawingStart.current = null;
    const point = cssEventToPdf(event);
    if (!point) { setPendingMarkup(null); return; }
    const rect = { x1: Math.min(start.x, point.x), y1: Math.min(start.y, point.y), x2: Math.max(start.x, point.x), y2: Math.max(start.y, point.y) };
    if (rect.x2 - rect.x1 < 2 || rect.y2 - rect.y1 < 2) { setPendingMarkup(null); return; }
    setPendingMarkup(rect);
  }

  function selectMarkup(id: string | null) {
    setSelectedMarkupId(id);
    onSelectMarkupRef.current?.(id);
  }

  async function savePendingMarkup() {
    if (!pendingMarkup || !activeBinding || !isDemoAdmin || !committedViewport || committedViewport.page !== page || !markupText.trim()) return;
    const requestSequence = markupContextSequence.current;
    const bindingId = activeBinding.id;
    const targetPage = page;
    const payloadFingerprint = JSON.stringify(editingMarkup && selectedMarkup
      ? { operation: "edit", id: selectedMarkup.id, version: selectedMarkup.version, rect: pendingMarkup, text: markupText.trim(), reason: markupReason.trim() }
      : { operation: "create", bindingId, page: targetPage, rect: pendingMarkup, text: markupText.trim() });
    if (markupAttemptRef.current?.fingerprint !== payloadFingerprint) {
      markupAttemptRef.current = { fingerprint: payloadFingerprint, key: crypto.randomUUID() };
    }
    const idempotencyKey = markupAttemptRef.current.key;
    setSavingMarkup(true);
    setMarkupError("");
    try {
      const saved = editingMarkup && selectedMarkup
        ? await editPdfDrawingMarkup(client, selectedMarkup.id, { expectedVersion: selectedMarkup.version, rect: pendingMarkup, text: markupText, reason: markupReason, idempotencyKey })
        : await createPdfDrawingMarkup(client, { bindingId, page: targetPage, rect: pendingMarkup, text: markupText, idempotencyKey });
      if (requestSequence !== markupContextSequence.current || activeBinding?.id !== bindingId || page !== targetPage) return;
      setPendingMarkup(null);
      setMarkupText("");
      setMarkupReason("");
      setEditingMarkup(false);
      markupAttemptRef.current = null;
      markupMutationAttempt.current = null;
      setMarkups((current) => [...current.filter((item) => item.id !== saved.id), saved]);
      setSelectedMarkup(saved);
      selectMarkup(saved.id);
      // Markups live in their own API. Refreshing the workspace here restarts
      // PDF loading and clears the selected markup before its history can render.
    } catch (reason) {
      if (requestSequence === markupContextSequence.current) {
        setMarkupError(apiErrorMessage(reason, tx("markupSaveFailed")));
        if (editingMarkup && selectedMarkup) {
          try {
            const latest = await fetchPdfDrawingMarkup(client, selectedMarkup.id);
            if (requestSequence === markupContextSequence.current) {
              setSelectedMarkup(latest);
              setMarkups((current) => [...current.filter((item) => item.id !== latest.id), latest]);
              setPendingMarkup(null);
              setEditingMarkup(false);
              setMarkupError(tx("markupConflict"));
            }
          } catch { /* retain original mutation error if refresh also fails */ }
        }
      }
    } finally {
      if (requestSequence === markupContextSequence.current) setSavingMarkup(false);
    }
  }

  function beginEditingMarkup() {
    if (!selectedMarkup || !selectedMarkup.availableCommands?.some((item) => item.command === "edit")) return;
    setMarkupMode(true);
    setEditingMarkup(true);
    setMarkupText(selectedMarkup.text);
    setMarkupReason("");
    setPendingMarkup({ ...selectedMarkup.rect });
    markupAttemptRef.current = null;
  }

  async function deleteSelectedMarkup() {
    if (!selectedMarkup || !selectedMarkup.availableCommands?.some((item) => item.command === "delete") || !markupReason.trim()) return;
    const requestSequence = markupContextSequence.current;
    const payload = { operation: "delete", id: selectedMarkup.id, version: selectedMarkup.version, reason: markupReason.trim() };
    const fingerprint = JSON.stringify(payload);
    if (markupMutationAttempt.current?.fingerprint !== fingerprint) markupMutationAttempt.current = { fingerprint, key: crypto.randomUUID() };
    setMarkupActionLoading(true);
    setMarkupError("");
    try {
      const deleted = await deletePdfDrawingMarkup(client, selectedMarkup.id, { expectedVersion: selectedMarkup.version, reason: markupReason, idempotencyKey: markupMutationAttempt.current.key });
      if (requestSequence !== markupContextSequence.current) return;
      setMarkups((current) => current.filter((item) => item.id !== deleted.id));
      setSelectedMarkup(deleted);
      onSelectMarkupRef.current?.(deleted.id);
      const history = await fetchPdfDrawingMarkupHistory(client, deleted.id);
      if (requestSequence !== markupContextSequence.current) return;
      setMarkupHistory(history);
      setShowMarkupHistory(true);
      setDeletingMarkup(false);
      setMarkupReason("");
      markupMutationAttempt.current = null;
    } catch (reason) {
      if (requestSequence === markupContextSequence.current) {
        setMarkupError(apiErrorMessage(reason, tx("markupDeleteFailed")));
        try { const latest = await fetchPdfDrawingMarkup(client, selectedMarkup.id); if (requestSequence === markupContextSequence.current) setSelectedMarkup(latest); } catch { /* show original conflict */ }
      }
    } finally { if (requestSequence === markupContextSequence.current) setMarkupActionLoading(false); }
  }

  async function savePendingPin() {
    if (!pendingPin || !isDemoAdmin) return;
    const requestSequence = pinContextSequence.current;
    setSavingPin(true);
    setLocationsError("");
    try {
      await savePdfLocationAnchor(client, pendingPin.location, pendingPin.anchor);
      if (requestSequence !== pinContextSequence.current) return;
      setPendingPin(null);
      const latest = await reloadLocations(requestSequence);
      if (requestSequence !== pinContextSequence.current) return;
      const updated = latest.find((location) => location.reference.objectId === pendingPin.location.reference.objectId);
      if (updated) setSelectedLocationRef(updated.reference.objectId);
      onChanged?.();
    } catch (reason) {
      const statusCode = reason && typeof reason === "object" && "status" in reason ? Number((reason as { status: unknown }).status) : 0;
      if (requestSequence !== pinContextSequence.current) return;
      setPendingPin(null);
      if (statusCode === 409) {
        try { await reloadLocations(requestSequence); } catch { /* error already shown */ }
        if (requestSequence === pinContextSequence.current) setLocationsError(tx("pinConflict"));
      } else {
        setLocationsError(apiErrorMessage(reason, tx("pinSaveFailed")));
      }
    } finally {
      if (requestSequence === pinContextSequence.current) setSavingPin(false);
    }
  }

  return <section aria-label={tx("panel")} className="pdf-viewer-panel">
    <header className="pdf-viewer-header">
      <div><h2>{tx("title")}</h2><p>{tx("description")}</p>{readOnly && <p className="text-sm text-slate-500">{tx("officialWarning")}</p>}</div>
      {!readOnly && <label className="pdf-upload-button">{tx("upload")}<input data-testid="pdf-upload" type="file" accept="application/pdf,.pdf" disabled={uploading} onChange={(event) => { void chooseFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>}
    </header>
    <div className="pdf-toolbar">
      <label className="pdf-source-label">{tx("sourceLabel")}<select aria-label={tx("sourceSelect")} disabled={savingPin} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
        <option value="">{tx("sourceSelect")}…</option>{sources.map((source) => <option key={source.id} value={source.id}>{tx("evidence", { name: source.name })}</option>)}
        {boundOnlyEvidence.map((binding) => <option key={binding.evidenceRef.objectId} value={binding.evidenceRef.objectId}>{tx("historical", { id: binding.evidenceRef.objectId, version: binding.evidenceRef.version })}</option>)}
        {selectedId && !sources.some((source) => source.id === selectedId) && !boundOnlyEvidence.some((binding) => binding.evidenceRef.objectId === selectedId) && <option value={selectedId}>{tx("uploaded", { id: selectedId })}</option>}
      </select></label>
      <label className="pdf-search-label">{tx("search")}<input type="search" aria-label={tx("search")} placeholder={tx("searchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <span className="pdf-match-count" aria-live="polite">{searchError || (searching ? tx("searching") : query.length >= 2 ? tx("pagesFound", { count: matches.length }) : "")}</span>
    </div>
    {status.kind === "error" && <p className="pdf-state pdf-error" role="alert">{status.message}</p>}
    {status.kind === "loading" && <p className="pdf-state" role="status">{status.message}</p>}
    {status.kind === "idle" && !selectedId && <p className="pdf-state">{readOnly ? t("launch.pdfEmpty", { defaultValue: tx("sourceSelect") }) : tx("selectOrUpload")}</p>}
    {status.kind === "idle" && selectedId && status.message && <p className="pdf-state">{status.message}</p>}

    {selectedId && <>
      {directoryLoading && <p role="status" className="pdf-state">{tx("checkingDirectory")}</p>}
      {bindingError && <p role="alert" className="pdf-error">{bindingError}</p>}
      {locationsError && <p role="alert" className="pdf-error">{locationsError}</p>}
      {!directoryLoading && matchingBindings.length === 0 && <p className="pdf-state">{tx("noBinding")}</p>}
      {matchingBindings.length > 1 && <label className="pdf-source-label">{tx("bindingVersion")}<select aria-label={tx("bindingVersion")} disabled={savingPin} value={activeBinding?.id ?? ""} onChange={(event) => setSelectedBindingId(event.target.value)}>
        <option value="">{tx("chooseBinding")}</option>
        {matchingBindings.map((binding) => <option key={binding.id} value={binding.id}>{binding.drawingRef.objectId} · {recordVersionLabel(binding.drawingRef.version)} · {tx("evidenceVersion")} {recordVersionLabel(binding.evidenceRef.version)}</option>)}
      </select></label>}
      {matchingBindings.length === 1 && <p className="pdf-binding-label">{tx("boundDrawing")} {matchingBindings[0].drawingRef.objectId} · {recordVersionLabel(matchingBindings[0].drawingRef.version)} · {tx("registeredEvidence")} {recordVersionLabel(matchingBindings[0].evidenceRef.version)} · {matchingBindings[0].fileHash.slice(0, 12)}</p>}
      {!readOnly && activeBinding && <div className="pdf-markup-controls">
        <div className="pdf-markup-heading"><strong>{tx("markup")}</strong><span>{markupLoading ? tx("loading") : tx("count", { count: markups.length })} · {tx("rectangleMemo")}</span></div>
        <div className="pdf-layer-toggles">
          <label><input type="checkbox" checked={showMarkupLayer} onChange={(event) => setShowMarkupLayer(event.target.checked)} />{tx("showMarkup")}</label>
          <label><input type="checkbox" checked={showPinLayer} onChange={(event) => setShowPinLayer(event.target.checked)} />{tx("showPins")}</label>
        </div>
        {isDemoAdmin && <button type="button" aria-pressed={markupMode} disabled={savingMarkup || markupActionLoading || rendering} onClick={() => { setMarkupMode((value) => !value); setEditingMarkup(false); setPendingMarkup(null); setMarkupText(""); setMarkupReason(""); markupAttemptRef.current = null; }}>
          {markupMode ? tx("stopDrawing") : tx("addMemo")}
        </button>}
        {markupMode && <span>{tx("drawingInstructions")}</span>}
        {pendingMarkup && isDemoAdmin && <label className="pdf-markup-memo">{tx("memo")}<textarea aria-label={tx("memoLabel")} maxLength={2000} rows={2} value={markupText} onChange={(event) => setMarkupText(event.target.value)} placeholder={tx("memoPlaceholder")} /></label>}
        {pendingMarkup && editingMarkup && <label className="pdf-markup-memo">{tx("editReason")}<textarea aria-label={tx("editReasonLabel")} maxLength={500} rows={2} value={markupReason} onChange={(event) => setMarkupReason(event.target.value)} /></label>}
        {pendingMarkup && <button type="button" disabled={savingMarkup || rendering || !markupText.trim() || (editingMarkup && !markupReason.trim())} onClick={() => void savePendingMarkup()}>{savingMarkup ? tx("saving") : editingMarkup ? tx("saveEdit") : tx("saveMarkup")}</button>}
        {markupError && <span role="alert" className="pdf-error-text">{markupError}</span>}
        {markups.length > 0 && <ul className="pdf-markup-list" aria-label={tx("savedMarkups")}>{markups.filter((item) => item.page === page).map((item) =>
          <li key={item.id}><button type="button" className={selectedMarkupId === item.id ? "is-selected" : ""} onClick={() => { setEditingMarkup(false); setDeletingMarkup(false); setMarkupReason(""); selectMarkup(selectedMarkupId === item.id ? null : item.id); }}>
            p.{item.page} · {item.text} · {recordVersionLabel(item.version)}
          </button></li>)}
        </ul>}
        {selectedMarkup && <div className="pdf-markup-detail">
          <p>{tx("selectedMarkup")} · {tx("version")} {selectedMarkup.version}{selectedMarkup.deletedAt ? " · " + tx("deleted") : ""}</p>
          {selectedMarkup.availableCommands?.some((item) => item.command === "edit") && !editingMarkup && !deletingMarkup && <button type="button" onClick={beginEditingMarkup}>{tx("editMarkup")}</button>}
          {selectedMarkup.availableCommands?.some((item) => item.command === "delete") && !deletingMarkup && !editingMarkup && <button type="button" onClick={() => { setDeletingMarkup(true); setMarkupReason(""); }}>{tx("deleteMarkup")}</button>}
          {deletingMarkup && <><p>{tx("deleteWarning")}</p><label className="pdf-markup-memo">{tx("deleteReason")}<textarea aria-label={tx("deleteReasonLabel")} maxLength={500} rows={2} value={markupReason} onChange={(event) => setMarkupReason(event.target.value)} /></label><button type="button" disabled={markupActionLoading || !markupReason.trim()} onClick={() => void deleteSelectedMarkup()}>{markupActionLoading ? tx("deleting") : tx("confirmDelete")}</button><button type="button" onClick={() => { setDeletingMarkup(false); setMarkupReason(""); }}>{tx("cancel")}</button></>}
          {selectedMarkup.deleteReason && <p>{tx("deleteReason")}: {selectedMarkup.deleteReason}</p>}
          <button type="button" aria-expanded={showMarkupHistory} onClick={() => setShowMarkupHistory((value) => !value)}>{showMarkupHistory ? tx("hideHistory") : `${tx("showHistory")}${selectedMarkup.historySummary ? ` (${selectedMarkup.historySummary.count})` : ""}`}</button>
          {showMarkupHistory && <ol className="pdf-markup-history" aria-label={tx("history")}>{markupHistory.map((snapshot) => <li key={snapshot.version}><strong>{recordVersionLabel(snapshot.version)}</strong> · {snapshot.text}{snapshot.eventAt ? ` · ${new Date(snapshot.eventAt).toLocaleString(language)}` : ""}{snapshot.eventBy ? ` · ${snapshot.eventBy}` : ""}{snapshot.reason || snapshot.updateReason || snapshot.deleteReason ? ` · ${tx("eventReason", { reason: snapshot.reason || snapshot.updateReason || snapshot.deleteReason || "" })}` : ""}</li>)}</ol>}
        </div>}
      </div>}
      {!readOnly && activeBinding && <div className="pdf-pin-controls">
        <label>{tx("location")}<select aria-label={tx("pinLocationLabel")} disabled={savingPin} value={selectedLocationRef} onChange={(event) => setSelectedLocationRef(event.target.value)}>
          <option value="">{tx("locationSelect")}</option>
          {locations.map((location) => <option key={location.reference.objectId} value={location.reference.objectId}>{location.name}</option>)}
        </select></label>
        <span>{isDemoAdmin ? tx("pinInstructions") : tx("pinAdminOnly")}</span>
        {pendingPin && <button type="button" onClick={() => void savePendingPin()} disabled={savingPin || rendering}>{savingPin ? tx("saving") : tx("savePin")}</button>}
      </div>}
    </>}

    {status.kind === "ready" && <>
      <div className="pdf-page-controls">
        <button type="button" aria-label={tx("previousPage")} disabled={page <= 1 || savingPin} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>
        <label>{tx("page")} <input aria-label={tx("pageNumber")} type="number" min={1} max={pageCount} value={page} onChange={(event) => { const next = Number(event.target.value); if (next >= 1 && next <= pageCount) setPage(next); }} /> / {pageCount}</label>
        <button type="button" aria-label={tx("nextPage")} disabled={page >= pageCount || savingPin} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button>
        <button type="button" aria-label={tx("zoomOut")} disabled={savingPin} onClick={() => setZoom((value) => Math.max(.5, +(value - .1).toFixed(1)))}>−</button><span>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label={tx("zoomIn")} disabled={savingPin} onClick={() => setZoom((value) => Math.min(2.5, +(value + .1).toFixed(1)))}>＋</button>
        <button type="button" aria-label={locale === "ko" ? "도면 이동" : locale === "vi" ? "Di chuyển bản vẽ" : "Pan drawing"} aria-pressed={panMode} onClick={() => setPanMode((value) => !value)}>{locale === "ko" ? "이동" : "Pan"}</button>
        <button type="button" aria-label={locale === "ko" ? "화면 맞춤" : locale === "vi" ? "Vừa khung" : "Fit to screen"} onClick={() => { setZoom(1); const viewport = viewportRef.current; if (viewport) { viewport.scrollLeft = 0; viewport.scrollTop = 0; } }}>{locale === "ko" ? "화면 맞춤" : "Fit"}</button>
        <button type="button" aria-label={tx("rotate")} disabled={savingPin} onClick={() => setRotation((value) => (value + 90) % 360)}>{tx("rotate")}</button>
        {matches.map((match) => <button type="button" key={match} onClick={() => setPage(match)}>{tx("searchResult", { page: match })}</button>)}
      </div>
      <div className={"pdf-canvas-viewport" + (panMode ? " is-panning" : "")} ref={viewportRef}
        onPointerDown={(event) => { if (!panMode || event.button !== 0) return; const view = viewportRef.current; if (!view) return; panOrigin.current = { x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { if (!panOrigin.current) return; const view = viewportRef.current; if (!view) return; view.scrollLeft = panOrigin.current.left - (event.clientX - panOrigin.current.x); view.scrollTop = panOrigin.current.top - (event.clientY - panOrigin.current.y); }}
        onPointerUp={() => { panOrigin.current = null; }} onPointerCancel={() => { panOrigin.current = null; }}>
        <div className="pdf-canvas-stack" onClick={panMode ? undefined : stagePin} aria-disabled={!isDemoAdmin || !activeBinding || !selectedLocation || rendering}>
          <canvas ref={canvasRef} aria-label={tx("canvasPage", { page, count: pageCount })} />
          <svg className={"pdf-markup-layer" + (markupMode ? " is-drawing" : "")} aria-label={tx("markupArea")} style={{ visibility: showMarkupLayer ? "visible" : "hidden" }}
            viewBox={`0 0 ${Math.max(1, canvasSize.width)} ${Math.max(1, canvasSize.height)}`} preserveAspectRatio="none"
            onPointerDown={beginMarkupDraw} onPointerMove={moveMarkupDraw} onPointerUp={finishMarkupDraw}
            onPointerCancel={() => { drawingStart.current = null; setPendingMarkup(null); }}>
            {overlayMarkups.map(({ item, points }) => <polygon key={item.id} points={points.map((point) => `${point.left},${point.top}`).join(" ")}
              className={selectedMarkupId === item.id ? "pdf-markup-shape is-selected" : "pdf-markup-shape"}
              role="button" tabIndex={0} aria-label={tx("markupItem", { text: item.text })} onClick={(event) => { event.stopPropagation(); selectMarkup(selectedMarkupId === item.id ? null : item.id); }}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectMarkup(selectedMarkupId === item.id ? null : item.id); } }} />)}
            {pendingMarkupPoints && <polygon points={pendingMarkupPoints.map((point) => `${point.left},${point.top}`).join(" ")} className="pdf-markup-shape is-pending" />}
          </svg>
          <div className="pdf-pin-layer" aria-label={tx("pinLayer")} style={{ visibility: showPinLayer ? "visible" : "hidden" }}>
            {overlayPins.map((pin, index) => <button
              type="button"
              key={pin.locationName + "-" + index}
              className={"pdf-location-pin" + (pin.locationName.endsWith(" · " + tx("unsaved")) ? " is-pending" : "")}
              data-testid={pin.locationName.endsWith(" · " + tx("unsaved")) ? "pdf-pin-preview" : "pdf-location-pin"}
              data-pdf-x={pin.anchor.x}
              data-pdf-y={pin.anchor.y}
              data-pdf-page={pin.anchor.page}
              style={{ left: pin.point.left, top: pin.point.top }}
              title={pin.locationName}
              aria-label={tx("pinLabel", { name: pin.locationName })}
              onClick={(event) => event.stopPropagation()}
            >{index + 1}</button>)}
          </div>
        </div>
      </div>
      {rendering && <p role="status" className="pdf-rendering-state">{tx("rendering")}</p>}
      <footer className="pdf-readonly-note">{tx("readOnly")}</footer>
    </>}
  </section>;
}
