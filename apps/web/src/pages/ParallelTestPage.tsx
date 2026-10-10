import { recordVersionLabel } from "../labels";
import { RecordDetails } from "./RecordDetails";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, type SupervisionClient } from "../data/supervision-client";
import type { CommandDescriptor, WorkItem, Workspace } from "../data/ui-contract";
import { ActionButton, Panel, SectionHeader } from "../ui";
import { reasonLabel, states as stateLabels } from "../labels";
import { formatNumber, formatTime } from "../i18n/format";
import { EvidenceRegistrationPanel } from "./parallel/EvidenceRegistrationPanel";
import { WorkInboxActionsPanel } from "./WorkInboxActionsPanel";
import { LocationEditorPanel } from "./parallel/LocationEditorPanel";
import { SafetyConnectedPanel } from "./parallel/SafetyConnectedPanel";
import { InspectionCaseFlowPanel } from "./parallel/InspectionCaseFlowPanel";
import { DrawingPdfBindingPanel } from "./parallel/DrawingPdfBindingPanel";
import { DrawingTechnicalApprovalPanel } from "./parallel/DrawingTechnicalApprovalPanel";
import { DrawingFieldManagementPanel } from "./parallel/DrawingFieldManagementPanel";
import { DrawingSourceRegistrationPanel } from "./parallel/DrawingSourceRegistrationPanel";
import { DrawingMarkupIssuePanel } from "./parallel/DrawingMarkupIssuePanel";
import { NotificationEventsPanel } from "./parallel/NotificationEventsPanel";

const PdfViewerPanel = lazy(() => import("./parallel/PdfViewerPanel").then(module => ({ default: module.PdfViewerPanel })));

const DrawingComparePanel = lazy(() => import("./parallel/DrawingComparePanel").then(module => ({ default: module.DrawingComparePanel })));

