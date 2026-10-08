import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DomainRef, RecordDTO, WorkItem, Workspace } from "../../data/ui-contract";
import type { SupervisionClient } from "../../data/supervision-client";
import { listDrawingPdfBindings, listDrawingRevisions, type DrawingPdfBinding, type DrawingRevisionOption } from "../../data/drawing-pdf-binding-client";
import {
  commandDrawingFieldRevision,
  getDrawingFieldHistory,
  listDrawingFieldRevisions,
  registerDrawingFieldRevision,
  type DrawingFieldCommand,
  type DrawingFieldRegistrationInput,
  type DrawingFieldRevision,
} from "../../data/drawing-field-client";
import { ActionButton, Panel, SectionHeader } from "../../ui";
import "./drawing-field-management.css";
import { DrawingImpactPanel } from "./DrawingImpactPanel";
import { formatDateTime } from "../../i18n/format";

const refLabel = (ref: DomainRef | null) => ref ? `${ref.objectType} · ${ref.objectId} · v${ref.version}` : "연결 없음";
const refKey = (ref: DomainRef) => `${ref.objectType}:${ref.objectId}:${ref.version}`;
const sameRef = (left: unknown, right: DomainRef | undefined): left is DomainRef => !!right && !!left
  && typeof left === "object" && (left as DomainRef).objectType === right.objectType
  && (left as DomainRef).objectId === right.objectId && (left as DomainRef).version === right.version;
const title = (record: RecordDTO): string => String(record.title || record.workName || record.name || record.subtype || record.id);
const refFor = (objectType: string, record: RecordDTO): DomainRef => ({ objectType, objectId: record.id, version: record.version });
const reasonLabels: Record<string, string> = {
  APPROVAL_MISSING: "기술 승인을 연결하십시오",
  APPROVAL_STALE: "승인 기록 버전이 바뀌었습니다",
  APPROVAL_NOT_CURRENT_TECHNICAL: "현재 도면을 대상으로 한 승인된 기술 승인이 필요합니다",
  APPROVAL_EXPIRED: "승인 유효기간이 지났습니다",
  APPROVAL_INVALID: "승인 상태를 확인할 수 없습니다",
  SOURCE_STALE: "도면 또는 PDF 원본이 최신 버전이 아닙니다",
  CHANGE_REF_INVALID: "변경 요청 참조를 확인할 수 없습니다",
  CHANGE_STALE: "변경 요청 기록 버전이 바뀌었습니다",
  CHANGE_NOT_APPROVED: "연결된 변경 요청이 승인되지 않았습니다",
  CHANGE_TARGET_MISMATCH: "변경 요청이 이 도면을 대상으로 하지 않습니다",
  CHANGE_APPROVAL_INVALID: "변경 요청의 승인 상태를 확인할 수 없습니다",
  CHANGE_INVALID: "변경 요청 근거를 확인할 수 없습니다",
  DISTRIBUTION_INCOMPLETE: "필수 수령자 전원의 배포와 수령 확인이 필요합니다",
  NOT_FOR_CONSTRUCTION: "시공용 도면으로 등록해야 현장 사용본을 발행할 수 있습니다",
};
const statusLabels: Record<string, string> = {
  registered: "등록됨", released: "배포 승인", superseded: "구본", withdrawn: "철회됨",
};
const commandLabels: Record<string, string> = {
  release: "현장 사용본 발행", distribute: "배포 기록", acknowledge: "수령 확인",
  return_copy: "구본 회수 확인", withdraw: "철회", update_basis: "승인 근거 갱신",
};
const eventLabels: Record<string, string> = { registered: "현장 도면 기록 등록", superseded: "후속 개정본으로 대체", ...commandLabels };
const statusText = (status: string) => statusLabels[status] || status;
const labelCommand = (command: DrawingFieldCommand) => commandLabels[command.command] || command.label || command.command;
const commandName = (command: DrawingFieldCommand) => command.command;
const isEligibleApproval = (item: WorkItem) => item.machine === "approval"
  && (String(item.record.status) === "approved" || String(item.record.status).includes("pending")
    || String(item.record.status) === "technical_review");
interface PendingAction {
  revisionId: string;
  command: string;
  expectedVersion: number;
  payload: Record<string, unknown>;
  key: string;
}

