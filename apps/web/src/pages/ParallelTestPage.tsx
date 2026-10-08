import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { SupervisionClient } from "../data/supervision-client";
import type { CommandDescriptor, WorkItem, Workspace } from "../data/ui-contract";
import { ActionButton, Panel, SectionHeader } from "../ui";
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
const modules: Array<{ id: ModuleId; label: string }> = [
  { id: "drawings", label: "도면 버전" }, { id: "drawing-compare", label: "도면 비교" }, { id: "locations", label: "위치 계층" },
  { id: "work-inbox", label: "작업함" }, { id: "notifications", label: "알림" },
  { id: "safety-traceability", label: "안전 추적성" }, { id: "evidence-quarantine", label: "증빙 격리 테스트" },
];
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function rowsFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const object = asObject(value);
  for (const key of ["items", "drawings", "locations", "records", "notifications", "workItems"]) if (Array.isArray(object[key])) return object[key] as unknown[];
  return [];
}
function displayLabel(value: unknown, index: number) {
  const row = asObject(value);
  const nested = asObject(row.record);
  const data = asObject(nested.data);
  const label = row.title ?? row.name ?? row.label ?? row.drawingNumber ?? row.locationName ?? row.subject ?? row.message ?? nested.title ?? data.title ?? data.workName ?? data.permitNo;
  return typeof label === "string" && label ? label : `기록 ${index + 1}`;
}
function stringify(value: unknown) { return JSON.stringify(value, null, 2) ?? ""; }

