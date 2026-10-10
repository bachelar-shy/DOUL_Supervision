import { useRef, useState, type FormEvent } from "react";
import type { Workspace } from "../../data/ui-contract";
import { ApiError, type SupervisionClient } from "../../data/supervision-client";
import { reasonLabel } from "../../labels";
import {
  createCaseOwnerReport,
  requestCaseReinspection,
  type InspectionCase,
  type OwnerReportDraftInput,
} from "../../data/inspection-case-flow-client";

type IssueGroup = InspectionCase["issues"][number];
type IdempotencyKey = ReturnType<typeof crypto.randomUUID>;
type LabelKey =
  | "reinspectionTitle" | "reinspectionHelp" | "workName" | "requestedAt" | "selfComplete"
  | "prechecks" | "drawing" | "material" | "test" | "previous" | "change" | "evidence"
  | "noEvidence" | "submitReinspection" | "reportTitle" | "reportHelp" | "title" | "revision"
  | "type" | "regular" | "urgent" | "priority" | "select" | "recipient" | "facts" | "cause"
  | "impact" | "immediateActions" | "recommendation" | "dueAt" | "receiptDueAt"
  | "createDraft" | "saving" | "saved" | "reinspectionSaved" | "blocked";

const copy: Record<"en" | "ko" | "vi", Record<LabelKey, string>> = {
  en: {
    reinspectionTitle: "Request linked reinspection",
    reinspectionHelp: "This creates a reinspection request linked to this Issue. The server checks the current correction and inspection gates.",
    workName: "Work name",
    requestedAt: "Requested inspection time",
    selfComplete: "Contractor self inspection is complete",
    prechecks: "Pre inspection checks",
    drawing: "Drawing checked",
    material: "Material checked",
    test: "Test checked",
    previous: "Previous work checked",
    change: "Changes checked",
    evidence: "Readable evidence",
    noEvidence: "No readable evidence is available in this workspace.",
    submitReinspection: "Submit reinspection request",
    reportTitle: "Create linked Owner Report draft",
    reportHelp: "Creates a draft linked to this Issue. It does not submit, dispatch, or confirm receipt.",
    title: "Report title",
    revision: "Revision",
    type: "Report type",
    regular: "Regular",
    urgent: "Urgent",
    priority: "Priority",
    select: "Select",
    recipient: "Owner recipients",
    facts: "Facts",
    cause: "Cause (optional)",
    impact: "Impact",
    immediateActions: "Immediate actions (optional)",
    recommendation: "Recommendation",
    dueAt: "Response due time",
    receiptDueAt: "Receipt confirmation due time",
    createDraft: "Create draft",
    saving: "Saving…",
    saved: "Draft created",
    reinspectionSaved: "Reinspection request created",
    blocked: "This form is available only when the server authorizes it for this Issue and project.",
  },
  ko: {
    reinspectionTitle: "연결된 재검측 요청",
    reinspectionHelp: "이 지적사항에 연결된 재검측 요청을 생성합니다. 현재 시정 및 검측 요건은 업무 시스템이 확인합니다.",
    workName: "작업명",
    requestedAt: "재검측 요청 일시",
    selfComplete: "시공자 자체검측 완료",
    prechecks: "검측 전 확인",
    drawing: "도면 확인",
    material: "자재 확인",
    test: "시험 확인",
    previous: "선행 작업 확인",
    change: "변경사항 확인",
    evidence: "열람 가능한 증빙",
    noEvidence: "현재 업무 화면에 열람 가능한 증빙이 없습니다.",
    submitReinspection: "재검측 요청 제출",
    reportTitle: "연결된 발주자 보고 초안 작성",
    reportHelp: "이 지적사항에 연결된 초안을 작성합니다. 제출, 발송 또는 수령 확인은 진행하지 않습니다.",
    title: "보고서 제목",
    revision: "개정",
    type: "보고 유형",
    regular: "일반",
    urgent: "긴급",
    priority: "우선순위",
    select: "선택",
    recipient: "발주자 수신자",
    facts: "사실관계",
    cause: "원인 (선택)",
    impact: "영향",
    immediateActions: "즉시 조치 (선택)",
    recommendation: "권고사항",
    dueAt: "회신 기한",
    receiptDueAt: "수령 확인 기한",
    createDraft: "초안 작성",
    saving: "저장 중…",
    saved: "초안을 작성했습니다",
    reinspectionSaved: "재검측 요청을 작성했습니다",
    blocked: "업무 시스템이 이 지적사항과 현장에 대해 허용한 경우에만 사용할 수 있습니다.",
  },
  vi: {
    reinspectionTitle: "Yêu cầu nghiệm thu lại có liên kết",
    reinspectionHelp: "Tạo yêu cầu nghiệm thu lại liên kết với Issue này. Máy chủ kiểm tra các điều kiện sửa chữa và nghiệm thu hiện tại.",
    workName: "Tên công việc",
    requestedAt: "Thời gian yêu cầu nghiệm thu",
    selfComplete: "Nhà thầu đã tự kiểm tra",
    prechecks: "Kiểm tra trước nghiệm thu",
    drawing: "Đã kiểm tra bản vẽ",
    material: "Đã kiểm tra vật liệu",
    test: "Đã kiểm tra thử nghiệm",
    previous: "Đã kiểm tra công việc trước đó",
    change: "Đã kiểm tra thay đổi",
    evidence: "Bằng chứng có thể đọc",
    noEvidence: "Không có bằng chứng có thể đọc trong không gian làm việc này.",
    submitReinspection: "Gửi yêu cầu nghiệm thu lại",
    reportTitle: "Tạo bản nháp Báo cáo Chủ đầu tư có liên kết",
    reportHelp: "Tạo bản nháp liên kết với Issue này. Không gửi, phát hành hoặc xác nhận đã nhận.",
    title: "Tiêu đề báo cáo",
    revision: "Lần sửa đổi",
    type: "Loại báo cáo",
    regular: "Thông thường",
    urgent: "Khẩn cấp",
    priority: "Mức ưu tiên",
    select: "Chọn",
    recipient: "Người nhận phía Chủ đầu tư",
    facts: "Sự kiện",
    cause: "Nguyên nhân (không bắt buộc)",
    impact: "Ảnh hưởng",
    immediateActions: "Hành động tức thời (không bắt buộc)",
    recommendation: "Đề xuất",
    dueAt: "Hạn phản hồi",
    receiptDueAt: "Hạn xác nhận đã nhận",
    createDraft: "Tạo bản nháp",
    saving: "Đang lưu…",
    saved: "Đã tạo bản nháp",
    reinspectionSaved: "Đã tạo yêu cầu nghiệm thu lại",
    blocked: "Chỉ khả dụng khi máy chủ cho phép cho Issue và dự án này.",
  },
};