type ModuleId = "drawing-compare" | "drawings" | "locations" | "work-inbox" | "notifications" | "safety-traceability" | "evidence-quarantine";
type ModuleState = { data: unknown; error: string; loading: boolean; refreshedAt?: string };
type Locale = "ko" | "vi" | "en";
const modules: Array<{ id: ModuleId; labelKey: string }> = [
  { id: "drawings", labelKey: "drawings" }, { id: "drawing-compare", labelKey: "drawingCompare" }, { id: "locations", labelKey: "locations" },
  { id: "work-inbox", labelKey: "workInbox" }, { id: "notifications", labelKey: "notifications" },
  { id: "safety-traceability", labelKey: "safetyTraceability" }, { id: "evidence-quarantine", labelKey: "evidenceQuarantine" },
];
const copy: Record<Locale, Record<string, string>> = {
  ko: {
    title: "현장 업무 상세자료", project: "현장", description: "관련 도면·증빙·위치와 업무 처리 내역을 확인합니다. 자료를 불러오지 못한 경우와 등록된 자료가 없는 경우를 구분합니다.", testModules: "업무 선택",
    drawings: "도면 작성 차수", drawingCompare: "도면 비교", locations: "위치 계층", workInbox: "작업함", notifications: "알림", safetyTraceability: "안전 관련 기록 확인", evidenceQuarantine: "미등록 파일 확인",
    drawingLoading: "도면 비교를 불러오는 중…", pdfLoading: "PDF 보기를 불러오는 중…", recentFetch: "최근 조회", notFetched: "아직 조회되지 않음",
    selectSafetyRecord: "안전관리 기록", chooseSource: "원본 기록 선택", fetchSource: "선택 원본 조회", quarantineList: "격리 목록 조회", refresh: "다시 조회", retry: "다시 시도",
    testOnly: "격리 전용 테스트 경로입니다. 업로드 파일은 원본 업무 기록에 발행되지 않습니다. 최대 20 MiB.", testFile: "시험 파일", upload: "시험 파일 보관", quarantining: "격리 중…", quarantineResponse: "시험 파일 보관 결과",
    serverWaiting: "업무 시스템 응답을 기다리는 중…", safetyEmptyTitle: "안전관리 기록을 선택하십시오.", safetyEmptyDescription: "선택한 원본 번호와 정확한 작성 차수로 관련 기록 확인 조회를 요청합니다.", noSafetyRecords: "현재 업무 화면에 표시 가능한 안전관리 기록이 없습니다.",
    noServerRecords: "업무 시스템 응답에 표시할 기록이 없습니다.", responseMetadata: "응답 자료 상세정보", records: "기록", selectedRecord: "선택 기록", exactDrawingVersion: "정확한 도면 작성 차수 조회 중…", isolatedFiles: "보관된 시험 파일", selectedSafetyResponse: "선택한 안전 기록 응답",
    safetyResponseDescription: "업무 시스템 응답에서 선택 원본의 연결 기록과 진단을 확인합니다.", openEvidence: "증빙 업로드 화면 열기", drawingDescription: "도면별 개정과 업무 시스템이 제공하는 해당 도면에 연결된 업무 기록을 표시합니다. PDF 원본 확인은 위의 읽기 전용 보기에서 할 수 있습니다.",
    locationDescription: "상위 위치와 현장 내 위치 구분을 원본 값 그대로 확인합니다.", chooseRecord: "기록", revision: "개정", uploadFileTooLarge: "파일 크기는 20 MiB 이하여야 합니다.", uploadError: "증빙 격리 업로드를 완료하지 못했습니다.",
    fetchError: "업무 시스템에서 자료를 조회하지 못했습니다.", queryFailed: "조회 실패", drawingError: "도면 상세를 조회하지 못했습니다.", recordFallback: "기록", statusUnavailable: "확인 정보 없음", genericError: "처리 중 오류가 발생했습니다.",
  },
  vi: {
    title: "Kiểm thử tích hợp tính năng song song", project: "Dự án", description: "Hiển thị phản hồi gốc được truy vấn từ API phát triển. Phân biệt lỗi truy vấn với kết quả trống.", testModules: "Mô-đun kiểm thử",
    drawings: "Phiên bản bản vẽ", drawingCompare: "So sánh bản vẽ", locations: "Cấu trúc vị trí", workInbox: "Hộp công việc", notifications: "Thông báo", safetyTraceability: "Truy xuất an toàn", evidenceQuarantine: "Kiểm thử cách ly bằng chứng",
    drawingLoading: "Đang tải so sánh bản vẽ…", pdfLoading: "Đang tải trình xem PDF…", recentFetch: "Truy vấn gần nhất", notFetched: "Chưa truy vấn",
    selectSafetyRecord: "Hồ sơ an toàn nguồn", chooseSource: "Chọn hồ sơ nguồn", fetchSource: "Truy vấn hồ sơ đã chọn", quarantineList: "Truy vấn danh sách cách ly", refresh: "Truy vấn lại", retry: "Thử lại",
    testOnly: "Đây là đường dẫn chỉ dùng để kiểm thử cách ly. Tệp tải lên không được phát hành thành hồ sơ công việc gốc. Tối đa 20 MiB.", testFile: "Tệp kiểm thử", upload: "Tải lên để kiểm thử cách ly", quarantining: "Đang cách ly…", quarantineResponse: "Phản hồi tải lên cách ly",
    serverWaiting: "Đang chờ phản hồi từ máy chủ…", safetyEmptyTitle: "Hãy chọn hồ sơ an toàn nguồn.", safetyEmptyDescription: "Truy vấn khả năng truy xuất bằng ID và phiên bản chính xác của hồ sơ đã chọn.", noSafetyRecords: "Không có hồ sơ an toàn nào hiển thị trong không gian làm việc hiện tại.",
    noServerRecords: "Phản hồi máy chủ không có hồ sơ để hiển thị.", responseMetadata: "Siêu dữ liệu phản hồi", records: "hồ sơ", selectedRecord: "Hồ sơ đã chọn", exactDrawingVersion: "Đang truy vấn đúng phiên bản bản vẽ…", isolatedFiles: "Danh sách tệp cách ly", selectedSafetyResponse: "Phản hồi hồ sơ an toàn đã chọn",
    safetyResponseDescription: "Kiểm tra các hồ sơ liên kết và chẩn đoán cho nguồn đã chọn trong phản hồi của máy chủ.", openEvidence: "Mở màn hình tải bằng chứng", drawingDescription: "Hiển thị revision của từng bản vẽ và hồ sơ liên kết chính xác do máy chủ cung cấp. Có thể xem bản PDF gốc trong trình xem chỉ đọc phía trên.",
    locationDescription: "Xem nguyên giá trị trường cha và đường dẫn của nút vị trí.", chooseRecord: "hồ sơ", revision: "Lần sửa đổi", uploadFileTooLarge: "Kích thước tệp phải không vượt quá 20 MiB.", uploadError: "Không thể hoàn tất tải bằng chứng vào khu cách ly.",
    fetchError: "Không thể truy vấn dữ liệu từ máy chủ.", queryFailed: "Truy vấn thất bại", drawingError: "Không thể truy vấn chi tiết bản vẽ.", recordFallback: "Hồ sơ", statusUnavailable: "Chưa có thông tin", genericError: "Đã xảy ra lỗi khi xử lý.",
  },
  en: {
    title: "Parallel feature integration tests", project: "Project", description: "Displays raw responses queried from the development API. Query failures are distinct from empty results.", testModules: "Test modules",
    drawings: "Drawing versions", drawingCompare: "Drawing comparison", locations: "Location hierarchy", workInbox: "Work inbox", notifications: "Notifications", safetyTraceability: "Safety traceability", evidenceQuarantine: "Evidence quarantine test",
    drawingLoading: "Loading drawing comparison…", pdfLoading: "Loading PDF viewer…", recentFetch: "Last queried", notFetched: "Not queried yet",
    selectSafetyRecord: "Source safety record", chooseSource: "Select source record", fetchSource: "Query selected source", quarantineList: "Query quarantine list", refresh: "Refresh", retry: "Retry",
    testOnly: "Quarantine-only test path. Uploaded files are not published as original work records. 20 MiB maximum.", testFile: "Test file", upload: "Upload quarantine test", quarantining: "Quarantining…", quarantineResponse: "Quarantine upload response",
    serverWaiting: "Waiting for server response…", safetyEmptyTitle: "Select a source safety record.", safetyEmptyDescription: "Requests traceability using the selected source ID and exact version.", noSafetyRecords: "No safety records are visible in the current workspace.",
    noServerRecords: "The server response contains no records to display.", responseMetadata: "Response metadata", records: "records", selectedRecord: "Selected record", exactDrawingVersion: "Querying the exact drawing version…", isolatedFiles: "Quarantined files", selectedSafetyResponse: "Selected safety record response",
    safetyResponseDescription: "Review linked records and diagnostics for the selected source in the server response.", openEvidence: "Open evidence upload screen", drawingDescription: "Shows each drawing revision and the exact linked record supplied by the server. The read-only viewer above can open the source PDF.",
    locationDescription: "Inspect the original parent and path values for the location node.", chooseRecord: "record", revision: "Revision", uploadFileTooLarge: "File size must be 20 MiB or less.", uploadError: "Could not complete evidence quarantine upload.",
    fetchError: "Could not query data from the server.", queryFailed: "Query failed", drawingError: "Could not query drawing details.", recordFallback: "Record", statusUnavailable: "Information unavailable", genericError: "An error occurred while processing the request.",
  },
};
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function rowsFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const object = asObject(value);
  for (const key of ["items", "drawings", "locations", "records", "notifications", "workItems"]) if (Array.isArray(object[key])) return object[key] as unknown[];
  return [];
}
function displayLabel(value: unknown, index: number, fallback: string) {
  const row = asObject(value);
  const nested = asObject(row.record);
  const data = asObject(nested.data);
  const label = row.title ?? row.name ?? row.label ?? row.drawingNumber ?? row.locationName ?? row.subject ?? row.message ?? nested.title ?? data.title ?? data.workName ?? data.permitNo;
  return typeof label === "string" && label ? label : `${fallback} ${index + 1}`;
}