export function ParallelTestPage({ client, workspace, online, onNavigate, onChanged, onSelect, onOpenCommand }: { client: SupervisionClient; workspace: Workspace; online: boolean; onNavigate: (route: string) => void; onChanged?: () => void; onSelect?: (id: string | null) => void; onOpenCommand?: (item: WorkItem, action: CommandDescriptor) => void }) {
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
      setStates(current => ({ ...current, [moduleId]: { data: result, error: "", loading: false, refreshedAt: new Date().toLocaleTimeString("ko-KR") } }));
    } catch (error) {
      setStates(current => ({ ...current, [moduleId]: { data: null, error: error instanceof Error ? error.message : String(error), loading: false } }));
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
      setStates(current => ({ ...current, "safety-traceability": { data: result, error: "", loading: false, refreshedAt: new Date().toLocaleTimeString("ko-KR") } }));
    } catch (error) {
      setStates(current => ({ ...current, "safety-traceability": { data: null, error: error instanceof Error ? error.message : String(error), loading: false } }));
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
    } catch (error) { setDrawingError(error instanceof Error ? error.message : String(error)); }
    finally { setDrawingLoading(false); }
  }, [client]);
  const uploadEvidence = useCallback(async () => {
    if (!uploadFile) return;
    setUploading(true); setUploadError(""); setUploadResult(null);
    try {
      if (uploadFile.size > 20 * 1024 * 1024) throw new Error("파일 크기는 20 MiB 이하여야 합니다.");
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
    } catch (error) { setUploadError(error instanceof Error ? error.message : String(error)); }
    finally { setUploading(false); }
  }, [client, uploadFile]);
  const showDiagnostic = active !== "drawing-compare" && active !== "work-inbox" && active !== "notifications";
  const state = states[active];
  const rows = useMemo(() => rowsFrom(state.data), [state.data]);
  const selected = rows[selectedIndex] ?? rows[0];
  const root = asObject(state.data);
  return <div className="parallel-test-page"><Panel>
    <SectionHeader title="병렬 기능 통합 테스트" meta={`프로젝트 ${workspace.project.id}`} />
    <p className="muted">개발 API에서 조회한 원본 응답을 표시합니다. 조회 실패와 빈 결과를 구분합니다.</p>
    <div className="parallel-test-tabs" role="tablist" aria-label="테스트 모듈">{modules.map(module => <button key={module.id} type="button" role="tab" aria-selected={active === module.id} className={active === module.id ? "active" : ""} onClick={() => { setActive(module.id); setSelectedIndex(0); }}>{module.label}</button>)}</div>
    {active === "drawing-compare" && <Suspense fallback={<div role="status">도면 비교를 불러오는 중…</div>}><DrawingComparePanel key={`DrawingComparePanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} /></Suspense>}
    {active === "drawings" && <DrawingSourceRegistrationPanel key={`DrawingSourceRegistrationPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} onNavigate={onNavigate} />}
    {active === "drawings" && <DrawingTechnicalApprovalPanel client={client} workspace={workspace} onOpenCommand={onOpenCommand} />}
    {active === "drawings" && <DrawingFieldManagementPanel key={`DrawingFieldManagementPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} onSelect={onSelect} onNavigate={onNavigate} />}
    {active === "drawings" && <DrawingPdfBindingPanel client={client} workspace={workspace} onChanged={onChanged} />}
    {active === "drawings" && <Suspense fallback={<div role="status">PDF 뷰어를 불러오는 중…</div>}><PdfViewerPanel key={`PdfViewerPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} onSelectMarkup={selectMarkup} /></Suspense>}
    {active === "drawings" && <DrawingMarkupIssuePanel client={client} workspace={workspace} selectedMarkupId={selectedMarkupId} refreshVersion={markupRefreshVersion} onChanged={onChanged} onSelect={onSelect} onNavigate={onNavigate} />}
    {active === "locations" && <LocationEditorPanel key={`LocationEditorPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} />}
    {active === "notifications" && <NotificationEventsPanel key={`NotificationEventsPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} onSelect={onSelect} onNavigate={onNavigate} />}
    {active === "work-inbox" && <InspectionCaseFlowPanel client={client} workspace={workspace} online={online} onChanged={onChanged} onSelect={onSelect} onOpenCommand={onOpenCommand} />}
    {active === "work-inbox" && <WorkInboxActionsPanel key={`WorkInboxActionsPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} onNavigate={onNavigate} />}
    {active === "evidence-quarantine" && <EvidenceRegistrationPanel key={`EvidenceRegistrationPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} />}
    {active === "safety-traceability" && <SafetyConnectedPanel key={`SafetyConnectedPanel:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} onChanged={onChanged} onSelect={onSelect} onOpenCommand={onOpenCommand} />}
    {showDiagnostic && <><div className="parallel-test-toolbar"><span>{state.refreshedAt ? `최근 조회 ${state.refreshedAt}` : "아직 조회되지 않음"}</span>{active === "safety-traceability" ? <><select aria-label="안전 원본 레코드" value={selectedSafetyId} onChange={event => { setSelectedSafetyId(event.target.value); setStates(current => ({ ...current, "safety-traceability": { data: null, error: "", loading: false } })); }}><option value="">원본 기록 선택</option>{safetyItems.map(item => <option key={item.record.id} value={item.record.id}>{item.record.title || item.machine} · v{item.record.version} · {item.record.id}</option>)}</select><ActionButton onClick={() => void loadSafetyRecord()} disabled={state.loading || !selectedSafetyId}>선택 원본 조회</ActionButton></> : <ActionButton onClick={() => void refresh(active)} disabled={state.loading}>{active === "evidence-quarantine" ? "격리 목록 조회" : "다시 조회"}</ActionButton>}</div>
    {active === "evidence-quarantine" && <div className="parallel-evidence-test">
      <p className="muted">격리 전용 테스트 경로입니다. 업로드 파일은 원본 업무 기록에 발행되지 않습니다. 최대 20 MiB.</p>
      <label>테스트 파일 <input type="file" onChange={event => { setUploadFile(event.target.files?.[0] ?? null); setUploadError(""); setUploadResult(null); }} /></label>
      {uploadFile && <p>{uploadFile.name} · {uploadFile.size.toLocaleString()} bytes · {uploadFile.type || "application/octet-stream"}</p>}
      <ActionButton onClick={() => void uploadEvidence()} disabled={!uploadFile || uploading || uploadFile.size > 20 * 1024 * 1024}>{uploading ? "격리 중…" : "격리 테스트 업로드"}</ActionButton>
      {uploadError && <div role="alert" className="error-box">{uploadError}</div>}
      {uploadResult !== null && <div role="status"><strong>격리 업로드 응답</strong><pre>{stringify(uploadResult)}</pre></div>}
    </div>}
    {state.loading && <div className="loading-panel" role="status">서버 응답을 기다리는 중…</div>}
    {!state.loading && state.error && <div role="alert" className="error-box"><strong>{modules.find(x => x.id === active)?.label} 조회 실패</strong><p>{state.error}</p><ActionButton onClick={() => void (active === "safety-traceability" ? loadSafetyRecord() : refresh(active))}>다시 시도</ActionButton></div>}
    {active === "safety-traceability" && !selectedSafetyId && <div className="empty-state"><strong>안전 원본 레코드를 선택하십시오.</strong><p>선택한 원본 ID와 정확한 버전으로 추적성 조회를 요청합니다.</p>{safetyItems.length === 0 && <p>현재 작업공간에 표시 가능한 안전 레코드가 없습니다.</p>}</div>}
    {!state.loading && !state.error && active !== "safety-traceability" && active !== "evidence-quarantine" && rows.length === 0 && <div className="empty-state"><strong>서버 응답에 표시할 기록이 없습니다.</strong><p>응답 메타데이터</p><pre>{stringify(root)}</pre></div>}
    {!state.loading && !state.error && active !== "safety-traceability" && active !== "evidence-quarantine" && rows.length > 0 && <div className="parallel-test-grid">
      <div className="parallel-test-list" aria-label={`${modules.find(x => x.id === active)?.label} 기록`}>{rows.map((row, index) => <button type="button" key={String(asObject(row).id ?? asObject(row).recordId ?? index)} className={index === selectedIndex ? "selected" : ""} onClick={() => active === "drawings" ? void loadDrawingDetail(row, index) : setSelectedIndex(index)} style={active === "locations" ? { paddingLeft: `${12 + Number(asObject(row).depth ?? 0) * 12}px` } : undefined}><strong>{displayLabel(row, index)}</strong><small>{[asObject(row).sourceStatus ?? asObject(row).status ?? asObject(asObject(row).record).status, asObject(row).revision ? `개정 ${asObject(row).revision}` : asObject(row).version ? `v${asObject(row).version}` : undefined, asObject(row).discipline, asObject(row).locationId].filter(Boolean).join(" · ")}</small></button>)}</div>
      <div className="parallel-test-detail"><SectionHeader title="선택 기록" meta={`${rows.length}건`} />
        {active === "drawings" && <><p className="muted">도면별 revision과 서버가 제공하는 exact-linked record를 표시합니다. PDF 원본 확인은 위의 읽기 전용 뷰어에서 할 수 있습니다.</p>{drawingLoading && <div role="status">정확한 도면 버전 조회 중…</div>}{drawingError && <div role="alert" className="error-box">{drawingError}</div>}</>}
        {active === "locations" && <p className="muted">위치 노드의 부모·경로 필드를 원본 값 그대로 확인합니다.</p>}
        <pre>{stringify(active === "drawings" ? drawingDetail ?? selected : selected)}</pre>
      </div>
    </div>}
    {active === "evidence-quarantine" && !state.loading && !state.error && state.data !== null && <div className="parallel-test-detail"><SectionHeader title="격리 파일 목록" meta={`${rows.length}건`} /><pre>{stringify(state.data)}</pre></div>}
    {active === "safety-traceability" && selectedSafetyId && !state.loading && !state.error && state.data !== null && <div className="parallel-test-detail"><SectionHeader title="선택한 안전 기록 응답" /><p className="muted">서버 응답에서 선택 원본의 연결 기록과 진단을 확인합니다.</p><pre>{stringify(state.data)}</pre><ActionButton onClick={() => onNavigate("capture")}>증빙 업로드 화면 열기</ActionButton></div>}
    </>}
  </Panel></div>;
}