const precheckLabels = ["drawing", "material", "test", "previous", "change"] as const;
const titleOfEvidence = (title: unknown, id: string) => typeof title === "string" && title.trim() ? title : id;

function dateInputToIso(value: string): string {
  return value ? new Date(value).toISOString() : "";
}

export function InspectionCaseAuthoringPanel({
  client,
  workspace,
  inspectionId,
  group,
  online,
  onChanged,
}: {
  client: SupervisionClient;
  workspace: Workspace;
  inspectionId: string;
  group: IssueGroup;
  online: boolean;
  onChanged: () => Promise<void>;
}) {
  const locale = typeof document !== "undefined" ? document.documentElement.lang.slice(0, 2) : "en";
  const t = copy[locale === "ko" || locale === "vi" ? locale : "en"];
  const issue = group.issue;
  const reinspectionAction = issue.actions.find(action => action.command === "request_reinspection");
  const canRequestReinspection = client.kind === "http" && online && Boolean(reinspectionAction?.authority && (reinspectionAction.ready || reinspectionAction.requiresInput));
  const reportCapability = workspace.context.creationCapabilities?.report;
  const canCreateReport = client.kind === "http" && online && reportCapability?.canCreate === true && group.readiness.ownerReportDraftReady;
  const evidence = (() => {
    const byId = new Map<string, { id: string; label: string }>();
    for (const entry of workspace.context.referenceCatalog?.evidence ?? []) {
      byId.set(entry.ref.objectId, { id: entry.ref.objectId, label: titleOfEvidence(entry.record.title, entry.ref.objectId) });
    }
    for (const item of workspace.items) {
      if (item.machine === "evidence" && !byId.has(item.record.id)) {
        byId.set(item.record.id, { id: item.record.id, label: titleOfEvidence(item.record.title, item.record.id) });
      }
    }
    return [...byId.values()];
  })();
  const owners = workspace.participants.filter(person => person.actorGroup === "OWN");

  const [workName, setWorkName] = useState("");
  const [requestedAt, setRequestedAt] = useState("");
  const [selfComplete, setSelfComplete] = useState(false);
  const [precheck, setPrecheck] = useState({ drawing: false, material: false, test: false, previous: false, change: false });
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [reportTitle, setReportTitle] = useState("");
  const [revision, setRevision] = useState("");
  const [reportType, setReportType] = useState<"" | "regular" | "urgent">("");
  const [priority, setPriority] = useState<"" | "P1" | "P2" | "P3" | "P4">("");
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [facts, setFacts] = useState("");
  const [cause, setCause] = useState("");
  const [impact, setImpact] = useState("");
  const [immediateActions, setImmediateActions] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [receiptDueAt, setReceiptDueAt] = useState("");
  const [busy, setBusy] = useState<"reinspection" | "report" | "">("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [reinspectionCreated, setReinspectionCreated] = useState(false);
  const [reportCreated, setReportCreated] = useState(false);
  const reinspectionAttempt = useRef<{ body: string; key: IdempotencyKey; objectId: string } | null>(null);
  const reportAttempt = useRef<{ body: string; key: IdempotencyKey; objectId: string } | null>(null);

  function toggle(id: string, selected: string[], setSelected: (ids: string[]) => void) {
    setSelected(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id]);
  }

  async function submitReinspection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRequestReinspection || busy || !selfComplete) return;
    setBusy("reinspection"); setError(""); setSaved("");
    const input = {
      workName: workName.trim(),
      requestedInspectionAt: dateInputToIso(requestedAt),
      selfInspectionComplete: true as const,
      precheck,
      evidenceIds: [...evidenceIds],
    };
    const body = JSON.stringify(input);
    if (reinspectionAttempt.current?.body !== body) reinspectionAttempt.current = { body, key: crypto.randomUUID(), objectId: crypto.randomUUID() };
    const attempt = reinspectionAttempt.current;
    try {
      await requestCaseReinspection(client, inspectionId, issue.record.id, { ...input, reinspectionObjectId: attempt.objectId }, attempt.key);
      reinspectionAttempt.current = null;
      setReinspectionCreated(true);
      setSaved(t.reinspectionSaved);
    } catch (causeValue) {
      setError(reasonLabel(causeValue instanceof ApiError ? causeValue.detail.code : undefined));
      setBusy("");
      return;
    }
    setBusy("");
    try { await onChanged(); }
    catch (causeValue) { setError(reasonLabel(causeValue instanceof ApiError ? causeValue.detail.code : undefined)); }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreateReport || busy || !reportType || !priority || !recipientIds.length) return;
    setBusy("report"); setError(""); setSaved("");
    const input: Omit<OwnerReportDraftInput, "reportObjectId"> = {
      title: reportTitle.trim(),
      revision: revision.trim(),
      type: reportType,
      priority,
      recipientIds: [...recipientIds],
      facts: facts.trim(),
      ...(cause.trim() ? { cause: cause.trim() } : {}),
      impact: { summary: impact.trim() },
      ...(immediateActions.trim() ? { immediateActions: immediateActions.trim() } : {}),
      recommendation: recommendation.trim(),
      dueAt: dateInputToIso(dueAt),
      receiptDueAt: dateInputToIso(receiptDueAt),
    };
    const body = JSON.stringify(input);
    if (reportAttempt.current?.body !== body) reportAttempt.current = { body, key: crypto.randomUUID(), objectId: crypto.randomUUID() };
    const attempt = reportAttempt.current;
    try {
      await createCaseOwnerReport(client, inspectionId, issue.record.id, { ...input, reportObjectId: attempt.objectId }, attempt.key);
      reportAttempt.current = null;
      setReportCreated(true);
      setSaved(t.saved);
    } catch (causeValue) {
      setError(reasonLabel(causeValue instanceof ApiError ? causeValue.detail.code : undefined));
      setBusy("");
      return;
    }
    setBusy("");
    try { await onChanged(); }
    catch (causeValue) { setError(reasonLabel(causeValue instanceof ApiError ? causeValue.detail.code : undefined)); }
  }

  const textInput = "w-full rounded-md border bg-background px-3 py-2 text-sm";
  const field = "grid gap-1 text-sm";
  return <section className="grid gap-4" aria-label={`${t.reinspectionTitle} · ${t.reportTitle}`}>
    <form className="grid gap-3 rounded-lg border p-4" aria-label={t.reinspectionTitle} onSubmit={event => void submitReinspection(event)}>
      <div><h3 className="font-semibold">{t.reinspectionTitle}</h3><p className="text-sm text-muted-foreground">{t.reinspectionHelp}</p></div>
      <label className={field}>{t.workName}<input className={textInput} required maxLength={300} value={workName} onChange={event => setWorkName(event.target.value)} /></label>
      <label className={field}>{t.requestedAt}<input className={textInput} type="datetime-local" required value={requestedAt} onChange={event => setRequestedAt(event.target.value)} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" required checked={selfComplete} onChange={event => setSelfComplete(event.target.checked)} />{t.selfComplete}</label>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t.prechecks}</legend>
        {precheckLabels.map(key => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={precheck[key]} onChange={event => setPrecheck(current => ({ ...current, [key]: event.target.checked }))} />{t[key]}</label>)}
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t.evidence}</legend>
        {evidence.map(item => <label key={item.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={evidenceIds.includes(item.id)} onChange={() => toggle(item.id, evidenceIds, setEvidenceIds)} />{item.label} · {item.id}</label>)}
        {!evidence.length && <p className="text-sm text-muted-foreground">{t.noEvidence}</p>}
      </fieldset>
      {!canRequestReinspection && <p className="text-sm text-muted-foreground">{t.blocked}</p>}
      <button type="submit" className="rounded-md border px-3 py-2 text-sm" disabled={reinspectionCreated || !canRequestReinspection || busy !== "" || !workName.trim() || !requestedAt || !selfComplete || !evidenceIds.length}>{busy === "reinspection" ? t.saving : reinspectionCreated ? t.reinspectionSaved : t.submitReinspection}</button>
    </form>

    <form className="grid gap-3 rounded-lg border p-4" aria-label={t.reportTitle} onSubmit={event => void submitReport(event)}>
      <div><h3 className="font-semibold">{t.reportTitle}</h3><p className="text-sm text-muted-foreground">{t.reportHelp}</p></div>
      <label className={field}>{t.title}<input className={textInput} required maxLength={300} value={reportTitle} onChange={event => setReportTitle(event.target.value)} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>{t.revision}<input className={textInput} required value={revision} onChange={event => setRevision(event.target.value)} /></label>
        <label className={field}>{t.type}<select className={textInput} required value={reportType} onChange={event => setReportType(event.target.value as typeof reportType)}><option value="">{t.select}</option><option value="regular">{t.regular}</option><option value="urgent">{t.urgent}</option></select></label>
        <label className={field}>{t.priority}<select className={textInput} required value={priority} onChange={event => setPriority(event.target.value as typeof priority)}><option value="">{t.select}</option>{(["P1", "P2", "P3", "P4"] as const).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t.recipient}</legend>
        {owners.map(person => <label key={person.partyId} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={recipientIds.includes(person.partyId)} onChange={() => toggle(person.partyId, recipientIds, setRecipientIds)} />{person.name} · {person.partyId}</label>)}
        {!owners.length && <p className="text-sm text-muted-foreground">{t.blocked}</p>}
      </fieldset>
      <label className={field}>{t.facts}<textarea className={textInput} required rows={3} value={facts} onChange={event => setFacts(event.target.value)} /></label>
      <label className={field}>{t.cause}<textarea className={textInput} rows={2} value={cause} onChange={event => setCause(event.target.value)} /></label>
      <label className={field}>{t.impact}<textarea className={textInput} required rows={3} value={impact} onChange={event => setImpact(event.target.value)} /></label>
      <label className={field}>{t.immediateActions}<textarea className={textInput} rows={2} value={immediateActions} onChange={event => setImmediateActions(event.target.value)} /></label>
      <label className={field}>{t.recommendation}<textarea className={textInput} required rows={3} value={recommendation} onChange={event => setRecommendation(event.target.value)} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>{t.dueAt}<input className={textInput} type="datetime-local" required value={dueAt} onChange={event => setDueAt(event.target.value)} /></label>
        <label className={field}>{t.receiptDueAt}<input className={textInput} type="datetime-local" required value={receiptDueAt} onChange={event => setReceiptDueAt(event.target.value)} /></label>
      </div>
      {!canCreateReport && <p className="text-sm text-muted-foreground">{t.blocked}</p>}
      <button type="submit" className="rounded-md border px-3 py-2 text-sm" disabled={reportCreated || !canCreateReport || busy !== "" || !reportTitle.trim() || !revision.trim() || !reportType || !priority || !recipientIds.length || !facts.trim() || !impact.trim() || !recommendation.trim() || !dueAt || !receiptDueAt}>{busy === "report" ? t.saving : reportCreated ? t.saved : t.createDraft}</button>
    </form>
    {saved && <p role="status" className="text-sm">{saved}</p>}
    {error && <p role="alert" className="text-sm">{error}</p>}
  </section>;
}

export default InspectionCaseAuthoringPanel;
