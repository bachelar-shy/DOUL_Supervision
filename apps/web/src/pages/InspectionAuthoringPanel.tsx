import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SupervisionClient } from "../data/supervision-client";
import { ApiError } from "../data/supervision-client";
import type { RecordDTO, Workspace } from "../data/ui-contract";
import { createInspectionDraft, inspectionSources } from "../data/inspection-authoring-client";
import type { InspectionSources } from "../data/inspection-authoring-client";
import { reasonLabel } from "../labels";
import { formatNumber } from "../i18n/format";

type Locale = "en" | "ko" | "vi";
type LabelKey =
  | "title" | "description" | "workName" | "drawing" | "selectDrawing" | "revision" | "location" | "selectLocation"
  | "requirements" | "evidence" | "noRequirementsOrEvidence" | "fieldChecks" | "selfComplete" | "drawingCheck"
  | "materialCheck" | "testCheck" | "previousCheck" | "changeCheck" | "holdPoint" | "loadingSources"
  | "noDrawings" | "saveDraft" | "saving" | "saved" | "genericError";

const copy: Record<Locale, Record<LabelKey, string>> = {
  ko: {
    title: "자체검측 작성",
    description: "사용 가능한 도면과 실제 검측 위치·기준·증빙을 선택합니다. 출처 범위와 선행조건은 서버가 검증하며, 초안 저장은 검측 요청 제출이 아닙니다.",
    workName: "공종·작업명", drawing: "검측 기준 도면", selectDrawing: "도면 선택", revision: "개정", location: "검측 위치", selectLocation: "위치 선택",
    requirements: "검측 기준", evidence: "현장 증빙", noRequirementsOrEvidence: "이 위치의 검측 기준 또는 증빙이 없습니다. 해당 위치의 기준·증빙을 등록한 후 작성하십시오.",
    fieldChecks: "현장 확인", selfComplete: "자체검측 완료", drawingCheck: "도면 확인", materialCheck: "자재 확인", testCheck: "시험 확인",
    previousCheck: "선행 공정 확인", changeCheck: "변경사항 확인", holdPoint: "다음 공정 전 확인이 필요한 중지점",
    loadingSources: "검측에 사용할 수 있는 자료를 확인하는 중…",
    noDrawings: "현재 사용할 수 있는 도면이 없습니다. 기술 승인과 현장 배포·수령 상태를 확인하십시오.",
    saveDraft: "자체검측 초안 저장", saving: "저장 중…", saved: "자체검측 초안을 저장했습니다.",
    genericError: "검측 자료 요청을 완료할 수 없습니다. 연결을 확인한 뒤 다시 시도하세요.",
  },
  vi: {
    title: "Lập phiếu tự nghiệm thu",
    description: "Chọn bản vẽ, vị trí nghiệm thu, tiêu chí và minh chứng hiện có. Máy chủ xác minh phạm vi nguồn và điều kiện tiên quyết; lưu bản nháp không gửi yêu cầu nghiệm thu.",
    workName: "Hạng mục / công việc", drawing: "Bản vẽ dùng để nghiệm thu", selectDrawing: "Chọn bản vẽ", revision: "Lần sửa đổi", location: "Vị trí nghiệm thu", selectLocation: "Chọn vị trí",
    requirements: "Tiêu chí nghiệm thu", evidence: "Minh chứng hiện trường", noRequirementsOrEvidence: "Vị trí này chưa có tiêu chí nghiệm thu hoặc minh chứng. Hãy đăng ký tiêu chí và minh chứng cho vị trí trước khi lập phiếu.",
    fieldChecks: "Xác nhận tại hiện trường", selfComplete: "Đã hoàn tất tự nghiệm thu", drawingCheck: "Đã kiểm tra bản vẽ", materialCheck: "Đã kiểm tra vật liệu", testCheck: "Đã kiểm tra thử nghiệm",
    previousCheck: "Đã kiểm tra công việc trước đó", changeCheck: "Đã kiểm tra thay đổi", holdPoint: "Điểm dừng cần xác nhận trước khi làm công việc tiếp theo",
    loadingSources: "Đang kiểm tra tài liệu có thể dùng cho nghiệm thu…",
    noDrawings: "Hiện không có bản vẽ sử dụng được. Hãy kiểm tra trạng thái phê duyệt kỹ thuật, phân phối và xác nhận nhận tại hiện trường.",
    saveDraft: "Lưu bản nháp tự nghiệm thu", saving: "Đang lưu…", saved: "Đã lưu bản nháp tự nghiệm thu.",
    genericError: "Không thể tải hoặc lưu hồ sơ nghiệm thu. Hãy kiểm tra kết nối rồi thử lại.",
  },
  en: {
    title: "Prepare self inspection",
    description: "Select an available drawing, the actual inspection location, applicable requirements, and evidence. The server validates source scope and prerequisites; saving creates a draft but does not submit the inspection request.",
    workName: "Work item / activity", drawing: "Inspection drawing", selectDrawing: "Select a drawing", revision: "Revision", location: "Inspection location", selectLocation: "Select a location",
    requirements: "Inspection requirements", evidence: "Site evidence", noRequirementsOrEvidence: "There are no inspection requirements or evidence for this location. Register location-specific requirements and evidence before preparing the draft.",
    fieldChecks: "Site prechecks", selfComplete: "Self inspection is complete", drawingCheck: "Drawing checked", materialCheck: "Material checked", testCheck: "Test checked",
    previousCheck: "Previous work checked", changeCheck: "Changes checked", holdPoint: "Hold point requiring confirmation before follow-on work",
    loadingSources: "Checking records available for inspection…",
    noDrawings: "There are no drawings available. Check technical approval and site distribution and receipt status.",
    saveDraft: "Save self inspection draft", saving: "Saving…", saved: "Self inspection draft saved.",
    genericError: "The inspection records request could not be completed. Check the connection and try again.",
  },
};

