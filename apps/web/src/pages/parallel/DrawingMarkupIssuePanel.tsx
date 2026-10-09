import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DomainRef, RecordDTO, WorkItem, Workspace } from "../../data/ui-contract";
import { ApiError, type SupervisionClient } from "../../data/supervision-client";
import {
  createIssueFromDrawingMarkup,
  getDrawingMarkup,
  type DrawingMarkupIssueInput,
  type DrawingMarkupIssueResult,
  type DrawingMarkupRecord,
} from "../../data/drawing-markup-issue-client";
import { ActionButton, Panel, SectionHeader } from "../../ui";
import { reasonLabel, states } from "../../labels";
import { formatDateTime } from "../../i18n/format";
import "./drawing-markup-issue.css";

type Locale = "ko" | "vi" | "en";
const copy: Record<Locale, Record<string, string>> = {
  ko: {
    title: "도면 주석에서 이슈 등록", meta: "현재 레코드 연결 · 확인 후 생성",
    empty: "PDF 뷰어에서 저장된 주석을 선택하면 연결된 기록을 확인할 수 있습니다.", loading: "선택한 주석을 조회하는 중…",
    deleted: "삭제된 주석 · 원본 이력과 기존 이슈 연결은 보존됩니다.", issueAtVersion: "이슈 생성 당시 주석 v{{linked}} · 현재 주석 v{{current}}",
    markup: "주석", page: "페이지", drawing: "도면", pdfEvidence: "PDF Evidence", linkedAlready: "이 주석에서 이미 이슈가 등록되었습니다.",
    issue: "Issue", action: "시정조치", linkUnavailable: "연결 세부정보를 확인할 수 없습니다.", openIssue: "Issue 열기", viewAction: "시정조치 보기",
    note: "주석은 기술 참조로만 사용합니다. Issue 등록은 기존 실패 원 검측과 확인된 관찰을 선택하고 감리자가 확인한 뒤 서버에 요청합니다.",
    failedInspection: "실패 원 검측", chooseInspection: "원 검측 선택", otherDrawing: "다른 도면", confirmedObservation: "확인된 관찰", chooseObservation: "관찰 선택",
    inspectionDrawing: "검측 Drawing", markupDrawing: "주석 Drawing", noRef: "참조 없음", issueType: "Issue 유형", chooseType: "유형 선택",
    ncr: "부적합(NCR)", punch: "Punch", safety: "안전", issueTitle: "Issue 제목", actionTitle: "시정조치 제목", assignee: "담당자", chooseAssignee: "담당자 선택", due: "기한",
    cannotCreate: "현재 역할에서는 등록할 수 없습니다. 감리자 데모 세션으로 전환하십시오.", reviewRegistration: "이슈 등록 검토",
    created: "Issue와 시정조치가 서버 응답으로 생성되었습니다.", statusUnknown: "상태 미확인", confirmTitle: "Issue 및 시정조치 등록 확인",
    confirmIntro: "현재 선택된 기존 기록을 기준으로 서버에 이슈 패키지 등록을 요청합니다.", requestId: "요청 ID", generating: "생성 중",
    sourceMarkup: "주석", sourceInspection: "실패 원 검측", sourceObservation: "확인된 관찰", responsible: "담당자", dueAt: "기한",
    caution: "서버가 권한과 최신 버전을 다시 검사합니다. 이 화면은 관찰 확인, 재검측, 이슈 종결, 발주처 보고를 자동 진행하지 않습니다.",
    cancel: "취소", submitting: "서버 확인 중…", confirmSubmit: "확인 후 Issue와 조치 등록",
    errUnauthorized: "이 프로젝트의 감리자 데모 세션에서만 이슈 등록을 요청할 수 있습니다.", errExact: "주석과 같은 Drawing 버전의 원 검측을 선택하십시오.",
    errObservation: "선택한 원 검측과 범위가 일치하는 확인된 관찰을 선택하십시오.", errFields: "이슈·시정조치 정보와 담당자, 기한을 모두 입력하십시오.",
    errInput: "필수 정보나 날짜 형식을 확인하십시오.", errStale: "확인 후 원본 선택이나 버전이 바뀌었습니다. 다시 검토하십시오.", errGeneric: "요청을 처리하지 못했습니다. 다시 시도하십시오.",
    resultIssue: "Issue", resultAction: "시정조치", state: "상태", noTime: "미입력",
  },
  vi: {
    title: "Tạo Issue từ chú thích bản vẽ", meta: "Liên kết hồ sơ hiện tại · tạo sau khi xác nhận",
    empty: "Chọn chú thích đã lưu trong trình xem PDF để xem hồ sơ được liên kết.", loading: "Đang tải chú thích đã chọn…",
    deleted: "Chú thích đã xóa · lịch sử nguồn và liên kết Issue hiện có vẫn được giữ.", issueAtVersion: "Chú thích tại lúc tạo Issue v{{linked}} · chú thích hiện tại v{{current}}",
    markup: "Chú thích", page: "Trang", drawing: "Bản vẽ", pdfEvidence: "Evidence PDF", linkedAlready: "Một Issue đã được đăng ký từ chú thích này.",
    issue: "Issue", action: "Hành động khắc phục", linkUnavailable: "Không thể xem chi tiết liên kết.", openIssue: "Mở Issue", viewAction: "Xem hành động khắc phục",
    note: "Chú thích chỉ được dùng làm tham chiếu kỹ thuật. Yêu cầu tạo Issue phải chọn nghiệm thu gốc không đạt và quan sát đã xác nhận; giám sát xác nhận trước khi gửi yêu cầu đến máy chủ.",
    failedInspection: "Nghiệm thu gốc không đạt", chooseInspection: "Chọn nghiệm thu gốc", otherDrawing: "Bản vẽ khác", confirmedObservation: "Quan sát đã xác nhận", chooseObservation: "Chọn quan sát",
    inspectionDrawing: "Bản vẽ nghiệm thu", markupDrawing: "Bản vẽ chú thích", noRef: "Không có tham chiếu", issueType: "Loại Issue", chooseType: "Chọn loại",
    ncr: "Không phù hợp (NCR)", punch: "Punch", safety: "An toàn", issueTitle: "Tiêu đề Issue", actionTitle: "Tiêu đề hành động khắc phục", assignee: "Người phụ trách", chooseAssignee: "Chọn người phụ trách", due: "Hạn hoàn thành",
    cannotCreate: "Vai trò hiện tại không thể đăng ký. Hãy chuyển sang phiên demo của giám sát.", reviewRegistration: "Xem lại yêu cầu tạo Issue",
    created: "Máy chủ đã tạo Issue và hành động khắc phục.", statusUnknown: "Chưa rõ trạng thái", confirmTitle: "Xác nhận đăng ký Issue và hành động khắc phục",
    confirmIntro: "Gửi yêu cầu đăng ký gói Issue lên máy chủ dựa trên các hồ sơ hiện có đã chọn.", requestId: "ID yêu cầu", generating: "Đang tạo",
    sourceMarkup: "Chú thích", sourceInspection: "Nghiệm thu gốc không đạt", sourceObservation: "Quan sát đã xác nhận", responsible: "Người phụ trách", dueAt: "Hạn hoàn thành",
    caution: "Máy chủ sẽ kiểm tra lại quyền và phiên bản mới nhất. Màn hình này không tự xác nhận quan sát, nghiệm thu lại, đóng Issue hoặc phát hành báo cáo Chủ đầu tư.",
    cancel: "Hủy", submitting: "Đang chờ máy chủ…", confirmSubmit: "Xác nhận tạo Issue và hành động",
    errUnauthorized: "Chỉ có thể yêu cầu tạo Issue trong phiên demo giám sát của dự án này.", errExact: "Chọn nghiệm thu gốc có đúng phiên bản Drawing như chú thích.",
    errObservation: "Chọn quan sát đã xác nhận và có phạm vi khớp với nghiệm thu gốc đã chọn.", errFields: "Nhập đầy đủ thông tin Issue, hành động khắc phục, người phụ trách và hạn hoàn thành.",
    errInput: "Kiểm tra thông tin bắt buộc và định dạng ngày.", errStale: "Hồ sơ nguồn được chọn hoặc phiên bản đã thay đổi sau khi xác nhận. Hãy xem lại.", errGeneric: "Không thể xử lý yêu cầu. Hãy thử lại.",
    resultIssue: "Issue", resultAction: "Hành động khắc phục", state: "Trạng thái", noTime: "Chưa nhập",
  },
  en: {
    title: "Create an Issue from a drawing markup", meta: "Link existing records · create after confirmation",
    empty: "Select a saved markup in the PDF viewer to inspect its linked records.", loading: "Loading the selected markup…",
    deleted: "Deleted markup · source history and existing Issue link are preserved.", issueAtVersion: "Markup at Issue creation v{{linked}} · current markup v{{current}}",
    markup: "Markup", page: "Page", drawing: "Drawing", pdfEvidence: "PDF Evidence", linkedAlready: "An Issue has already been registered from this markup.",
    issue: "Issue", action: "Corrective action", linkUnavailable: "Linked details are unavailable.", openIssue: "Open Issue", viewAction: "View corrective action",
    note: "The markup is used only as a technical reference. Issue registration requires an existing failed source inspection and a confirmed observation; a supervisor reviews the selection before the request is sent to the server.",
    failedInspection: "Failed source inspection", chooseInspection: "Select source inspection", otherDrawing: "Different drawing", confirmedObservation: "Confirmed observation", chooseObservation: "Select observation",
    inspectionDrawing: "Inspection Drawing", markupDrawing: "Markup Drawing", noRef: "No reference", issueType: "Issue type", chooseType: "Select type",
    ncr: "Nonconformance (NCR)", punch: "Punch", safety: "Safety", issueTitle: "Issue title", actionTitle: "Corrective action title", assignee: "Responsible party", chooseAssignee: "Select responsible party", due: "Due date",
    cannotCreate: "The current role cannot register an Issue. Switch to a supervisor demo session.", reviewRegistration: "Review Issue registration",
    created: "The server created the Issue and corrective action.", statusUnknown: "Status unavailable", confirmTitle: "Confirm Issue and corrective action registration",
    confirmIntro: "Request an Issue package from the server using the selected existing records.", requestId: "Request ID", generating: "Generating",
    sourceMarkup: "Markup", sourceInspection: "Failed source inspection", sourceObservation: "Confirmed observation", responsible: "Responsible party", dueAt: "Due date",
    caution: "The server rechecks authority and current versions. This view does not confirm observations, perform reinspection, close Issues, or dispatch Owner Reports automatically.",
    cancel: "Cancel", submitting: "Waiting for server…", confirmSubmit: "Confirm and register Issue and action",
    errUnauthorized: "Issue registration can only be requested from this project's supervisor demo session.", errExact: "Select a source inspection with the exact Drawing version referenced by the markup.",
    errObservation: "Select a confirmed observation whose scope matches the selected source inspection.", errFields: "Complete the Issue and corrective action details, responsible party, and due date.",
    errInput: "Check the required information and date format.", errStale: "The selected source record or version changed after confirmation. Review the request again.", errGeneric: "Could not complete the request. Try again.",
    resultIssue: "Issue", resultAction: "Corrective action", state: "Status", noTime: "Not entered",
  },
};

