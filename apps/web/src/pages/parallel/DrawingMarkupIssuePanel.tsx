import { useEffect, useMemo, useRef, useState } from "react";
import type { DomainRef, RecordDTO, WorkItem, Workspace } from "../../data/ui-contract";
import type { SupervisionClient } from "../../data/supervision-client";
import {
  createIssueFromDrawingMarkup,
  getDrawingMarkup,
  type DrawingMarkupIssueInput,
  type DrawingMarkupIssueResult,
  type DrawingMarkupRecord,
} from "../../data/drawing-markup-issue-client";
import { ActionButton, Panel, SectionHeader } from "../../ui";
import "./drawing-markup-issue.css";

const refText = (ref: DomainRef) => `${ref.objectType} · ${ref.objectId} · v${ref.version}`;
const titleOf = (record: RecordDTO) => record.title || record.workName || record.subtype || record.id;
const sameRef = (left: DomainRef | undefined, right: DomainRef | undefined) => !!left && !!right
  && left.objectType === right.objectType && left.objectId === right.objectId && left.version === right.version;
const failedRoot = (item: WorkItem) => item.machine === "inspection" && !item.record.relatedIssueId
  && item.record.resultStatus === "fail"
  && (item.record.status === "failed" || item.record.status === "completed");
const scopeMatches = (inspection: RecordDTO, observation: RecordDTO) =>
  ["packageId", "locationId", "discipline", "responsibleOrganizationId"].every(key => inspection[key] === observation[key]);

interface PendingRequest { key: string; body: DrawingMarkupIssueInput }