function errorToken(error: unknown, fallbackKey: string) {
  if (error instanceof ApiError) return `reason:${error.detail.code}`;
  return `copy:${fallbackKey}`;
}

function errorText(value: string, tx: (key: string) => string) {
  if (value.startsWith("reason:")) return reasonLabel(value.slice("reason:".length));
  if (value.startsWith("copy:")) return tx(value.slice("copy:".length));
  return value;
}

export function ParallelTestPage({ client, workspace, online, onNavigate, onChanged, onSelect, onOpenCommand }: { client: SupervisionClient; workspace: Workspace; online: boolean; onNavigate: (route: string) => void; onChanged?: () => void; onSelect?: (id: string | null) => void; onOpenCommand?: (item: WorkItem, action: CommandDescriptor) => void }) {
  const { i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? i18n.language).slice(0, 2);
  const language: Locale = locale === "ko" || locale === "vi" ? locale : "en";
  const tx = useCallback((key: string) => copy[language][key] || copy.en[key] || key, [language]);
  const [active, setActive] = useState<ModuleId>("drawings");
  const [selectedMarkupId, setSelectedMarkupId] = useState<string | null>(null);
  const [markupRefreshVersion, setMarkupRefreshVersion] = useState(0);
  const selectMarkup = useCallback((id: string | null) => { setSelectedMarkupId(id); setMarkupRefreshVersion(value => value + 1); }, []);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedSafetyId, setSelectedSafetyId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadResult, setUploadResult] = useState<unknown>(null);
  const [drawingDetail, setDrawingDetail] = useState<unknown>(null);
  const [drawingError, setDrawingError] = useState("");
  const [drawingLoading, setDrawingLoading] = useState(false);
  const [states, setStates] = useState<Record<ModuleId, ModuleState>>({
    "drawing-compare": { data: null, error: "", loading: false }, "drawings": { data: null, error: "", loading: true }, "locations": { data: null, error: "", loading: true },
    "work-inbox": { data: null, error: "", loading: true }, "notifications": { data: null, error: "", loading: true },
    "safety-traceability": { data: null, error: "", loading: false }, "evidence-quarantine": { data: null, error: "", loading: false },
  });
  const refresh = useCallback(async (moduleId: ModuleId) => {
    setStates(current => ({ ...current, [moduleId]: { ...current[moduleId], loading: true, error: "" } }));
    try {
      const result = await client.request<unknown>(client.path(`/parallel/${moduleId}`));
      setStates(current => ({ ...current, [moduleId]: { data: result, error: "", loading: false, refreshedAt: new Date().toISOString() } }));
    } catch (error) {
      setStates(current => ({ ...current, [moduleId]: { data: null, error: errorToken(error, "fetchError"), loading: false } }));
    }
  }, [client]);
  useEffect(() => {
    const timer = window.setTimeout(() => { if (active === "drawings" || active === "locations") void refresh(active); }, 0);
    return () => window.clearTimeout(timer);
  }, [active, refresh]);
  const safetyItems = workspace.items.filter(item => item.machine === "safety_stop_order");
  const loadSafetyRecord = useCallback(async () => {
    const item = safetyItems.find(candidate => candidate.record.id === selectedSafetyId);
    if (!item) return;
    setStates(current => ({ ...current, "safety-traceability": { ...current["safety-traceability"], loading: true, error: "" } }));
    try {
      const query = new URLSearchParams({ object_id: item.record.id, version: String(item.record.version) });
      const result = await client.request<unknown>(client.path(`/parallel/safety-traceability?${query.toString()}`));
      setStates(current => ({ ...current, "safety-traceability": { data: result, error: "", loading: false, refreshedAt: new Date().toISOString() } }));
    } catch (error) {
      setStates(current => ({ ...current, "safety-traceability": { data: null, error: errorToken(error, "fetchError"), loading: false } }));
    }
  }, [client, safetyItems, selectedSafetyId]);
  const loadDrawingDetail = useCallback(async (row: unknown, index: number) => {
    const reference = asObject(asObject(row).domainRef);
    if (!reference.objectId || reference.version === undefined) return;
    setSelectedIndex(index); setDrawingLoading(true); setDrawingError(""); setDrawingDetail(null);
    try {
      const query = new URLSearchParams({ object_id: String(reference.objectId), version: String(reference.version) });
      const result = await client.request<unknown>(client.path(`/parallel/drawings?${query.toString()}`));
      setDrawingDetail(result);
    } catch (error) { setDrawingError(errorToken(error, "drawingError")); }
    finally { setDrawingLoading(false); }
  }, [client]);
  const uploadEvidence = useCallback(async () => {
    if (!uploadFile) return;
    setUploading(true); setUploadError(""); setUploadResult(null);
    try {
      if (uploadFile.size > 20 * 1024 * 1024) {
        setUploadError("copy:uploadFileTooLarge");
        setUploading(false);
        return;
      }
      const bytes = await uploadFile.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      const uploadId = crypto.randomUUID().replace(/-/g, "");
      const result = await client.request<unknown>(client.path("/parallel/evidence-quarantine"), {
        method: "POST",
        headers: { "X-Upload-Id": uploadId, "X-Upload-Size": String(uploadFile.size), "X-Upload-SHA256": sha256, "Content-Type": uploadFile.type || "application/octet-stream" },
        body: uploadFile,
      });
      setUploadResult(result);
    } catch (error) { setUploadError(errorToken(error, "uploadError")); }
    finally { setUploading(false); }
  }, [client, uploadFile]);
  const showDiagnostic = active !== "drawing-compare" && active !== "work-inbox" && active !== "notifications";
  const state = states[active];
  const rows = useMemo(() => rowsFrom(state.data), [state.data]);
  const selected = rows[selectedIndex] ?? rows[0];
  const root = asObject(state.data);
  const activeLabel = tx(modules.find(module => module.id === active)?.labelKey ?? active);
  return <div className="parallel-test-page"><Panel>
    <SectionHeader title={tx("title")} meta={`${tx("project")} ${workspace.project.id}`} />
    <p className="muted">{tx("description")}</p>
    <div className="parallel-test-tabs" role="tablist" aria-label={tx("testModules")}>{modules.map(module => <button key={module.id} type="button" role="tab" aria-selected={active === module.id} className={active === module.id ? "active" : ""} onClick={() => { setActive(module.id); setSelectedIndex(0); }}>{tx(module.labelKey)}</button>)}</div>
    {active === "drawing-compare" && <Suspense fallback={<div role="status">{tx("drawingLoading")}</div>}><DrawingComparePanel key={`DrawingComparePanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} /></Suspense>}
    {active === "drawings" && <DrawingSourceRegistrationPanel key={`DrawingSourceRegistrationPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} onNavigate={onNavigate} />}
    {active === "drawings" && <DrawingTechnicalApprovalPanel client={client} workspace={workspace} onOpenCommand={onOpenCommand} />}
    {active === "drawings" && <DrawingFieldManagementPanel key={`DrawingFieldManagementPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} onSelect={onSelect} onNavigate={onNavigate} />}
    {active === "drawings" && <DrawingPdfBindingPanel client={client} workspace={workspace} onChanged={onChanged} />}
    {active === "drawings" && <Suspense fallback={<div role="status">{tx("pdfLoading")}</div>}><PdfViewerPanel key={`PdfViewerPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} onSelectMarkup={selectMarkup} /></Suspense>}
    {active === "drawings" && <DrawingMarkupIssuePanel client={client} workspace={workspace} selectedMarkupId={selectedMarkupId} refreshVersion={markupRefreshVersion} onChanged={onChanged} onSelect={onSelect} onNavigate={onNavigate} />}
    {active === "locations" && <LocationEditorPanel key={`LocationEditorPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} />}
    {active === "notifications" && <NotificationEventsPanel key={`NotificationEventsPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} onSelect={onSelect} onNavigate={onNavigate} />}
    {active === "work-inbox" && <InspectionCaseFlowPanel client={client} workspace={workspace} online={online} onChanged={onChanged} onSelect={onSelect} onOpenCommand={onOpenCommand} />}
    {active === "work-inbox" && <WorkInboxActionsPanel key={`WorkInboxActionsPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} onNavigate={onNavigate} />}
    {active === "evidence-quarantine" && <EvidenceRegistrationPanel key={`EvidenceRegistrationPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} />}
    {active === "safety-traceability" && <SafetyConnectedPanel key={`SafetyConnectedPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} onSelect={onSelect} onOpenCommand={onOpenCommand} />}
    {showDiagnostic && <><div className="parallel-test-toolbar"><span>{state.refreshedAt ? `${tx("recentFetch")} ${formatTime(state.refreshedAt)}` : tx("notFetched")}</span>{active === "safety-traceability" ? <><select aria-label={tx("selectSafetyRecord")} value={selectedSafetyId} onChange={event => { setSelectedSafetyId(event.target.value); setStates(current => ({ ...current, "safety-traceability": { data: null, error: "", loading: false } })); }}><option value="">{tx("chooseSource")}</option>{safetyItems.map(item => <option key={item.record.id} value={item.record.id}>{item.record.title || item.machine} · {recordVersionLabel(item.record.version)} · {item.record.id}</option>)}</select><ActionButton onClick={() => void loadSafetyRecord()} disabled={state.loading || !selectedSafetyId}>{tx("fetchSource")}</ActionButton></> : <ActionButton onClick={() => void refresh(active)} disabled={state.loading}>{tx(active === "evidence-quarantine" ? "quarantineList" : "refresh")}</ActionButton>}</div>
    {active === "evidence-quarantine" && <div className="parallel-evidence-test">
      <p className="muted">{tx("testOnly")}</p>
      <label>{tx("testFile")} <input type="file" onChange={event => { setUploadFile(event.target.files?.[0] ?? null); setUploadError(""); setUploadResult(null); }} /></label>
      {uploadFile && <p>{uploadFile.name} · {formatNumber(uploadFile.size)} bytes · {uploadFile.type || "application/octet-stream"}</p>}
      <ActionButton onClick={() => void uploadEvidence()} disabled={!uploadFile || uploading || uploadFile.size > 20 * 1024 * 1024}>{uploading ? tx("quarantining") : tx("upload")}</ActionButton>
      {uploadError && <div role="alert" className="error-box">{errorText(uploadError, tx)}</div>}
      {uploadResult !== null && <div role="status"><strong>{tx("quarantineResponse")}</strong><RecordDetails value={uploadResult} /></div>}
    </div>}
    {state.loading && <div className="loading-panel" role="status">{tx("serverWaiting")}</div>}
    {!state.loading && state.error && <div role="alert" className="error-box"><strong>{activeLabel} {tx("queryFailed")}</strong><p>{errorText(state.error, tx)}</p><ActionButton onClick={() => void (active === "safety-traceability" ? loadSafetyRecord() : refresh(active))}>{tx("retry")}</ActionButton></div>}
    {active === "safety-traceability" && !selectedSafetyId && <div className="empty-state"><strong>{tx("safetyEmptyTitle")}</strong><p>{tx("safetyEmptyDescription")}</p>{safetyItems.length === 0 && <p>{tx("noSafetyRecords")}</p>}</div>}
    {!state.loading && !state.error && active !== "safety-traceability" && active !== "evidence-quarantine" && rows.length === 0 && <div className="empty-state"><strong>{tx("noServerRecords")}</strong><p>{tx("responseMetadata")}</p><RecordDetails value={root} /></div>}
    {!state.loading && !state.error && active !== "safety-traceability" && active !== "evidence-quarantine" && rows.length > 0 && <div className="parallel-test-grid">
      <div className="parallel-test-list" aria-label={`${activeLabel} ${tx("records")}`}>{rows.map((row, index) => <button type="button" key={String(asObject(row).id ?? asObject(row).recordId ?? index)} className={index === selectedIndex ? "selected" : ""} onClick={() => active === "drawings" ? void loadDrawingDetail(row, index) : setSelectedIndex(index)} style={active === "locations" ? { paddingLeft: `${12 + Number(asObject(row).depth ?? 0) * 12}px` } : undefined}><strong>{displayLabel(row, index, tx("recordFallback"))}</strong><small>{[stateLabels[String(asObject(row).sourceStatus ?? asObject(row).status ?? asObject(asObject(row).record).status)] || tx("statusUnavailable"), asObject(row).revision ? `${tx("revision")} ${asObject(row).revision}` : asObject(row).version ? recordVersionLabel(asObject(row).version) : undefined, asObject(row).discipline, asObject(row).locationId].filter(Boolean).join(" · ")}</small></button>)}</div>
      <div className="parallel-test-detail"><SectionHeader title={tx("selectedRecord")} meta={`${rows.length} ${tx("records")}`} />
        {active === "drawings" && <><p className="muted">{tx("drawingDescription")}</p>{drawingLoading && <div role="status">{tx("exactDrawingVersion")}</div>}{drawingError && <div role="alert" className="error-box">{errorText(drawingError, tx)}</div>}</>}
        {active === "locations" && <p className="muted">{tx("locationDescription")}</p>}
        <RecordDetails value={active === "drawings" ? drawingDetail ?? selected : selected} />
      </div>
    </div>}
    {active === "evidence-quarantine" && !state.loading && !state.error && state.data !== null && <div className="parallel-test-detail"><SectionHeader title={tx("isolatedFiles")} meta={`${rows.length} ${tx("records")}`} /><RecordDetails value={state.data} /></div>}
    {active === "safety-traceability" && selectedSafetyId && !state.loading && !state.error && state.data !== null && <div className="parallel-test-detail"><SectionHeader title={tx("selectedSafetyResponse")} /><p className="muted">{tx("safetyResponseDescription")}</p><RecordDetails value={state.data} /><ActionButton onClick={() => onNavigate("capture")}>{tx("openEvidence")}</ActionButton></div>}
    </>}
  </Panel></div>;
}