const txValue = (locale: Locale, key: string, values?: Record<string, unknown>) => {
  let text = copy[locale][key] || copy.en[key] || key;
  for (const [name, value] of Object.entries(values || {})) text = text.replaceAll(`{{${name}}}`, String(value));
  return text;
};
const errorToken = (cause: unknown, fallback = "errGeneric") => cause instanceof ApiError ? `reason:${cause.detail.code}` : `error:${fallback}`;
const errorText = (value: string, locale: Locale) => value.startsWith("reason:") ? reasonLabel(value.slice(7)) : txValue(locale, value.startsWith("error:") ? value.slice(6) : "errGeneric");

const refText = (ref: DomainRef, locale: Locale) => `${({ Inspection: "Inspection", Observation: "Observation", Drawing: txValue(locale, "drawing"), Evidence: "Evidence", Issue: "Issue", Action: txValue(locale, "action") } as Record<string, string>)[ref.objectType] || ref.objectType} · ${ref.objectId} · v${ref.version}`;
const titleOf = (record: RecordDTO) => record.title || record.workName || record.subtype || record.id;
const sameRef = (left: DomainRef | undefined, right: DomainRef | undefined) => !!left && !!right
  && left.objectType === right.objectType && left.objectId === right.objectId && left.version === right.version;