export function DrawingMarkupIssuePanel({ client, workspace, selectedMarkupId, onChanged, onSelect, onNavigate }: {
  client: SupervisionClient;
  workspace: Workspace;
  selectedMarkupId: string | null;
  onChanged?: () => void;
  onSelect?: (id: string | null) => void;
  onNavigate?: (route: string) => void;
}) {
  const roleKey = `${workspace.project.id}:${workspace.role.id}:${workspace.role.actorGroup}`;
  const [markup, setMarkup] = useState<DrawingMarkupRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inspectionId, setInspectionId] = useState("");
  const [observationId, setObservationId] = useState("");
  const [subtype, setSubtype] = useState("");
  const [issueTitle, setIssueTitle] = useState("");
  const [actionTitle, setActionTitle] = useState("");
  const [responsiblePartyId, setResponsiblePartyId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DrawingMarkupIssueResult | null>(null);
  const [confirmationError, setConfirmationError] = useState("");
  const requestId = useRef(0);
  const pending = useRef<PendingRequest | null>(null);

  useEffect(() => {
    const sequence = ++requestId.current;
    pending.current = null;
    setMarkup(null); setResult(null); setError(""); setConfirmationError(""); setConfirming(false); setSubmitting(false);
    setInspectionId(""); setObservationId(""); setSubtype(""); setIssueTitle(""); setActionTitle("");
    setResponsiblePartyId(""); setDueAt("");
    if (!selectedMarkupId) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    getDrawingMarkup(client, workspace.project.id, selectedMarkupId)
      .then(value => { if (alive && sequence === requestId.current) setMarkup(value); })
      .catch(reason => { if (alive && sequence === requestId.current) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (alive && sequence === requestId.current) setLoading(false); });
    return () => { alive = false; requestId.current += 1; };
  }, [client, selectedMarkupId, workspace.project.id, roleKey]);

  const inspections = useMemo(() => workspace.items.filter(failedRoot), [workspace.items]);
  const selectedInspection = inspections.find(item => item.record.id === inspectionId);
  const observations = useMemo(() => workspace.items.filter(item => item.machine === "observation"
    && item.record.status === "confirmed"
    && (!selectedInspection || scopeMatches(selectedInspection.record, item.record))), [workspace.items, selectedInspection]);
  const selectedObservation = observations.find(item => item.record.id === observationId);
  const canCreate = workspace.demo && workspace.role.actorGroup === "SUP"
    && client.session?.actor.actorGroup === "SUP"
    && client.session?.projectId === workspace.project.id
    && client.session?.actor.roleAssignmentId === workspace.role.id
    && !!markup && !markup.issueLink;
  const exactInspection = !!markup && !!selectedInspection && sameRef(selectedInspection.record.drawingRef, markup.drawingRef);
  const validObservation = !!selectedObservation && !!selectedInspection && scopeMatches(selectedInspection.record, selectedObservation.record);

  function invalidatePending() { pending.current = null; }
  function buildInput(): DrawingMarkupIssueInput | null {
    if (!markup || !selectedInspection || !selectedObservation || !client.session || !exactInspection || !validObservation) return null;
    const dueDate = new Date(dueAt);
    if (!Number.isFinite(dueDate.getTime())) return null;
    return {
      roleAssignmentId: client.session.actor.roleAssignmentId,
      expectedMarkupVersion: markup.version,
      inspectionRef: { objectType: "Inspection", objectId: selectedInspection.record.id, version: selectedInspection.record.version },
      observationRefs: [{ objectType: "Observation", objectId: selectedObservation.record.id, version: selectedObservation.record.version }],
      issueObjectId: crypto.randomUUID(),
      actionObjectId: crypto.randomUUID(),
      subtype: subtype.trim(),
      title: issueTitle.trim(),
      actionTitle: actionTitle.trim(),
      responsiblePartyId,
      dueAt: dueDate.toISOString(),
    };
  }

  function beginConfirmation() {
    setError(""); setConfirmationError("");
    if (!canCreate) { setError("이 프로젝트의 감리자 데모 세션에서만 이슈 등록을 요청할 수 있습니다."); return; }
    if (!exactInspection) { setError("주석과 같은 Drawing 버전의 원 검측을 선택하십시오."); return; }
    if (!validObservation) { setError("선택한 원 검측과 범위가 일치하는 확인된 관찰을 선택하십시오."); return; }
    if (!subtype.trim() || !issueTitle.trim() || !actionTitle.trim() || !responsiblePartyId || !dueAt) { setError("이슈·시정조치 정보와 담당자, 기한을 모두 입력하십시오."); return; }
    const body = buildInput();
    if (!body) { setError("필수 정보나 날짜 형식을 확인하십시오."); return; }
    pending.current = { key: crypto.randomUUID(), body };
    setConfirming(true);
  }

  async function submit() {
    if (!markup || !selectedMarkupId || !pending.current) return;
    const currentBody = buildInput();
    if (!currentBody || !selectedInspection || !selectedObservation
      || currentBody.expectedMarkupVersion !== pending.current.body.expectedMarkupVersion
      || currentBody.inspectionRef.objectId !== pending.current.body.inspectionRef.objectId
      || currentBody.inspectionRef.version !== pending.current.body.inspectionRef.version
      || currentBody.observationRefs[0]?.objectId !== pending.current.body.observationRefs[0]?.objectId
      || currentBody.observationRefs[0]?.version !== pending.current.body.observationRefs[0]?.version) {
      setConfirmationError("확인 후 원본 선택이나 버전이 바뀌었습니다. 다시 검토하십시오."); return;
    }
    const attempt = pending.current;
    const sequence = requestId.current;
    setSubmitting(true); setConfirmationError("");
    try {
      const created = await createIssueFromDrawingMarkup(client, workspace.project.id, selectedMarkupId, attempt.body, attempt.key);
      if (sequence !== requestId.current) return;
      onChanged?.();
      setResult(created); setConfirming(false); pending.current = null;
    } catch (reason) {
      if (sequence === requestId.current) setConfirmationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (sequence === requestId.current) setSubmitting(false);
    }
  }

  const resultIssue = result?.issue;
  const resultAction = result?.correctiveAction;
  const linkedIssue = markup?.issueLink;
  const issueRef = linkedIssue?.issueRef;
  const actionRef = linkedIssue?.actionRef;

  return <section className="drawing-markup-issue" data-ui-component="drawing-markup-issue" data-testid="drawing-markup-issue">
    <Panel>
      <SectionHeader title="도면 주석에서 이슈 등록" meta="현재 레코드 연결 · 확인 후 생성" />
      {!selectedMarkupId && <p className="drawing-markup-issue-empty">PDF 뷰어에서 저장된 주석을 선택하면 연결된 기록을 확인할 수 있습니다.</p>}
      {loading && <p role="status">선택한 주석을 조회하는 중…</p>}
      {error && <div role="alert" className="drawing-markup-issue-error">{error}</div>}
      {markup && <>
        <article className="drawing-markup-issue-markup">
          <strong>{markup.text}</strong>
          <span>주석 {markup.id} · v{markup.version} · 페이지 {markup.page}</span>
          <span>도면 {refText(markup.drawingRef)}</span>
          <span>PDF Evidence {refText(markup.evidenceRef)}</span>
        </article>
        {linkedIssue && <div className="drawing-markup-issue-linked" role="status">
          <strong>이 주석에서 이미 이슈가 등록되었습니다.</strong>
          <span>Issue · {issueRef ? refText(issueRef) : "연결 세부정보를 확인할 수 없습니다."}</span>
          <span>시정조치 · {actionRef ? refText(actionRef) : "연결 세부정보를 확인할 수 없습니다."}</span>
          {issueRef && onNavigate && <ActionButton onClick={() => { onNavigate("issues"); onSelect?.(issueRef.objectId); }}>Issue 열기</ActionButton>}
          {actionRef && onNavigate && <ActionButton onClick={() => { onNavigate("actions"); onSelect?.(actionRef.objectId); }}>시정조치 보기</ActionButton>}
        </div>}
        {!linkedIssue && <>
          <p className="drawing-markup-issue-note">주석은 기술 참조로만 사용합니다. Issue 등록은 기존 실패 원 검측과 확인된 관찰을 선택하고 SUP가 확인한 뒤 서버에 요청합니다.</p>
          <label>실패 원 검측
            <select aria-label="실패 원 검측" value={inspectionId} onChange={event => { setInspectionId(event.target.value); setObservationId(""); invalidatePending(); }}>
              <option value="">원 검측 선택</option>
              {inspections.map(item => {
                const exact = sameRef(item.record.drawingRef, markup.drawingRef);
                return <option key={item.record.id} value={item.record.id} disabled={!exact}>{titleOf(item.record)} · {item.record.id} · v{item.record.version}{exact ? "" : " · 다른 도면"}</option>;
              })}
            </select>
          </label>
          <label>확인된 관찰
            <select aria-label="확인된 관찰" value={observationId} onChange={event => { setObservationId(event.target.value); invalidatePending(); }} disabled={!selectedInspection}>
              <option value="">관찰 선택</option>{observations.map(item => <option key={item.record.id} value={item.record.id}>{titleOf(item.record)} · {item.record.id} · v{item.record.version}</option>)}
            </select>
          </label>
          {selectedInspection && <p className="drawing-markup-issue-exact">검측 Drawing {selectedInspection.record.drawingRef ? refText(selectedInspection.record.drawingRef) : "참조 없음"} · 주석 Drawing {refText(markup.drawingRef)}</p>}
          <div className="drawing-markup-issue-fields">
            <label>Issue 유형<select aria-label="Issue 유형" value={subtype} onChange={event => { setSubtype(event.target.value); invalidatePending(); }}><option value="">유형 선택</option><option value="NCR">부적합(NCR)</option><option value="Punch">Punch</option><option value="Safety">안전</option></select></label>
            <label>Issue 제목<input aria-label="Issue 제목" value={issueTitle} onChange={event => { setIssueTitle(event.target.value); invalidatePending(); }} maxLength={240} /></label>
            <label>시정조치 제목<input aria-label="시정조치 제목" value={actionTitle} onChange={event => { setActionTitle(event.target.value); invalidatePending(); }} maxLength={240} /></label>
            <label>담당자<select aria-label="담당자" value={responsiblePartyId} onChange={event => { setResponsiblePartyId(event.target.value); invalidatePending(); }}><option value="">담당자 선택</option>{workspace.participants.filter(person => person.actorGroup === "CON").map(person => <option key={person.partyId} value={person.partyId}>{person.name} · {person.partyId}</option>)}</select></label>
            <label>기한<input aria-label="기한" type="datetime-local" value={dueAt} onChange={event => { setDueAt(event.target.value); invalidatePending(); }} /></label>
          </div>
          {!canCreate && <p className="drawing-markup-issue-note">현재 역할에서는 등록할 수 없습니다. 감리자 데모 세션으로 전환하십시오.</p>}
          <ActionButton disabled={!canCreate || !!result} onClick={beginConfirmation}>이슈 등록 검토</ActionButton>
        </>}
      </>}
      {resultIssue && resultAction && <div className="drawing-markup-issue-result" role="status">
        <strong>Issue와 시정조치가 서버 응답으로 생성되었습니다.</strong>
        <span>Issue · {titleOf(resultIssue)} · {resultIssue.id} · v{resultIssue.version} · {resultIssue.status || "상태 미확인"}</span>
        <span>시정조치 · {titleOf(resultAction)} · {resultAction.id} · v{resultAction.version} · {resultAction.status || "상태 미확인"}</span>
        {onNavigate && <><ActionButton onClick={() => { onNavigate("issues"); onSelect?.(resultIssue.id); }}>Issue 열기</ActionButton><ActionButton onClick={() => { onNavigate("actions"); onSelect?.(resultAction.id); }}>시정조치 보기</ActionButton></>}
      </div>}
      {confirming && <div className="drawing-markup-issue-scrim"><section role="dialog" aria-modal="true" aria-labelledby="drawing-markup-issue-confirm-title" className="drawing-markup-issue-dialog">
        <h3 id="drawing-markup-issue-confirm-title">Issue 및 시정조치 등록 확인</h3>
        <p>현재 선택된 기존 기록을 기준으로 서버에 이슈 패키지 등록을 요청합니다.</p>
        <p>요청 ID · {pending.current?.key || "생성 중"}</p>
        {markup && <p>주석 · {markup.id} v{markup.version} / Drawing {refText(markup.drawingRef)}</p>}
        {selectedInspection && <p>실패 원 검측 · {titleOf(selectedInspection.record)} / {selectedInspection.record.id} v{selectedInspection.record.version}</p>}
        {selectedObservation && <p>확인된 관찰 · {titleOf(selectedObservation.record)} / {selectedObservation.record.id} v{selectedObservation.record.version}</p>}
        <p>Issue · {subtype} · {issueTitle.trim()}</p><p>시정조치 · {actionTitle.trim()}</p>
        <p>담당자 · {workspace.participants.find(person => person.partyId === responsiblePartyId)?.name || responsiblePartyId}</p>
        <p>기한 · {dueAt ? new Date(dueAt).toLocaleString() : "미입력"}</p>
        <p className="drawing-markup-issue-caution">서버가 권한과 최신 버전을 다시 검사합니다. 이 화면은 관찰 확인, 재검측, 이슈 종결, 발주처 보고를 자동 진행하지 않습니다.</p>
        {confirmationError && <div role="alert" className="drawing-markup-issue-error">{confirmationError}</div>}
        <div className="drawing-markup-issue-actions"><ActionButton disabled={submitting} onClick={() => setConfirming(false)}>취소</ActionButton><ActionButton disabled={submitting} onClick={() => void submit()}>{submitting ? "서버 확인 중…" : "확인 후 Issue와 조치 등록"}</ActionButton></div>
      </section></div>}
    </Panel>
  </section>;
}