function localeFor(language: string): Locale {
  const languageCode = language.toLowerCase().split("-")[0];
  return languageCode === "ko" || languageCode === "vi" ? languageCode : "en";
}

function localizedApiError(cause: unknown, genericError: string) {
  return cause instanceof ApiError ? reasonLabel(cause.detail.code) : genericError;
}

const empty: InspectionSources = { drawings: [], requirements: [], evidence: [] };
const precheckLabels = ["drawingCheck", "materialCheck", "testCheck", "previousCheck", "changeCheck"] as const;
const precheckKeys = ["drawing", "material", "test", "previous", "change"] as const;

export function InspectionAuthoringPanel({ client, workspace, online, onCreated }: { client: SupervisionClient; workspace: Workspace; online: boolean; onCreated: (record: RecordDTO) => Promise<void> }) {
  const { i18n } = useTranslation();
  const t = copy[localeFor(i18n.resolvedLanguage ?? i18n.language)];
  const copyRef = useRef(t);
  const [sources, setSources] = useState(empty); const [drawingId, setDrawingId] = useState(""); const [locationId, setLocationId] = useState("");
  const [requirementIds, setRequirementIds] = useState<string[]>([]); const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [workName, setWorkName] = useState(""); const [selfComplete, setSelfComplete] = useState(false); const [hold, setHold] = useState(false);
  const [precheck, setPrecheck] = useState<Record<string, boolean>>({ drawing: false, material: false, test: false, previous: false, change: false });
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [saved, setSaved] = useState("");
  const attempt = useRef<{ body: string; key: string; objectId: string } | null>(null);
  useEffect(() => { copyRef.current = t; }, [t]);
  const drawing = sources.drawings.find(d => d.domainRef.objectId === drawingId);
  const drawingVersion = drawing?.domainRef.version;
  useEffect(() => {
    let ignore = false; setLoading(true); setError(""); setRequirementIds([]); setEvidenceIds([]);
    inspectionSources(client, drawingId && drawingVersion ? { objectType: "InformationItem", objectId: drawingId, version: drawingVersion } : undefined, locationId || undefined).then(value => {
      if (ignore) return;
      setSources(value);
      if (drawingId && !value.drawings.some(d => d.domainRef.objectId === drawingId)) { setDrawingId(""); setLocationId(""); }
    }).catch(cause => { if (!ignore) { setError(localizedApiError(cause, copyRef.current.genericError)); setSources(empty); setDrawingId(""); setLocationId(""); } })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [client, workspace.items, drawingId, drawingVersion, locationId]);
  const toggle = (id: string, ids: string[], setter: (ids: string[]) => void) => setter(ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
  async function save() {
    if (!drawing || !locationId || busy) return;
    setBusy(true); setError(""); setSaved("");
    const input = { drawingRef: drawing.domainRef, locationId, workName, selfInspectionComplete: selfComplete, precheck, holdPoint: hold,
      requirementRefs: sources.requirements.filter(r => requirementIds.includes(r.domainRef.objectId)).map(r => r.domainRef),
      evidenceRefs: sources.evidence.filter(e => evidenceIds.includes(e.domainRef.objectId)).map(e => e.domainRef) };
    const body = JSON.stringify(input);
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID(), objectId: crypto.randomUUID() };
    try {
      const result = await createInspectionDraft(client, { ...input, objectId: attempt.current.objectId }, attempt.current.key);
      setSaved(`${t.saved} ${result.record.id}`); attempt.current = null; setWorkName(""); setSelfComplete(false); setHold(false); setPrecheck({ drawing: false, material: false, test: false, previous: false, change: false });
      await onCreated(result.record);
    } catch (cause) { setError(localizedApiError(cause, t.genericError)); } finally { setBusy(false); }
  }
  return <form aria-label={t.title} className="grid gap-3 p-3" onSubmit={event => { event.preventDefault(); void save(); }}>
    <h3>{t.title}</h3><p>{t.description}</p>
    <label>{t.workName}<input value={workName} maxLength={300} required disabled={busy} onChange={event => setWorkName(event.target.value)} /></label>
    <label>{t.drawing}<select value={drawingId} disabled={loading || busy} onChange={event => { setDrawingId(event.target.value); setLocationId(""); setRequirementIds([]); setEvidenceIds([]); }}><option value="">{t.selectDrawing}</option>{sources.drawings.map(d => <option key={d.domainRef.objectId} value={d.domainRef.objectId}>{d.title} · {t.revision} {d.revision} · v{formatNumber(d.domainRef.version)}</option>)}</select></label>
    <label>{t.location}<select value={locationId} disabled={!drawing || loading || busy} onChange={event => { setLocationId(event.target.value); setRequirementIds([]); setEvidenceIds([]); }}><option value="">{t.selectLocation}</option>{drawing?.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
    <fieldset disabled={loading || busy}><legend>{t.requirements}</legend>{sources.requirements.map(r => <label className="block" key={r.domainRef.objectId}><input type="checkbox" checked={requirementIds.includes(r.domainRef.objectId)} onChange={() => toggle(r.domainRef.objectId, requirementIds, setRequirementIds)} /> {r.title} · v{formatNumber(r.domainRef.version)}</label>)}</fieldset>
    <fieldset disabled={loading || busy}><legend>{t.evidence}</legend>{sources.evidence.map(e => <label className="block" key={e.domainRef.objectId}><input type="checkbox" checked={evidenceIds.includes(e.domainRef.objectId)} onChange={() => toggle(e.domainRef.objectId, evidenceIds, setEvidenceIds)} /> {e.title} · {e.mediaType} · v{formatNumber(e.domainRef.version)}</label>)}</fieldset>
    {locationId && !loading && (!sources.requirements.length || !sources.evidence.length) && <p>{t.noRequirementsOrEvidence}</p>}
    <fieldset disabled={busy}><legend>{t.fieldChecks}</legend><label className="block"><input type="checkbox" checked={selfComplete} onChange={event => setSelfComplete(event.target.checked)} /> {t.selfComplete}</label>{precheckKeys.map((key, index) => <label className="block" key={key}><input type="checkbox" checked={precheck[key]} onChange={event => setPrecheck({ ...precheck, [key]: event.target.checked })} /> {t[precheckLabels[index]]}</label>)}<label className="block"><input type="checkbox" checked={hold} onChange={event => setHold(event.target.checked)} /> {t.holdPoint}</label></fieldset>
    {loading && <p role="status">{t.loadingSources}</p>}{!loading && !sources.drawings.length && <p>{t.noDrawings}</p>}{error && <p role="alert">{error}</p>}{saved && <p role="status">{saved}</p>}
    <button type="submit" className="secondary wide" disabled={!online || busy || loading || !drawing || !locationId || !workName.trim() || !requirementIds.length || !evidenceIds.length}>{busy ? t.saving : t.saveDraft}</button>
  </form>;
}