const failedRoot = (item: WorkItem) => item.machine === "inspection" && !item.record.relatedIssueId
  && item.record.resultStatus === "fail"
  && (item.record.status === "failed" || item.record.status === "completed");
const scopeMatches = (inspection: RecordDTO, observation: RecordDTO) =>
  ["packageId", "locationId", "discipline", "responsibleOrganizationId"].every(key => inspection[key] === observation[key]);

interface PendingRequest { key: string; body: DrawingMarkupIssueInput }

export function DrawingMarkupIssuePanel({ client, workspace, selectedMarkupId, refreshVersion = 0, onChanged, onSelect, onNavigate }: {
  client: SupervisionClient;
  workspace: Workspace;
  selectedMarkupId: string | null;
  refreshVersion?: number;
  onChanged?: () => void;
  onSelect?: (id: string | null) => void;
  onNavigate?: (route: string) => void;
}) {
  const { i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language).slice(0, 2);
  const locale: Locale = language === "ko" || language === "vi" ? language : "en";
  const tx = (key: string, values?: Record<string, unknown>) => txValue(locale, key, values);
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
      .catch(reason => { if (alive && sequence === requestId.current) setError(errorToken(reason)); })
      .finally(() => { if (alive && sequence === requestId.current) setLoading(false); });
    return () => { alive = false; requestId.current += 1; };
  }, [client, selectedMarkupId, workspace.project.id, roleKey, workspace.items, refreshVersion]);

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
    && !!markup && !markup.issueLink && !markup.deletedAt;
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
    if (!canCreate) { setError("error:errUnauthorized"); return; }
    if (!exactInspection) { setError("error:errExact"); return; }
    if (!validObservation) { setError("error:errObservation"); return; }
    if (!subtype.trim() || !issueTitle.trim() || !actionTitle.trim() || !responsiblePartyId || !dueAt) { setError("error:errFields"); return; }
    const body = buildInput();
    if (!body) { setError("error:errInput"); return; }
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
      setConfirmationError("error:errStale"); return;
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
      if (sequence === requestId.current) setConfirmationError(errorToken(reason));
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
      <SectionHeader title={tx("title")} meta={tx("meta")} />
      {!selectedMarkupId && <p className="drawing-markup-issue-empty">{tx("empty")}</p>}
      {loading && <p role="status">{tx("loading")}</p>}
      {error && <div role="alert" className="drawing-markup-issue-error">{errorText(error, locale)}</div>}
      {markup && <>
        <article className="drawing-markup-issue-markup">
          <strong>{markup.text}</strong>
          {markup.deletedAt && <span>{tx("deleted")}</span>}
          {markup.issueLink && markup.issueLink.markupVersion !== markup.version && <span>{tx("issueAtVersion", { linked: markup.issueLink.markupVersion, current: markup.version })}</span>}
          <span>{tx("markup")} {markup.id} · v{markup.version} · {tx("page")} {markup.page}</span>
          <span>{tx("drawing")} {refText(markup.drawingRef, locale)}</span>
          <span>{tx("pdfEvidence")} {refText(markup.evidenceRef, locale)}</span>
        </article>
        {linkedIssue && <div className="drawing-markup-issue-linked" role="status">
          <strong>{tx("linkedAlready")}</strong>
          <span>{tx("issue")} · {issueRef ? refText(issueRef, locale) : tx("linkUnavailable")}</span>
          <span>{tx("action")} · {actionRef ? refText(actionRef, locale) : tx("linkUnavailable")}</span>
          {issueRef && onNavigate && <ActionButton onClick={() => { onNavigate("issues"); onSelect?.(issueRef.objectId); }}>{tx("openIssue")}</ActionButton>}
          {actionRef && onNavigate && <ActionButton onClick={() => { onNavigate("actions"); onSelect?.(actionRef.objectId); }}>{tx("viewAction")}</ActionButton>}
        </div>}
        {!linkedIssue && <>
          <p className="drawing-markup-issue-note">{tx("note")}</p>
          <label>{tx("failedInspection")}
            <select aria-label={locale === "ko" ? "실패 원 검측" : tx("failedInspection")} value={inspectionId} onChange={event => { setInspectionId(event.target.value); setObservationId(""); invalidatePending(); }}>
              <option value="">{tx("chooseInspection")}</option>
              {inspections.map(item => {
                const exact = sameRef(item.record.drawingRef, markup.drawingRef);
                return <option key={item.record.id} value={item.record.id} disabled={!exact}>{titleOf(item.record)} · {item.record.id} · v{item.record.version}{exact ? "" : ` · ${tx("otherDrawing")}`}</option>;
              })}
            </select>
          </label>
          <label>{tx("confirmedObservation")}
            <select aria-label={locale === "ko" ? "확인된 관찰" : tx("confirmedObservation")} value={observationId} onChange={event => { setObservationId(event.target.value); invalidatePending(); }} disabled={!selectedInspection}>
              <option value="">{tx("chooseObservation")}</option>{observations.map(item => <option key={item.record.id} value={item.record.id}>{titleOf(item.record)} · {item.record.id} · v{item.record.version}</option>)}
            </select>
          </label>
          {selectedInspection && <p className="drawing-markup-issue-exact">{tx("inspectionDrawing")} {selectedInspection.record.drawingRef ? refText(selectedInspection.record.drawingRef, locale) : tx("noRef")} · {tx("markupDrawing")} {refText(markup.drawingRef, locale)}</p>}
          <div className="drawing-markup-issue-fields">
            <label>{tx("issueType")}<select aria-label={locale === "ko" ? "Issue 유형" : tx("issueType")} value={subtype} onChange={event => { setSubtype(event.target.value); invalidatePending(); }}><option value="">{tx("chooseType")}</option><option value="NCR">{tx("ncr")}</option><option value="Punch">{tx("punch")}</option><option value="Safety">{tx("safety")}</option></select></label>
            <label>{tx("issueTitle")}<input aria-label={locale === "ko" ? "Issue 제목" : tx("issueTitle")} value={issueTitle} onChange={event => { setIssueTitle(event.target.value); invalidatePending(); }} maxLength={240} /></label>
            <label>{tx("actionTitle")}<input aria-label={locale === "ko" ? "시정조치 제목" : tx("actionTitle")} value={actionTitle} onChange={event => { setActionTitle(event.target.value); invalidatePending(); }} maxLength={240} /></label>
            <label>{tx("assignee")}<select aria-label={locale === "ko" ? "담당자" : tx("assignee")} value={responsiblePartyId} onChange={event => { setResponsiblePartyId(event.target.value); invalidatePending(); }}><option value="">{tx("chooseAssignee")}</option>{workspace.participants.filter(person => person.actorGroup === "CON").map(person => <option key={person.partyId} value={person.partyId}>{person.name} · {person.partyId}</option>)}</select></label>
            <label>{tx("due")}<input aria-label={locale === "ko" ? "기한" : tx("due")} type="datetime-local" value={dueAt} onChange={event => { setDueAt(event.target.value); invalidatePending(); }} /></label>
          </div>
          {!canCreate && <p className="drawing-markup-issue-note">{tx("cannotCreate")}</p>}
          <ActionButton disabled={!canCreate || !!result} onClick={beginConfirmation}>{tx("reviewRegistration")}</ActionButton>
        </>}
      </>}
      {resultIssue && resultAction && <div className="drawing-markup-issue-result" role="status">
        <strong>{tx("created")}</strong>
        <span>{tx("resultIssue")} · {titleOf(resultIssue)} · {resultIssue.id} · v{resultIssue.version} · {resultIssue.status ? states[resultIssue.status] || resultIssue.status : tx("statusUnknown")}</span>
        <span>{tx("resultAction")} · {titleOf(resultAction)} · {resultAction.id} · v{resultAction.version} · {resultAction.status ? states[resultAction.status] || resultAction.status : tx("statusUnknown")}</span>
        {onNavigate && <><ActionButton onClick={() => { onNavigate("issues"); onSelect?.(resultIssue.id); }}>{tx("openIssue")}</ActionButton><ActionButton onClick={() => { onNavigate("actions"); onSelect?.(resultAction.id); }}>{tx("viewAction")}</ActionButton></>}
      </div>}
      {confirming && <div className="drawing-markup-issue-scrim"><section role="dialog" aria-modal="true" aria-labelledby="drawing-markup-issue-confirm-title" className="drawing-markup-issue-dialog">
        <h3 id="drawing-markup-issue-confirm-title">{tx("confirmTitle")}</h3>
        <p>{tx("confirmIntro")}</p>
        <p>{tx("requestId")} · {pending.current?.key || tx("generating")}</p>
        {markup && <p>{tx("sourceMarkup")} · {markup.id} v{markup.version} / {refText(markup.drawingRef, locale)}</p>}
        {selectedInspection && <p>{tx("sourceInspection")} · {titleOf(selectedInspection.record)} / {selectedInspection.record.id} v{selectedInspection.record.version}</p>}
        {selectedObservation && <p>{tx("sourceObservation")} · {titleOf(selectedObservation.record)} / {selectedObservation.record.id} v{selectedObservation.record.version}</p>}
        <p>{tx("issue")} · {subtype} · {issueTitle.trim()}</p><p>{tx("action")} · {actionTitle.trim()}</p>
        <p>{tx("responsible")} · {workspace.participants.find(person => person.partyId === responsiblePartyId)?.name || responsiblePartyId}</p>
        <p>{tx("dueAt")} · {dueAt ? formatDateTime(new Date(dueAt)) : tx("noTime")}</p>
        <p className="drawing-markup-issue-caution">{tx("caution")}</p>
        {confirmationError && <div role="alert" className="drawing-markup-issue-error">{errorText(confirmationError, locale)}</div>}
        <div className="drawing-markup-issue-actions"><ActionButton disabled={submitting} onClick={() => setConfirming(false)}>{tx("cancel")}</ActionButton><ActionButton disabled={submitting} onClick={() => void submit()}>{submitting ? tx("submitting") : tx("confirmSubmit")}</ActionButton></div>
      </section></div>}
    </Panel>
  </section>;
}
