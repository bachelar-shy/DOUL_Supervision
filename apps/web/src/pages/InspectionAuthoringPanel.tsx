import { useEffect, useRef, useState } from "react";
import type { SupervisionClient } from "../data/supervision-client";
import type { RecordDTO, Workspace } from "../data/ui-contract";
import { createInspectionDraft, inspectionSources } from "../data/inspection-authoring-client";
import type { InspectionSources } from "../data/inspection-authoring-client";
const checks = { drawing: "도면 확인", material: "자재 확인", test: "시험 확인", previous: "선행 공정 확인", change: "변경사항 확인" };
const empty: InspectionSources = { drawings: [], requirements: [], evidence: [] };
export function InspectionAuthoringPanel({ client, workspace, online, onCreated }: { client: SupervisionClient; workspace: Workspace; online: boolean; onCreated: (record: RecordDTO) => Promise<void> }) {
  const [sources, setSources] = useState(empty); const [drawingId, setDrawingId] = useState(""); const [locationId, setLocationId] = useState("");
  const [requirementIds, setRequirementIds] = useState<string[]>([]); const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [workName, setWorkName] = useState(""); const [selfComplete, setSelfComplete] = useState(false); const [hold, setHold] = useState(false);
  const [precheck, setPrecheck] = useState<Record<string, boolean>>({ drawing: false, material: false, test: false, previous: false, change: false });
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [saved, setSaved] = useState("");
  const attempt = useRef<{ body: string; key: string; objectId: string } | null>(null);
  const drawing = sources.drawings.find(d => d.domainRef.objectId === drawingId);
  const drawingVersion = drawing?.domainRef.version;
  useEffect(() => {
    let ignore = false; setLoading(true); setError(""); setRequirementIds([]); setEvidenceIds([]);
    inspectionSources(client, drawingId && drawingVersion ? { objectType: "InformationItem", objectId: drawingId, version: drawingVersion } : undefined, locationId || undefined).then(value => {
      if (ignore) return;
      setSources(value);
      if (drawingId && !value.drawings.some(d => d.domainRef.objectId === drawingId)) { setDrawingId(""); setLocationId(""); }
    }).catch(cause => { if (!ignore) { setError(String(cause)); setSources(empty); setDrawingId(""); setLocationId(""); } })
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
      setSaved(`자체검측 초안을 저장했습니다. ${result.record.id}`); attempt.current = null; setWorkName(""); setSelfComplete(false); setHold(false); setPrecheck({ drawing: false, material: false, test: false, previous: false, change: false });
      await onCreated(result.record);
    } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }
  return <form aria-label="자체검측 작성" className="grid gap-3 p-3" onSubmit={event => { event.preventDefault(); void save(); }}>
    <h3>자체검측 작성</h3><p>사용 가능한 도면과 실제 검측 위치·기준·증빙을 선택합니다. 저장 후 검측 요청은 별도로 제출합니다.</p>
    <label>공종·작업명<input value={workName} maxLength={300} required disabled={busy} onChange={event => setWorkName(event.target.value)} /></label>
    <label>검측 기준 도면<select value={drawingId} disabled={loading || busy} onChange={event => { setDrawingId(event.target.value); setLocationId(""); setRequirementIds([]); setEvidenceIds([]); }}><option value="">도면 선택</option>{sources.drawings.map(d => <option key={d.domainRef.objectId} value={d.domainRef.objectId}>{d.title} · 개정 {d.revision} · v{d.domainRef.version}</option>)}</select></label>
    <label>검측 위치<select value={locationId} disabled={!drawing || loading || busy} onChange={event => { setLocationId(event.target.value); setRequirementIds([]); setEvidenceIds([]); }}><option value="">위치 선택</option>{drawing?.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
    <fieldset disabled={loading || busy}><legend>검측 기준</legend>{sources.requirements.map(r => <label className="block" key={r.domainRef.objectId}><input type="checkbox" checked={requirementIds.includes(r.domainRef.objectId)} onChange={() => toggle(r.domainRef.objectId, requirementIds, setRequirementIds)} /> {r.title} · v{r.domainRef.version}</label>)}</fieldset>
    <fieldset disabled={loading || busy}><legend>현장 증빙</legend>{sources.evidence.map(e => <label className="block" key={e.domainRef.objectId}><input type="checkbox" checked={evidenceIds.includes(e.domainRef.objectId)} onChange={() => toggle(e.domainRef.objectId, evidenceIds, setEvidenceIds)} /> {e.title} · {e.mediaType} · v{e.domainRef.version}</label>)}</fieldset>
    {locationId && !loading && (!sources.requirements.length || !sources.evidence.length) && <p>이 위치의 검측 기준 또는 증빙이 없습니다. 해당 위치의 기준·증빙을 등록한 후 작성하십시오.</p>}
    <fieldset disabled={busy}><legend>현장 확인</legend><label className="block"><input type="checkbox" checked={selfComplete} onChange={event => setSelfComplete(event.target.checked)} /> 자체검측 완료</label>{Object.entries(checks).map(([key, label]) => <label className="block" key={key}><input type="checkbox" checked={precheck[key]} onChange={event => setPrecheck({ ...precheck, [key]: event.target.checked })} /> {label}</label>)}<label className="block"><input type="checkbox" checked={hold} onChange={event => setHold(event.target.checked)} /> 다음 공정 전 확인이 필요한 중지점</label></fieldset>
    {loading && <p role="status">검측에 사용할 수 있는 자료를 확인하는 중…</p>}{!loading && !sources.drawings.length && <p>현재 사용할 수 있는 도면이 없습니다. 기술 승인과 현장 배포·수령 상태를 확인하십시오.</p>}{error && <p role="alert">{error}</p>}{saved && <p role="status">{saved}</p>}
    <button type="submit" className="secondary wide" disabled={!online || busy || loading || !drawing || !locationId || !workName.trim() || !requirementIds.length || !evidenceIds.length}>{busy ? "저장 중…" : "자체검측 초안 저장"}</button>
  </form>;
}