export function DrawingFieldManagementPanel({ client, workspace, onChanged, onOpenSourceRegistration, onSelect, onNavigate }: {
  client: SupervisionClient;
  workspace: Workspace;
  onChanged?: () => void | Promise<void>;
  onOpenSourceRegistration?: () => void;
  onSelect?: (id: string | null) => void;
  onNavigate?: (route: string) => void;
}) {
  const projectId = workspace.project.id;
  const session = client.session;
  const scopeKey = `${session?.projectId ?? ""}:${session?.actor.partyId ?? ""}:${session?.actor.roleAssignmentId ?? ""}:${projectId}:${workspace.role.id}:${workspace.role.actorGroup}:${workspace.demo}`;
  const [bindings, setBindings] = useState<DrawingPdfBinding[]>([]);
  const [drawings, setDrawings] = useState<DrawingRevisionOption[]>([]);
  const [revisions, setRevisions] = useState<DrawingFieldRevision[]>([]);
  const [loaded, setLoaded] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [bindingId, setBindingId] = useState("");
  const [drawingNo, setDrawingNo] = useState("");
  const [revision, setRevision] = useState("");
  const [issuedFor, setIssuedFor] = useState<DrawingFieldRegistrationInput["issuedFor"]>("construction");
  const [approvalKey, setApprovalKey] = useState("");
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [supersedesId, setSupersedesId] = useState("");
  const [changeRefs, setChangeRefs] = useState<DomainRef[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [distributionIds, setDistributionIds] = useState<string[]>([]);
  const [basisSelections, setBasisSelections] = useState<Record<string, { approvalRef: DomainRef | null; changeRefs: DomainRef[] }>>({});
  const [history, setHistory] = useState<Record<string, unknown>[] | null>(null);
  const [historyFor, setHistoryFor] = useState("");
  const [impactSelection, setImpactSelection] = useState<{ scope: string; ref: DomainRef } | null>(null);
  const registrationPending = useRef<{ body: string; key: string } | null>(null);
  const alive = useRef(true);
  const sequence = useRef(0);
  const activeScope = useRef(scopeKey);
  if (activeScope.current !== scopeKey) {
    activeScope.current = scopeKey;
    sequence.current += 1;
  }
  const admin = workspace.demo && workspace.role.actorGroup === "ADM" && workspace.role.roleCode === "project_admin"
    && session?.projectId === projectId && session.actor.actorGroup === "ADM"
    && session.actor.roleAssignmentId === workspace.role.id;
  const approvals = useMemo(() => workspace.items.filter(isEligibleApproval), [workspace.items]);
  const changes = useMemo(() => workspace.items.filter(item => item.machine === "change"
    && String(item.record.subtype || "") === "ChangeRequest"), [workspace.items]);
  const selectedBinding = bindings.find(row => row.id === bindingId);
  const bindingApprovals = useMemo(() => approvals.filter(item => {
    const kind = String(item.record.approvalKind || item.record.subtype || "").toLowerCase();
    return (kind === "technical" || kind.includes("technical")) && sameRef(item.record.targetRef, selectedBinding?.drawingRef);
  }), [approvals, selectedBinding]);
  const sameNumber = revisions.filter(row => row.drawingNo === drawingNo.trim());
  const predecessorOptions = sameNumber.filter(row => row.id !== supersedesId && row.status === "released");

  const refresh = useCallback(async () => {
    const scope = scopeKey;
    const requestSequence = ++sequence.current;
    const current = () => alive.current && activeScope.current === scope && sequence.current === requestSequence;
    if (!session || session.projectId !== projectId) {
      if (current()) { setRevisions([]); setBindings([]); setDrawings([]); setLoaded(scope); }
      return;
    }
    try {
      const [rows, bindingRows, drawingRows] = await Promise.all([
        listDrawingFieldRevisions(client, projectId),
        listDrawingPdfBindings(client, projectId),
        listDrawingRevisions(client, projectId),
      ]);
      if (!current()) return;
      setRevisions(rows);
      setBindings(bindingRows);
      setDrawings(drawingRows);
      setLoaded(scope);
      setBindingId(currentId => bindingRows.some(row => row.id === currentId) ? currentId : "");
      setError("");
    } catch (cause) {
      if (!current()) return;
      setRevisions([]);
      setBindings([]);
      setDrawings([]);
      setLoaded(scope);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [client, projectId, scopeKey]);

  useEffect(() => {
    alive.current = true;
    setBindings([]); setDrawings([]); setRevisions([]); setLoaded("");
    setError(""); setNotice(""); setPending(null); setHistory(null); setHistoryFor("");
    if (!session) setLoaded(scopeKey);
    return () => { alive.current = false; sequence.current += 1; };
  }, [scopeKey, refresh]);

  useEffect(() => { void refresh(); }, [workspace.items, refresh]);

  function toggleRecipient(id: string) {
    setRecipientIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  async function register() {
    setError(""); setNotice("");
    if (!admin) { setError("등록은 프로젝트 관리자 데모 세션에서 할 수 있습니다."); return; }
    if (!selectedBinding || !drawingNo.trim() || !revision.trim() || recipientIds.length < 1) {
      setError("PDF 도면, 도면번호, 개정, 필수 수령자를 지정하십시오."); return;
    }
    const matchingDrawing = drawings.find(item => item.domainRef.objectId === selectedBinding.drawingRef.objectId
      && item.domainRef.version === selectedBinding.drawingRef.version);
    if (!matchingDrawing) { setError("연결된 원본 도면이 프로젝트의 현재 도면 목록에 없습니다."); return; }
    if (sameNumber.some(row => row.revision.toLocaleLowerCase() === revision.trim().toLocaleLowerCase())) {
      setError("같은 도면번호와 개정의 현장 관리 기록이 이미 있습니다."); return;
    }
    const selectedApproval = approvalKey ? bindingApprovals.find(item => item.record.id === approvalKey) : null;
    if (approvalKey && !selectedApproval) { setError("선택한 승인 근거가 변경되었습니다. 현재 승인을 다시 선택하십시오."); return; }
    const input: DrawingFieldRegistrationInput = {
      bindingId: selectedBinding.id,
      drawingNo: drawingNo.trim(),
      revision: revision.trim(),
      issuedFor,
      requiredRecipientPartyIds: [...new Set(recipientIds)],
      approvalRef: selectedApproval ? refFor("Approval", selectedApproval.record) : null,
      changeRefs: [...changeRefs],
      supersedesId: supersedesId || null,
    };
    const serializedInput = JSON.stringify({ projectId, input });
    if (!registrationPending.current || registrationPending.current.body !== serializedInput) {
      registrationPending.current = { body: serializedInput, key: crypto.randomUUID() };
    }
    const pendingRegistration = registrationPending.current;
    if (!pendingRegistration) { setError("등록 요청을 준비하지 못했습니다. 다시 시도하십시오."); return; }
    const idempotencyKey = pendingRegistration.key;
    setBusy(true);
    try {
      const created = await registerDrawingFieldRevision(client, projectId, input, idempotencyKey);
      registrationPending.current = null;
      setNotice(`현장 도면 기록 ${created.id} · v${created.version}을 등록했습니다.`);
      setDrawingNo(""); setRevision(""); setApprovalKey(""); setRecipientIds([]); setSupersedesId(""); setChangeRefs([]);
      await refresh();
      await onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  function prepareAction(row: DrawingFieldRevision, item: DrawingFieldCommand) {
    const command = commandName(item);
    const payload: Record<string, unknown> = {};
    if (command === "distribute") {
      const selected = distributionIds.filter(id => row.requiredRecipientPartyIds.includes(id));
      if (!selected.length) { setError("배포할 수령자를 선택하십시오."); return; }
      payload.recipientPartyIds = selected;
    } else if (command === "return_copy" || command === "withdraw") {
      if (!actionReason.trim()) { setError("처리 사유를 입력하십시오."); return; }
      payload.reason = actionReason.trim();
    } else if (command === "update_basis") {
      const currentChangeRefs = changes.map(candidate => refFor("WorkItem", candidate.record));
      const currentChangeKeys = new Set(currentChangeRefs.map(refKey));
      const selection = basisSelections[row.id] || {
        approvalRef: row.approvalRef,
        changeRefs: row.changeRefs.filter(ref => currentChangeKeys.has(refKey(ref))),
      };
      const currentApproval = selection.approvalRef && approvals.find(candidate =>
        candidate.record.id === selection.approvalRef?.objectId
        && String(candidate.record.approvalKind || candidate.record.subtype || "").toLowerCase().includes("technical")
        && sameRef(candidate.record.targetRef, row.drawingRef));
      if (selection.approvalRef && !currentApproval) {
        setError("이 도면의 현재 기술 승인을 워크스페이스에서 선택하십시오.");
        return;
      }
      if (selection.changeRefs.some(ref => !currentChangeKeys.has(refKey(ref)))) {
        setError("변경 요청 버전이 갱신되었습니다. 현재 변경 요청을 다시 선택하십시오.");
        return;
      }
      payload.approvalRef = currentApproval ? refFor("Approval", currentApproval.record) : null;
      payload.changeRefs = selection.changeRefs;
    }
    setPending({ revisionId: row.id, command, expectedVersion: row.version, payload, key: crypto.randomUUID() });
    setError("");
  }

  async function submitAction() {
    if (!pending) return;
    const command = pending.command;
    setBusy(true); setError(""); setNotice("");
    try {
      const updated = await commandDrawingFieldRevision(client, projectId, pending.revisionId,
        command, pending.expectedVersion, pending.payload, pending.key);
      setNotice(`${commandLabels[command] || command} 요청을 처리했습니다. 현재 상태: ${statusText(updated.status)} · v${updated.version}.`);
      setPending(null); setActionReason(""); setDistributionIds([]);
      await refresh();
      await onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function showHistory(row: DrawingFieldRevision) {
    setHistory(null); setHistoryFor(row.id); setError("");
    try { setHistory(await getDrawingFieldHistory(client, projectId, row.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setHistoryFor(""); }
  }

  const scopeReady = loaded === scopeKey;
  const currentBindings = scopeReady ? bindings : [];
  const currentRevisions = scopeReady ? revisions : [];
  const participants = workspace.participants;
  const selectedRevision = currentRevisions.find(row => row.id === pending?.revisionId);

  return <section className="drawing-field-management" data-testid="drawing-field-management">
    <Panel>
      <SectionHeader title="현장 도면 관리" meta="등록 · 승인 · 배포 · 수령 · 구본 회수" />
      <p className="drawing-field-help">도면번호와 개정은 현장 관리 기록에 직접 입력합니다. 제목에서 번호를 자동 추정하지 않습니다. 이 화면은 승인이나 변경 요청을 생성하거나 승인하지 않습니다.</p>
      {error && <p role="alert" className="drawing-field-error">{error}</p>}
      {notice && <p role="status" className="drawing-field-notice">{notice}</p>}
      {admin && <div className="drawing-field-register" data-testid="drawing-field-register">
        <h3>현장 도면 개정본 등록</h3>
        <label>연결된 PDF 도면
          <select aria-label="연결된 PDF 도면" value={bindingId} onChange={event => setBindingId(event.target.value)}>
            <option value="">도면과 PDF 연결 선택</option>
            {currentBindings.map(binding => <option key={binding.id} value={binding.id}>{binding.drawingRef.objectId} · 도면 v{binding.drawingRef.version} · PDF {binding.evidenceRef.objectId}</option>)}
          </select>
        </label>
        {scopeReady && currentBindings.length === 0 && <div className="drawing-field-muted">
          <p>아직 PDF와 연결된 도면 원본이 없습니다. 먼저 도면 원본을 등록하고 검토 요청을 보내십시오.</p>
          {onOpenSourceRegistration && <ActionButton onClick={onOpenSourceRegistration}>도면 원본 등록으로 이동</ActionButton>}
        </div>}
        <div className="drawing-field-grid">
          <label>도면번호<input aria-label="도면번호" value={drawingNo} maxLength={80} onChange={event => { setDrawingNo(event.target.value); setSupersedesId(""); }} /></label>
          <label>개정<input aria-label="개정" value={revision} maxLength={80} onChange={event => setRevision(event.target.value)} /></label>
          <label>용도<select aria-label="용도" value={issuedFor} onChange={event => setIssuedFor(event.target.value as DrawingFieldRegistrationInput["issuedFor"])}>
            <option value="construction">시공용</option><option value="review">검토용</option><option value="information">참고용</option>
          </select></label>
        </div>
        <label>연결 승인
          <select aria-label="연결 승인" value={approvalKey} onChange={event => setApprovalKey(event.target.value)}>
            <option value="">승인 없이 등록</option>
            {bindingApprovals.map(item => <option key={item.record.id} value={item.record.id}>
              {title(item.record)} · {String(item.record.status) === "approved" ? "승인됨" : "기술 검토 중"} · {item.record.id} · v{item.record.version}
            </option>)}
          </select>
        </label>
        {bindingApprovals.find(item => item.record.id === approvalKey) && <p className="drawing-field-muted">승인 원본 · {refLabel(refFor("Approval", bindingApprovals.find(item => item.record.id === approvalKey)!.record))}. 현장 사용 가능 여부는 서버가 다시 확인합니다.</p>}
        <fieldset><legend>필수 수령자</legend>
          <div className="drawing-field-recipient-list">{participants.map(person =>
            <label key={person.partyId}><input type="checkbox" checked={recipientIds.includes(person.partyId)} onChange={() => toggleRecipient(person.partyId)} />{person.name} · {person.actorGroup} · {person.partyId}</label>
          )}</div>
        </fieldset>
        <fieldset><legend>연결 변경 요청 (선택, 기본 없음)</legend>
          {changes.length === 0 ? <p className="drawing-field-muted">현재 연결할 수 있는 변경 요청이 없습니다.</p> : <div className="drawing-field-recipient-list">
            {changes.map(item => {
              const ref = refFor("WorkItem", item.record);
              const key = refKey(ref);
              return <label key={key}><input type="checkbox" checked={changeRefs.some(selected => refKey(selected) === key)}
                onChange={() => setChangeRefs(current => current.some(selected => refKey(selected) === key)
                  ? current.filter(selected => refKey(selected) !== key) : [...current, ref])} />
                {title(item.record)} · {String(item.record.status || "상태 미확인")} · {refLabel(ref)}
              </label>;
            })}
          </div>}
        </fieldset>
        <label>대체하는 기존 개정본 (선택)
          <select aria-label="대체하는 기존 개정본" value={supersedesId} onChange={event => setSupersedesId(event.target.value)}>
            <option value="">없음</option>
            {predecessorOptions.map(row => <option key={row.id} value={row.id}>{row.drawingNo} · {row.revision} · {statusText(row.status)} · {row.id}</option>)}
          </select>
        </label>
        <p className="drawing-field-muted">변경 요청 {changeRefs.length}건을 현재 원본 버전으로 연결합니다. 후속 수정은 새 현장 도면 기록으로 관리합니다.</p>
        <ActionButton disabled={busy || !scopeReady} onClick={() => void register()}>현장 도면 기록 등록</ActionButton>
        {!admin && <p className="drawing-field-muted">현재 역할에서는 등록할 수 없습니다.</p>}
      </div>}
    </Panel>
    <Panel>
      <SectionHeader title="현장 도면 상태" meta="서버 상태와 실행 가능한 작업" />
      {!scopeReady && <p role="status">현장 도면 기록을 조회하고 있습니다…</p>}
      {scopeReady && currentRevisions.length === 0 && <p className="drawing-field-muted">등록된 현장 도면 기록이 없습니다.</p>}
      <div className="drawing-field-list">
        {currentRevisions.map(row => {
          const binding = currentBindings.find(item => item.id === row.bindingId);
          const rowCommands = row.availableCommands || [];
          const receipts = row.receipts || [];
          const reasons = row.readinessReasons || [];
          const fieldReady = row.currentForConstruction === true;
          const rowApprovals = approvals.filter(item => {
            const kind = String(item.record.approvalKind || item.record.subtype || "").toLowerCase();
            return kind.includes("technical") && sameRef(item.record.targetRef, row.drawingRef);
          });
          const currentChangeRefs = changes.map(candidate => refFor("WorkItem", candidate.record));
          const currentChangeKeys = new Set(currentChangeRefs.map(refKey));
          const currentApproval = row.approvalRef && rowApprovals.find(candidate => candidate.record.id === row.approvalRef?.objectId);
          const selectedBasis = basisSelections[row.id] || {
            approvalRef: currentApproval ? refFor("Approval", currentApproval.record) : null,
            changeRefs: row.changeRefs.filter(ref => currentChangeKeys.has(refKey(ref))),
          };
          return <article className="drawing-field-record" key={row.id} data-testid={`drawing-field-record-${row.id}`}>
            <header><strong>{row.drawingNo} · 개정 {row.revision}</strong><span className={`drawing-field-status ${fieldReady ? "is-current" : ""}`}>{statusText(row.status)}{fieldReady ? " · 현장 사용 중" : ""}</span></header>
            <p>용도 · {row.issuedFor === "construction" ? "시공용" : row.issuedFor === "review" ? "검토용" : "참고용"} · 기록 {row.id} · v{row.version}</p>
            <p>도면 · {refLabel(row.drawingRef)} · PDF · {refLabel(row.evidenceRef)}</p>
            {binding && <p>PDF 연결 · {binding.id} · {binding.fileHash}</p>}
            <p>승인 · {refLabel(row.approvalRef)} · 변경 요청 {row.changeRefs.length}건 · {row.supersedesId ? `대체 ${row.supersedesId}` : "선행 개정 없음"}</p>
            <p>현장 사용 · {fieldReady ? "가능" : "차단됨"} · {row.fieldDistributionComplete ? "모든 필수 수령자가 수령 확인" : "배포/수령 미완료"} · 원본 {row.isCurrentSource === false ? "구버전" : "최신"}</p>
            {!!reasons.length && <ul className="drawing-field-reasons">{reasons.map(reason => <li key={reason}>{reasonLabels[reason] || reason}</li>)}</ul>}
            {typeof row.obsoleteCopiesOutstanding === "number" && row.obsoleteCopiesOutstanding > 0
              ? <p>구본 회수 대기 · {row.obsoleteCopiesOutstanding}부</p>
              : typeof row.obsoleteCopiesOutstanding === "boolean"
                ? <p>구본 회수 · {row.obsoleteCopiesOutstanding ? "회수되지 않은 구본이 있습니다" : "미회수 구본 없음"}</p>
                : Array.isArray(row.obsoleteCopiesOutstanding) && row.obsoleteCopiesOutstanding.length > 0
                  ? <p>구본 회수 대기 · {row.obsoleteCopiesOutstanding.join(", ")}</p> : null}
            <p>필수 수령자 · {row.requiredRecipientPartyIds.map(id => participants.find(person => person.partyId === id)?.name || id).join(", ")}</p>
            <div className="drawing-field-receipts"><strong>배포 및 수령</strong>
              {row.requiredRecipientPartyIds.map(id => {
                const receipt = receipts.find(item => item.recipientPartyId === id);
                return <span key={id}>{receipt?.recipientName || participants.find(person => person.partyId === id)?.name || id} · {!receipt?.deliveredAt ? "미배포" : receipt.receivedAt ? "수령 확인" : "수령 대기"}{receipt?.deliveredAt ? ` · 배포 ${formatDateTime(receipt.deliveredAt)}` : ""}{receipt?.receivedAt ? ` · 수령 ${formatDateTime(receipt.receivedAt)}` : ""}{receipt?.returnedAt ? ` · 구본 회수 ${formatDateTime(receipt.returnedAt)}` : ""}</span>;
              })}
            </div>
            {rowCommands.map(item => {
              const command = commandName(item);
              const allowedRecipients = row.requiredRecipientPartyIds;
              return <div className="drawing-field-action" key={command}>
                {command === "distribute" && <fieldset><legend>배포 대상 선택</legend>{allowedRecipients.map(id => <label key={id}><input type="checkbox" checked={distributionIds.includes(id)} onChange={() => setDistributionIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])} />{participants.find(person => person.partyId === id)?.name || id}</label>)}</fieldset>}
                {(command === "return_copy" || command === "withdraw") && <label>사유<input aria-label={`${commandLabels[command]} 사유`} value={actionReason} onChange={event => setActionReason(event.target.value)} /></label>}
                {command === "update_basis" && <div className="drawing-field-basis">
                  <label>현재 기술 승인
                    <select aria-label={`승인 근거 ${row.drawingNo}`} value={selectedBasis.approvalRef?.objectId || ""}
                      onChange={event => {
                        const candidate = rowApprovals.find(value => value.record.id === event.target.value);
                        const approvalRef = candidate ? refFor("Approval", candidate.record) : null;
                        setBasisSelections(current => ({ ...current, [row.id]: { ...selectedBasis, approvalRef } }));
                      }}>
                      <option value="">승인 근거 없음</option>
                      {rowApprovals.map(candidate => <option key={candidate.record.id} value={candidate.record.id}>
                        {title(candidate.record)} · {String(candidate.record.status) === "approved" ? "승인됨" : "기술 검토 중"} · {candidate.record.id} · v{candidate.record.version}
                      </option>)}
                    </select>
                  </label>
                  <fieldset><legend>현재 변경 요청 근거</legend>{changes.length === 0 ? <span>연결할 변경 요청 없음</span> : changes.map(candidate => {
                    const ref = refFor("WorkItem", candidate.record);
                    const key = refKey(ref);
                    return <label key={key}><input type="checkbox" checked={selectedBasis.changeRefs.some(value => refKey(value) === key)}
                      onChange={() => setBasisSelections(current => ({
                        ...current,
                        [row.id]: {
                          ...selectedBasis,
                          changeRefs: selectedBasis.changeRefs.some(value => refKey(value) === key)
                            ? selectedBasis.changeRefs.filter(value => refKey(value) !== key) : [...selectedBasis.changeRefs, ref],
                        },
                      }))} />
                      {title(candidate.record)} · {String(candidate.record.status || "상태 미확인")} · {refLabel(ref)}
                    </label>;
                  })}</fieldset>
                </div>}
                <ActionButton disabled={busy} onClick={() => prepareAction(row, item)}>{labelCommand(item)}</ActionButton>
              </div>;
            })}
            <ActionButton onClick={() => setImpactSelection({ scope: scopeKey, ref: row.drawingRef })}>영향 업무 보기</ActionButton>
            <button type="button" className="drawing-field-history-button" onClick={() => void showHistory(row)}>변경 이력 보기</button>
            {historyFor === row.id && <div className="drawing-field-history" aria-live="polite">
              {history === null ? <p>이력을 조회하고 있습니다…</p> : history.length ? history.map((entry, index) => {
                const event = String(entry.event || "");
                const actor = participants.find(person => person.partyId === entry.actorPartyId);
                const after = entry.after && typeof entry.after === "object" ? entry.after as Record<string, unknown> : {};
                const occurredAt = typeof entry.occurredAt === "string" ? formatDateTime(entry.occurredAt) : "시간 미확인";
                return <article key={String(entry.id || index)}>
                  <strong>{eventLabels[event] || "도면 관리 변경"}</strong>
                  <time>{occurredAt}</time>
                  <span>처리자 · {actor?.name || String(entry.actorPartyId || "확인할 수 없음")}</span>
                  {typeof after.status === "string" && <span>변경 후 상태 · {statusText(after.status)} · v{String(after.version || "")}</span>}
                  {typeof entry.reason === "string" && entry.reason && <span>사유 · {entry.reason}</span>}
                </article>;
              }) : <p>이력이 없습니다.</p>}
            </div>}
          </article>;
        })}
      </div>
    </Panel>
    {impactSelection?.scope === scopeKey && <DrawingImpactPanel key={JSON.stringify([scopeKey, impactSelection.ref])} client={client} workspace={workspace} drawingRef={impactSelection.ref} onSelect={onSelect} onNavigate={onNavigate} />}
    {pending && <div className="drawing-field-scrim"><section role="dialog" aria-modal="true" aria-labelledby="drawing-field-confirm-title" className="drawing-field-dialog">
      <h2 id="drawing-field-confirm-title">{commandLabels[pending.command] || pending.command} 확인</h2>
      <p>{selectedRevision?.drawingNo} · 개정 {selectedRevision?.revision} · {selectedRevision?.id} · 현재 v{pending.expectedVersion}</p>
      <p>도면 원본 · {selectedRevision ? refLabel(selectedRevision.drawingRef) : ""}</p>
      {pending.command === "release" && <p>서버가 승인, 변경 요청, 도면 최신본 여부와 배포/수령 상태를 확인합니다. 이 확인은 승인을 새로 만들지 않습니다.</p>}
      {pending.command === "distribute" && <p>배포 기록을 남깁니다. 배포만으로 수령 처리되지 않습니다.</p>}
      {pending.command === "acknowledge" && <p>현재 사용자 본인의 수령 확인을 기록합니다.</p>}
      {pending.command === "update_basis" && <p>승인 근거 · {refLabel((pending.payload.approvalRef || null) as DomainRef | null)} · 변경 근거 · {Array.isArray(pending.payload.changeRefs) ? (pending.payload.changeRefs as DomainRef[]).map(refLabel).join(", ") || "없음" : "없음"}</p>}
      {(pending.command === "return_copy" || pending.command === "withdraw") && <p>사유 · {String(pending.payload.reason || "")}</p>}
      {error && <p role="alert" className="drawing-field-error">{error}</p>}
      <div><ActionButton disabled={busy} onClick={() => void submitAction()}>확인하고 요청</ActionButton>
        <ActionButton disabled={busy} onClick={() => setPending(null)}>취소</ActionButton></div>
    </section></div>}
  </section>;
}
