import { useMemo, useRef, useState } from "react";
import type { DomainRef, RecordDTO, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import i18n from "../i18n/config";
import { recordReference } from "../data/record-reference";

type Locale = "ko" | "en" | "vi";
type LabelKey =
  | "title" | "description" | "recordTitle" | "target" | "targetEmpty"
  | "report" | "reportEmpty" | "dueAt" | "options" | "optionId"
  | "optionLabel" | "addOption" | "removeOption" | "recommendation"
  | "impact" | "impactScope" | "impactCost" | "impactSchedule"
  | "impactQuality" | "impactSafety" | "save" | "saving" | "cancel"
  | "unavailable" | "offline" | "mock" | "missingTargets" | "missingReports"
  | "required" | "saved" | "error";

type Labels = Record<LabelKey, string>;

export const ownerDecisionAuthoringLabels: Record<Locale, Labels> = {
  ko: {
    title: "발주처 결정 요청 작성",
    description: "현재 접근 가능한 원본을 선택해 결정 패키지를 작성합니다. 보고와 발주처 결정은 별도 명령으로 진행됩니다.",
    recordTitle: "결정 요청 제목", target: "결정 대상 원본", targetEmpty: "대상 원본 선택",
    report: "발행된 보고서", reportEmpty: "보고서 선택", dueAt: "결정 기한",
    options: "검토할 선택지", optionId: "선택지 ID", optionLabel: "선택지 설명",
    addOption: "선택지 추가", removeOption: "선택지 삭제", recommendation: "요청자 권고",
    impact: "영향 평가", impactScope: "범위 영향", impactCost: "비용 영향",
    impactSchedule: "공정 영향", impactQuality: "품질 영향", impactSafety: "안전 영향",
    save: "결정 요청 초안 저장", saving: "저장 중…", cancel: "입력 지우기",
    unavailable: "현재 역할 또는 범위에서 서버가 생성을 허용하지 않았습니다.",
    offline: "연결 후 저장할 수 있습니다.", mock: "미리보기에서는 공식 결정 요청을 만들 수 없습니다.",
    missingTargets: "현재 워크스페이스에 선택할 수 있는 대상 원본이 없습니다.",
    missingReports: "현재 워크스페이스에 연결할 발행 보고서가 없습니다.",
    required: "제목, 대상, 보고서, 기한, 선택지, 권고와 영향 평가를 입력하십시오.",
    saved: "결정 요청 초안을 저장했습니다.", error: "요청을 저장하지 못했습니다. 입력과 서버 선행조건을 확인하십시오.",
  },
  en: {
    title: "Author an Owner decision request",
    description: "Build a decision package from records currently visible in this workspace. Reporting and the Owner decision remain separate commands.",
    recordTitle: "Decision request title", target: "Target record", targetEmpty: "Select a target record",
    report: "Issued report", reportEmpty: "Select an issued report", dueAt: "Decision due date",
    options: "Options for review", optionId: "Option ID", optionLabel: "Option description",
    addOption: "Add option", removeOption: "Remove option", recommendation: "Requester recommendation",
    impact: "Impact assessment", impactScope: "Scope impact", impactCost: "Cost impact",
    impactSchedule: "Schedule impact", impactQuality: "Quality impact", impactSafety: "Safety impact",
    save: "Save decision request draft", saving: "Saving…", cancel: "Clear form",
    unavailable: "The server has not allowed creation for the current role or scope.",
    offline: "Reconnect before saving.", mock: "Official decision requests cannot be created in preview mode.",
    missingTargets: "No selectable target records are available in this workspace.",
    missingReports: "No issued reports are available to link in this workspace.",
    required: "Enter a title, target, report, due date, option, recommendation, and impact assessment.",
    saved: "Decision request draft saved.", error: "The request could not be saved. Check the inputs and server prerequisites.",
  },
  vi: {
    title: "Soạn yêu cầu quyết định của Chủ đầu tư",
    description: "Tạo hồ sơ quyết định từ các bản ghi hiện có trong không gian làm việc. Báo cáo và quyết định của Chủ đầu tư vẫn là các lệnh riêng.",
    recordTitle: "Tiêu đề yêu cầu quyết định", target: "Bản ghi cần quyết định", targetEmpty: "Chọn bản ghi",
    report: "Báo cáo đã phát hành", reportEmpty: "Chọn báo cáo đã phát hành", dueAt: "Hạn quyết định",
    options: "Các phương án xem xét", optionId: "Mã phương án", optionLabel: "Mô tả phương án",
    addOption: "Thêm phương án", removeOption: "Xóa phương án", recommendation: "Đề xuất của người yêu cầu",
    impact: "Đánh giá tác động", impactScope: "Tác động phạm vi", impactCost: "Tác động chi phí",
    impactSchedule: "Tác động tiến độ", impactQuality: "Tác động chất lượng", impactSafety: "Tác động an toàn",
    save: "Lưu bản nháp yêu cầu quyết định", saving: "Đang lưu…", cancel: "Xóa biểu mẫu",
    unavailable: "Máy chủ chưa cho phép tạo trong vai trò hoặc phạm vi hiện tại.",
    offline: "Hãy kết nối lại trước khi lưu.", mock: "Không thể tạo yêu cầu quyết định chính thức trong chế độ xem trước.",
    missingTargets: "Không có bản ghi mục tiêu khả dụng trong không gian làm việc này.",
    missingReports: "Không có báo cáo đã phát hành để liên kết trong không gian làm việc này.",
    required: "Nhập tiêu đề, mục tiêu, báo cáo, hạn, phương án, đề xuất và đánh giá tác động.",
    saved: "Đã lưu bản nháp yêu cầu quyết định.", error: "Không thể lưu yêu cầu. Hãy kiểm tra dữ liệu và điều kiện từ máy chủ.",
  },
};

const scopeFields = ["packageId", "locationId", "discipline", "responsibleOrganizationId"] as const;
const impactFields = [
  ["scope", "impactScope"], ["cost", "impactCost"], ["schedule", "impactSchedule"],
  ["quality", "impactQuality"], ["safety", "impactSafety"],
] as const;

function lang(): Locale {
  const value = (i18n.resolvedLanguage || i18n.language).split("-")[0];
  return value === "en" || value === "vi" ? value : "ko";
}

function refForItem(item: Workspace["items"][number]): DomainRef | null {
  const ref = recordReference(item);
  const record = item.record;
  if (!record.id || !Number.isInteger(record.version) || record.version < 1) return null;
  return ref;
}

function recordLabel(record: RecordDTO, ref: DomainRef) {
  const title = record.title || record.workName || record.subtype || record.description || ref.objectId.slice(0, 8);
  return `${title} · ${ref.objectType} · v${ref.version}`;
}

function optionKey(option: { id: string; label: string }) {
  return `${option.id}:${option.label}`;
}

export interface OwnerDecisionAuthoringPanelProps {
  client: SupervisionClient;
  workspace: Workspace;
  online: boolean;
  onCreated(record: RecordDTO): Promise<void>;
}

export function OwnerDecisionAuthoringPanel({
  client, workspace, online, onCreated,
}: OwnerDecisionAuthoringPanelProps) {
  const text = ownerDecisionAuthoringLabels[lang()];
  const capability = workspace.context.creationCapabilities?.decision;
  const targets = useMemo(() => workspace.items.flatMap((item) => {
    const ref = refForItem(item);
    return ref && item.record.projectId === workspace.context.projectId
      ? [{ ref, record: item.record }]
      : [];
  }), [workspace.items, workspace.context.projectId]);
  const reports = useMemo(() => workspace.items.flatMap((item) => {
    const ref = refForItem(item);
    if (!ref || item.machine !== "report" || ref.objectType !== "InformationItem"
        || item.record.subtype !== "Report"
        || !["issued", "acknowledged", "followup"].includes(item.record.status || "")
        || item.record.projectId !== workspace.context.projectId) return [];
    return [{ ref, record: item.record }];
  }), [workspace.items, workspace.context.projectId]);

  const [title, setTitle] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [reportId, setReportId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [options, setOptions] = useState([{ id: "A", label: "" }]);
  const [recommendation, setRecommendation] = useState("");
  const [impact, setImpact] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const attempt = useRef<{ body: string; objectId: string; key: string } | null>(null);

  const target = targets.find(({ ref }) => `${ref.objectType}:${ref.objectId}:${ref.version}` === targetKey);
  const validOptions = options.filter((option) => option.id.trim() && option.label.trim());
  const uniqueOptionIds = new Set(options.map((option) => option.id.trim().toLocaleLowerCase()));
  const impactPayload = Object.fromEntries(Object.entries(impact).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
  const canSave = online && client.kind === "http" && capability?.canCreate === true
    && !!title.trim() && !!target && !!reports.some((report) => report.record.id === reportId)
    && !!dueAt && validOptions.length === options.length && options.length > 0 && uniqueOptionIds.size === options.length
    && !!recommendation.trim() && Object.keys(impactPayload).length > 0 && !busy;

  function clearForm() {
    setTitle(""); setTargetKey(""); setReportId(""); setDueAt("");
    setOptions([{ id: "A", label: "" }]); setRecommendation(""); setImpact({}); setError(""); setSaved("");
    attempt.current = null;
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || !target) return;
    setBusy(true); setError(""); setSaved("");
    const due = new Date(dueAt);
    if (Number.isNaN(due.getTime())) {
      setError(text.required); setBusy(false); return;
    }
    const payload: Record<string, unknown> = {
      title: title.trim(),
      targetRef: target.ref,
      reportId,
      dueAt: due.toISOString(),
      options: validOptions.map((option) => ({ id: option.id.trim(), label: option.label.trim() })),
      recommendation: recommendation.trim(),
      impact: impactPayload,
      actionIds: [],
    };
    for (const field of scopeFields) {
      const value = target.record[field];
      if (typeof value === "string" && value) payload[field] = value;
    }
    const body = JSON.stringify(payload);
    if (attempt.current?.body !== body) attempt.current = { body, objectId: crypto.randomUUID(), key: crypto.randomUUID() };
    try {
      const result = await client.create("decision", payload, attempt.current.objectId, attempt.current.key);
      setSaved(text.saved);
      attempt.current = null;
      await onCreated(result.record);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.error);
    } finally {
      setBusy(false);
    }
  }

  const disabledReason = !online ? text.offline : client.kind === "mock" ? text.mock
    : !capability?.canCreate ? text.unavailable : !targets.length ? text.missingTargets
      : !reports.length ? text.missingReports : "";

  return <section className="panel grid gap-4 p-4" data-ui-component="owner-decision-authoring">
    <header className="grid gap-1">
      <h2 className="text-lg font-semibold">{text.title}</h2>
      <p className="text-sm text-muted-foreground">{text.description}</p>
    </header>
    {disabledReason && <p className="rounded-sm border border-border bg-muted/40 p-3 text-sm" role="status">{disabledReason}</p>}
    <form className="grid gap-4" onSubmit={(event) => void save(event)}>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium" htmlFor="decision-title">{text.recordTitle}
          <input id="decision-title" className="min-h-10 rounded-sm border border-input bg-background px-3" value={title} maxLength={300} required disabled={busy} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-medium" htmlFor="decision-target">{text.target}
          <select id="decision-target" className="min-h-10 rounded-sm border border-input bg-background px-3" value={targetKey} required disabled={busy || !targets.length} onChange={(event) => setTargetKey(event.target.value)}>
            <option value="">{targets.length ? text.targetEmpty : text.missingTargets}</option>
            {targets.map(({ ref, record }) => <option key={`${ref.objectType}:${ref.objectId}:${ref.version}`} value={`${ref.objectType}:${ref.objectId}:${ref.version}`}>{recordLabel(record, ref)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium" htmlFor="decision-report">{text.report}
          <select id="decision-report" className="min-h-10 rounded-sm border border-input bg-background px-3" value={reportId} required disabled={busy || !reports.length} onChange={(event) => setReportId(event.target.value)}>
            <option value="">{reports.length ? text.reportEmpty : text.missingReports}</option>
            {reports.map(({ ref, record }) => <option key={`${ref.objectId}:${ref.version}`} value={record.id}>{recordLabel(record, ref)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium" htmlFor="decision-due">{text.dueAt}
          <input id="decision-due" type="datetime-local" className="min-h-10 rounded-sm border border-input bg-background px-3" value={dueAt} required disabled={busy} onChange={(event) => setDueAt(event.target.value)} />
        </label>
      </div>

      <fieldset className="grid gap-3 rounded-sm border border-border p-3" disabled={busy}>
        <legend className="px-1 text-sm font-semibold">{text.options}</legend>
        {options.map((option, index) => <div className="grid gap-2 sm:grid-cols-[minmax(7rem,0.35fr)_1fr_auto]" key={`${index}-${optionKey(option)}`}>
          <label className="grid gap-1 text-sm" htmlFor={`decision-option-id-${index}`}>{text.optionId}
            <input id={`decision-option-id-${index}`} className="min-h-10 rounded-sm border border-input bg-background px-3" value={option.id} maxLength={40} required onChange={(event) => setOptions((current) => current.map((item, i) => i === index ? { ...item, id: event.target.value } : item))} />
          </label>
          <label className="grid gap-1 text-sm" htmlFor={`decision-option-label-${index}`}>{text.optionLabel}
            <input id={`decision-option-label-${index}`} className="min-h-10 rounded-sm border border-input bg-background px-3" value={option.label} maxLength={300} required onChange={(event) => setOptions((current) => current.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} />
          </label>
          <button type="button" className="secondary self-end" disabled={options.length <= 1} onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}>{text.removeOption}</button>
        </div>)}
        <button type="button" className="secondary justify-self-start" onClick={() => setOptions((current) => [...current, { id: `OPTION-${current.length + 1}`, label: "" }])}>{text.addOption}</button>
      </fieldset>

      <label className="grid gap-1 text-sm font-medium" htmlFor="decision-recommendation">{text.recommendation}
        <textarea id="decision-recommendation" className="min-h-24 rounded-sm border border-input bg-background p-3" value={recommendation} maxLength={3000} required disabled={busy} onChange={(event) => setRecommendation(event.target.value)} />
      </label>

      <fieldset className="grid gap-3 rounded-sm border border-border p-3" disabled={busy}>
        <legend className="px-1 text-sm font-semibold">{text.impact}</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {impactFields.map(([field, label]) => <label className="grid gap-1 text-sm" htmlFor={`decision-impact-${field}`} key={field}>{text[label]}
            <input id={`decision-impact-${field}`} className="min-h-10 rounded-sm border border-input bg-background px-3" value={impact[field] || ""} maxLength={1000} onChange={(event) => setImpact((current) => ({ ...current, [field]: event.target.value }))} />
          </label>)}
        </div>
      </fieldset>

      {error && <p role="alert" className="text-sm text-destructive">{error || text.error}</p>}
      {saved && <p role="status" className="text-sm">{saved}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="secondary" disabled={busy} onClick={clearForm}>{text.cancel}</button>
        <button type="submit" className="primary" disabled={!canSave}>{busy ? text.saving : text.save}</button>
      </div>
    </form>
  </section>;
}
