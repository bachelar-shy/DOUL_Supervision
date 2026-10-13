import { recordVersionLabel, recordTypeLabel } from "../labels";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeLanguage } from "@doul/localization";
import type { CreationCapability, DomainRef, RecordDTO, Workspace } from "../data/ui-contract";
import { ApiError, type SupervisionClient } from "../data/supervision-client";
import { reasonLabel, creationCapabilityLabel } from "../labels";
import { ActionButton } from "../ui";

export type SafetyAuthoringMachine = "safety_permit" | "safety_stop_order" | "safety_equipment_inspection";
type Locale = "ko" | "vi" | "en";

interface Copy {
  title: string; description: string; scope: string; project: string; package: string; location: string; discipline: string; organization: string; qualificationRank: string;
  recordTitle: string; reason: string; dueAt: string; requirements: string; noRequirements: string; evidence: string; noEvidence: string; equipment: string; noEquipment: string;
  permit: string; stop: string; equipmentInspection: string; permitNo: string; workType: string; riskLevel: string;
  stopOrderNo: string; stopScopeType: string; stopScopeDescription: string; stopReason: string; hazardDescription: string; observedAt: string; effectiveAt: string; affectedPermits: string; noPermits: string;
  inspectionNo: string; inspectionKind: string; scheduledAt: string;
  createDraft: string; saving: string; created: string; failed: string; unavailable: string; offline: string; preview: string; capability: string; required: string; scopeNote: string; draftOnly: string;
}

const copy: Record<Locale, Copy> = {
  ko: {
    title: "안전 기록 초안 작성", description: "현재 업무 시스템이 제공한 작업 범위와 열람 가능한 참조로 안전 기록 초안을 작성합니다. 초안 저장은 제출·승인·작업 허가 또는 작업중지 발행을 수행하지 않습니다.",
    scope: "업무 시스템 작업 범위", project: "현장", package: "공사 구분", location: "위치", discipline: "분야", organization: "담당 조직", qualificationRank: "최소 자격 등급",
    recordTitle: "기록 제목", reason: "기록 사유", dueAt: "기한", requirements: "적용 요건", noRequirements: "현재 열람 가능한 활성 요건이 없습니다.", evidence: "증빙", noEvidence: "현재 열람 가능한 증빙이 없습니다.", equipment: "장비", noEquipment: "현재 열람 가능한 Equipment 자산이 없습니다.",
    permit: "작업허가 초안", stop: "작업중지 초안", equipmentInspection: "장비 안전검사 초안", permitNo: "허가 번호", workType: "작업 유형", riskLevel: "위험 수준",
    stopOrderNo: "작업중지 번호", stopScopeType: "중지 범위 유형", stopScopeDescription: "중지 범위 설명", stopReason: "작업중지 사유", hazardDescription: "위험 설명", observedAt: "발견 시각", effectiveAt: "시행 시각", affectedPermits: "영향 작업허가", noPermits: "현재 열람 가능한 작업허가 초안이 없습니다.",
    inspectionNo: "검사 번호", inspectionKind: "검사 유형", scheduledAt: "검사 예정 시각",
    createDraft: "안전 초안 저장", saving: "저장 중…", created: "안전 기록 초안을 저장했습니다.", failed: "안전 기록 초안을 저장하지 못했습니다. 입력과 업무 시스템 선행조건을 확인하십시오.", unavailable: "업무 시스템이 현재 역할과 범위에서 이 기록의 작성을 허용하지 않았습니다.", offline: "연결 후 안전 초안을 저장할 수 있습니다.", preview: "미리보기에서는 업무 시스템 안전 기록을 만들 수 없습니다.", capability: "작성 가능 여부는 현재 업무 시스템 권한과 현장 범위에 따라 결정됩니다.", required: "필수 항목을 입력하고 필요한 참조를 선택하십시오.", scopeNote: "초안은 현재 업무 시스템 작업 범위에 기록됩니다.", draftOnly: "초안만 저장합니다. 안전 검토, 허가 승인, 작업 개시, 위험 판단, 작업중지 업무 처리를 자동으로 수행하지 않습니다.",
  },
  vi: {
    title: "Tạo bản nháp hồ sơ an toàn", description: "Tạo bản nháp an toàn bằng phạm vi do máy chủ cung cấp và các tham chiếu mà bạn có quyền xem. Lưu bản nháp không gửi, phê duyệt, cấp phép làm việc hoặc ban hành lệnh dừng.",
    scope: "Phạm vi công việc từ máy chủ", project: "Dự án", package: "Gói công việc", location: "Vị trí", discipline: "Chuyên ngành", organization: "Tổ chức phụ trách", qualificationRank: "Cấp bậc chuyên môn tối thiểu",
    recordTitle: "Tiêu đề hồ sơ", reason: "Lý do ghi nhận", dueAt: "Hạn xử lý", requirements: "Yêu cầu áp dụng", noRequirements: "Không có yêu cầu đang hiệu lực nào có thể xem.", evidence: "Bằng chứng", noEvidence: "Không có bằng chứng nào có thể xem.", equipment: "Thiết bị", noEquipment: "Không có tài sản Equipment nào có thể xem.",
    permit: "Bản nháp giấy phép làm việc", stop: "Bản nháp lệnh dừng công việc", equipmentInspection: "Bản nháp kiểm tra thiết bị an toàn", permitNo: "Số giấy phép", workType: "Loại công việc", riskLevel: "Mức rủi ro",
    stopOrderNo: "Số lệnh dừng", stopScopeType: "Loại phạm vi dừng", stopScopeDescription: "Mô tả phạm vi dừng", stopReason: "Lý do dừng công việc", hazardDescription: "Mô tả nguy cơ", observedAt: "Thời điểm phát hiện", effectiveAt: "Thời điểm có hiệu lực", affectedPermits: "Giấy phép công việc bị ảnh hưởng", noPermits: "Không có bản nháp giấy phép nào có thể xem.",
    inspectionNo: "Số lần kiểm tra", inspectionKind: "Loại kiểm tra", scheduledAt: "Thời gian kiểm tra dự kiến",
    createDraft: "Lưu bản nháp an toàn", saving: "Đang lưu…", created: "Đã lưu bản nháp hồ sơ an toàn.", failed: "Không thể lưu bản nháp hồ sơ an toàn. Hãy kiểm tra dữ liệu và điều kiện từ máy chủ.", unavailable: "Máy chủ chưa cho phép tạo hồ sơ này trong vai trò và phạm vi hiện tại.", offline: "Hãy kết nối lại để lưu bản nháp an toàn.", preview: "Không thể tạo hồ sơ an toàn trên máy chủ trong chế độ xem trước.", capability: "Máy chủ quyết định quyền tạo theo vai trò và phạm vi dự án hiện tại.", required: "Nhập các mục bắt buộc và chọn các tham chiếu cần thiết.", scopeNote: "Bản nháp được ghi vào phạm vi công việc hiện tại do máy chủ cung cấp.", draftOnly: "Chỉ lưu bản nháp. Không tự động rà soát an toàn, phê duyệt giấy phép, cho phép bắt đầu công việc, đánh giá nguy cơ hoặc ban hành lệnh dừng.",
  },
  en: {
    title: "Create a Safety draft", description: "Create a safety record draft using the server-provided work scope and references readable to you. Saving a draft does not submit, approve, authorize work, or issue a stop order.",
    scope: "Server work scope", project: "Project", package: "Package", location: "Location", discipline: "Discipline", organization: "Responsible organization", qualificationRank: "Minimum qualification rank",
    recordTitle: "Record title", reason: "Record reason", dueAt: "Due date", requirements: "Applicable requirements", noRequirements: "No active readable requirements are available.", evidence: "Evidence", noEvidence: "No readable evidence is available.", equipment: "Equipment", noEquipment: "No readable Equipment assets are available.",
    permit: "Work permit draft", stop: "Stop order draft", equipmentInspection: "Safety equipment inspection draft", permitNo: "Permit number", workType: "Work type", riskLevel: "Risk level",
    stopOrderNo: "Stop order number", stopScopeType: "Stop scope type", stopScopeDescription: "Stop scope description", stopReason: "Reason for stop", hazardDescription: "Hazard description", observedAt: "Observed at", effectiveAt: "Effective at", affectedPermits: "Affected work permits", noPermits: "No readable work permit drafts are available.",
    inspectionNo: "Inspection number", inspectionKind: "Inspection type", scheduledAt: "Scheduled inspection time",
    createDraft: "Save Safety draft", saving: "Saving…", created: "Safety record draft saved.", failed: "Could not save the Safety draft. Check the inputs and server prerequisites.", unavailable: "The server has not allowed this record to be created for the current role and scope.", offline: "Reconnect before saving a Safety draft.", preview: "Safety records cannot be created on the server in preview mode.", capability: "The server determines creation access from the current role and project scope.", required: "Enter the required fields and select the necessary references.", scopeNote: "The draft will be recorded in the current server-provided work scope.", draftOnly: "This only saves a draft. It does not start safety review, approve a permit, authorize work, decide a hazard, or issue a stop order.",
  },
};

/** Use the existing translated draft title in a list-first disclosure. */
export function safetyAuthoringTitle(language: string): string {
  const code = language.split("-")[0];
  const locale: Locale = code === "vi" || code === "en" ? code : "ko";
  return copy[locale].title;
}

function displayRecord(record: RecordDTO, ref: DomainRef) {
  const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata : {};
  const title = typeof record.title === "string" ? record.title
    : typeof record.name === "string" ? record.name
      : typeof metadata.name === "string" ? metadata.name : ref.objectId;
  return `${title} · ${recordTypeLabel(ref.objectType)} · ${recordVersionLabel(ref.version)}`;
}

function validRef(ref: DomainRef | undefined, objectType: string): ref is DomainRef {
  return !!ref && ref.objectType === objectType && typeof ref.objectId === "string"
    && Number.isInteger(ref.version) && ref.version > 0;
}

function isoDate(value: string): string {
  return new Date(value).toISOString();
}

export interface SafetyAuthoringPanelProps {
  client: SupervisionClient;
  workspace: Workspace;
  machine: SafetyAuthoringMachine;
  online: boolean;
  onCreated(record: RecordDTO): Promise<void>;
}

export function SafetyAuthoringPanel({ client, workspace, machine, online, onCreated }: SafetyAuthoringPanelProps) {
  const { i18n } = useTranslation();
  const locale = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);
  const language: Locale = locale === "vi" || locale === "en" ? locale : "ko";
  const t = (key: keyof Copy) => copy[language][key];
  const capability: CreationCapability | undefined = workspace.context.creationCapabilities?.[machine];
  const catalog = workspace.context.referenceCatalog;
  const requirements = (catalog?.requirements ?? []).filter(({ ref, record }) =>
    validRef(ref, "Requirement") && record.projectId === workspace.context.projectId && record.status === "active");
  const evidence = (catalog?.evidence ?? []).filter(({ ref, record }) =>
    validRef(ref, "Evidence") && record.projectId === workspace.context.projectId && record.status !== "deleted");
  const equipment = (catalog?.assets ?? []).filter(({ ref, record }) =>
    validRef(ref, "Asset") && record.projectId === workspace.context.projectId && record.subtype === "Equipment");
  const permits = workspace.items.filter((item) => item.machine === "safety_permit"
    && item.record.projectId === workspace.context.projectId && item.record.subtype === "SafetyPermit")
    .map((item) => ({ ref: { objectType: "WorkItem", objectId: item.record.id, version: item.record.version } as DomainRef, record: item.record }));

  const [title, setTitle] = useState("");
  const [recordReason, setRecordReason] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [requirementKeys, setRequirementKeys] = useState<string[]>([]);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [permitKeys, setPermitKeys] = useState<string[]>([]);
  const [equipmentKey, setEquipmentKey] = useState("");
  const [permitNo, setPermitNo] = useState("");
  const [workType, setWorkType] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [stopOrderNo, setStopOrderNo] = useState("");
  const [stopScopeType, setStopScopeType] = useState("");
  const [stopScopeDescription, setStopScopeDescription] = useState("");
  const [stopReason, setStopReason] = useState("");
  const [hazardDescription, setHazardDescription] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [inspectionNo, setInspectionNo] = useState("");
  const [inspectionKind, setInspectionKind] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ body: string; objectId: string; key: string } | null>(null);
  const previousMachine = useRef(machine);

  useEffect(() => {
    if (previousMachine.current === machine) return;
    previousMachine.current = machine;
    setTitle(""); setRecordReason(""); setDueAt(""); setRequirementKeys([]); setEvidenceIds([]); setPermitKeys([]); setEquipmentKey("");
    setPermitNo(""); setWorkType(""); setRiskLevel(""); setStopOrderNo(""); setStopScopeType("");
    setStopScopeDescription(""); setStopReason(""); setHazardDescription(""); setObservedAt(""); setEffectiveAt("");
    setInspectionNo(""); setInspectionKind(""); setScheduledAt(""); setCreated(false); setError("");
    attempt.current = null;
  }, [machine]);

  const capabilityAllows = capability?.canCreate === true;
  const validRequirementRefs = requirements.filter(({ ref }) => requirementKeys.includes(`${ref.objectType}:${ref.objectId}:${ref.version}`)).map(({ ref }) => ref);
  const selectedPermits = permits.filter(({ ref }) => permitKeys.includes(`${ref.objectType}:${ref.objectId}:${ref.version}`));
  const selectedEquipment = equipment.find(({ ref }) => `${ref.objectType}:${ref.objectId}:${ref.version}` === equipmentKey);
  const titleValid = title.trim().length > 0;
  const stopValid = machine !== "safety_stop_order" || (!!stopOrderNo.trim() && !!stopScopeType.trim() && !!stopReason.trim()
    && !!observedAt && !!effectiveAt && selectedPermits.length > 0 && evidenceIds.length > 0);
  const equipmentValid = machine !== "safety_equipment_inspection" || (!!selectedEquipment && !!inspectionKind.trim());
  const canCreate = online && client.kind === "http" && capabilityAllows && titleValid && stopValid && equipmentValid && !busy && !created;

  function toggle(values: string[], value: string, update: (next: string[]) => void) {
    update(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
    setCreated(false);
    setError("");
  }

  function makePayload() {
    const payload: Record<string, unknown> = {
      ...workspace.context.scope,
      title: title.trim(),
      requirementRefs: validRequirementRefs,
      evidenceIds,
      ...(recordReason.trim() ? { reason: recordReason.trim() } : {}),
      ...(dueAt ? { dueAt: isoDate(dueAt) } : {}),
      data: {},
    };
    if (machine === "safety_permit") {
      const data: Record<string, unknown> = {};
      if (permitNo.trim()) data.permitNo = permitNo.trim();
      if (workType.trim()) data.workType = workType.trim();
      if (riskLevel.trim()) data.riskLevel = riskLevel.trim();
      payload.data = data;
    } else if (machine === "safety_stop_order") {
      payload.data = {
        stopOrderNo: stopOrderNo.trim(),
        stopScopeType: stopScopeType.trim(),
        stopReason: stopReason.trim(),
        observedAt: isoDate(observedAt),
        effectiveAt: isoDate(effectiveAt),
        affectedPermitRefs: selectedPermits.map(({ ref }) => ref),
        ...(stopScopeDescription.trim() ? { stopScopeDescription: stopScopeDescription.trim() } : {}),
        ...(hazardDescription.trim() ? { hazardDescription: hazardDescription.trim() } : {}),
      };
    } else {
      const data: Record<string, unknown> = {
        equipmentRef: selectedEquipment!.ref,
        inspectionKind: inspectionKind.trim(),
      };
      if (inspectionNo.trim()) data.inspectionNo = inspectionNo.trim();
      if (scheduledAt) data.scheduledAt = isoDate(scheduledAt);
      payload.data = data;
    }
    return payload;
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate) return;
    setBusy(true); setError("");
    try {
      const payload = makePayload();
      const body = JSON.stringify({ machine, payload });
      if (attempt.current?.body !== body) attempt.current = { body, objectId: crypto.randomUUID(), key: crypto.randomUUID() };
      const result = await client.create(machine, payload, attempt.current.objectId, attempt.current.key);
      await onCreated(result.record);
      setCreated(true);
      attempt.current = null;
    } catch (cause) {
      setError(cause instanceof ApiError ? reasonLabel(cause.detail.code) : copy[language].failed);
    } finally {
      setBusy(false);
    }
  }

  const disabledReason = !online ? t("offline") : client.kind === "mock" ? t("preview")
    : !capabilityAllows ? capability ? creationCapabilityLabel(capability) : t("unavailable") : "";
  const scope = workspace.context.scope;
  const machineTitle = machine === "safety_permit" ? t("permit") : machine === "safety_stop_order" ? t("stop") : t("equipmentInspection");

  return <section className="panel grid gap-4 p-4" data-ui-component="safety-authoring-panel">
    <header className="grid gap-1">
      <h2 className="text-lg font-semibold">{t("title")} · {machineTitle}</h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
    </header>
    <section className="grid gap-2 rounded-sm border border-border p-3" aria-label={t("scope")}>
      <h3 className="text-sm font-semibold">{t("scope")}</h3>
      <dl className="grid gap-2 text-sm safety-authoring-responsive-grid">
        <div><dt className="font-medium">{t("project")}</dt><dd>{workspace.project.name} · {workspace.context.projectId}</dd></div>
        <div><dt className="font-medium">{t("package")}</dt><dd>{scope.packageId || "—"}</dd></div>
        <div><dt className="font-medium">{t("location")}</dt><dd>{scope.locationId || "—"}</dd></div>
        <div><dt className="font-medium">{t("discipline")}</dt><dd>{scope.discipline || "—"}</dd></div>
        <div><dt className="font-medium">{t("organization")}</dt><dd>{scope.responsibleOrganizationId || "—"}</dd></div>
        {scope.minimumQualificationRank !== undefined && <div><dt className="font-medium">{t("qualificationRank")}</dt><dd>{scope.minimumQualificationRank}</dd></div>}
      </dl>
      <p className="text-xs text-muted-foreground">{t("scopeNote")}</p>
    </section>
    <p className="rounded-sm border border-border bg-muted/40 p-3 text-sm" role="note">{t("draftOnly")}</p>
    {disabledReason && <p className="rounded-sm border border-border bg-muted/40 p-3 text-sm" role="status">{disabledReason}</p>}
    <form className="grid gap-4" onSubmit={(event) => void save(event)}>
      <label className="grid gap-1 text-sm font-medium">{t("recordTitle")}
        <input className="min-h-11 rounded-sm border border-input bg-background px-3" value={title} maxLength={300} required disabled={busy || created} onChange={(event) => { setTitle(event.target.value); setCreated(false); setError(""); }} />
      </label>
      <div className="grid gap-3 safety-authoring-responsive-grid">
        <label className="grid gap-1 text-sm font-medium">{t("reason")}<textarea className="rounded-sm border border-input bg-background px-3 py-2" maxLength={2000} disabled={busy || created} value={recordReason} onChange={(event) => setRecordReason(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-medium">{t("dueAt")}<input type="datetime-local" className="min-h-11 rounded-sm border border-input bg-background px-3" disabled={busy || created} value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
      </div>

      <fieldset className="grid gap-2 rounded-sm border border-border p-3" disabled={busy || created}>
        <legend className="px-1 text-sm font-semibold">{t("requirements")}</legend>
        {!requirements.length && <p className="text-sm text-muted-foreground">{t("noRequirements")}</p>}
        {requirements.map(({ ref, record }) => {
          const key = `${ref.objectType}:${ref.objectId}:${ref.version}`;
          return <label key={key} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={requirementKeys.includes(key)} onChange={() => toggle(requirementKeys, key, setRequirementKeys)} /><span>{displayRecord(record, ref)}</span></label>;
        })}
      </fieldset>

      <fieldset className="grid gap-2 rounded-sm border border-border p-3" disabled={busy || created}>
        <legend className="px-1 text-sm font-semibold">{t("evidence")}</legend>
        {!evidence.length && <p className="text-sm text-muted-foreground">{t("noEvidence")}</p>}
        {evidence.map(({ ref, record }) => <label key={ref.objectId} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={evidenceIds.includes(ref.objectId)} onChange={() => toggle(evidenceIds, ref.objectId, setEvidenceIds)} /><span>{displayRecord(record, ref)}</span></label>)}
      </fieldset>

      {machine === "safety_permit" && <div className="grid gap-3 safety-authoring-responsive-grid">
        <label className="grid gap-1 text-sm font-medium">{t("permitNo")}<input className="min-h-11 rounded-sm border border-input bg-background px-3" maxLength={120} disabled={busy || created} value={permitNo} onChange={(event) => setPermitNo(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-medium">{t("workType")}<input className="min-h-11 rounded-sm border border-input bg-background px-3" maxLength={200} disabled={busy || created} value={workType} onChange={(event) => setWorkType(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-medium">{t("riskLevel")}<input className="min-h-11 rounded-sm border border-input bg-background px-3" maxLength={120} disabled={busy || created} value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)} /></label>
      </div>}

      {machine === "safety_stop_order" && <div className="grid gap-3 safety-authoring-responsive-grid">
        <label className="grid gap-1 text-sm font-medium">{t("stopOrderNo")}<input className="min-h-11 rounded-sm border border-input bg-background px-3" maxLength={120} required disabled={busy || created} value={stopOrderNo} onChange={(event) => setStopOrderNo(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-medium">{t("stopScopeType")}<input className="min-h-11 rounded-sm border border-input bg-background px-3" maxLength={120} required disabled={busy || created} value={stopScopeType} onChange={(event) => setStopScopeType(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-medium">{t("stopReason")}<textarea className="rounded-sm border border-input bg-background px-3 py-2" maxLength={2000} required disabled={busy || created} value={stopReason} onChange={(event) => setStopReason(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-medium">{t("hazardDescription")}<textarea className="rounded-sm border border-input bg-background px-3 py-2" maxLength={2000} disabled={busy || created} value={hazardDescription} onChange={(event) => setHazardDescription(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-medium">{t("stopScopeDescription")}<textarea className="rounded-sm border border-input bg-background px-3 py-2" maxLength={1000} disabled={busy || created} value={stopScopeDescription} onChange={(event) => setStopScopeDescription(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-medium">{t("observedAt")}<input type="datetime-local" className="min-h-11 rounded-sm border border-input bg-background px-3" required disabled={busy || created} value={observedAt} onChange={(event) => setObservedAt(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-medium">{t("effectiveAt")}<input type="datetime-local" className="min-h-11 rounded-sm border border-input bg-background px-3" required disabled={busy || created} value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} /></label>
        <fieldset className="grid gap-2 rounded-sm border border-border p-3 sm:col-span-2" disabled={busy || created}>
          <legend className="px-1 text-sm font-semibold">{t("affectedPermits")}</legend>
          {!permits.length && <p className="text-sm text-muted-foreground">{t("noPermits")}</p>}
          {permits.map(({ ref, record }) => { const key = `${ref.objectType}:${ref.objectId}:${ref.version}`; return <label key={key} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={permitKeys.includes(key)} onChange={() => toggle(permitKeys, key, setPermitKeys)} /><span>{displayRecord(record, ref)}</span></label>; })}
        </fieldset>
      </div>}

      {machine === "safety_equipment_inspection" && <div className="grid gap-3 safety-authoring-responsive-grid">
        <label className="grid gap-1 text-sm font-medium">{t("equipment")}<select className="min-h-11 rounded-sm border border-input bg-background px-3" required disabled={busy || created || !equipment.length} value={equipmentKey} onChange={(event) => setEquipmentKey(event.target.value)}>
          <option value="">{equipment.length ? t("equipment") : t("noEquipment")}</option>
          {equipment.map(({ ref, record }) => <option key={`${ref.objectType}:${ref.objectId}:${ref.version}`} value={`${ref.objectType}:${ref.objectId}:${ref.version}`}>{displayRecord(record, ref)}</option>)}
        </select></label>
        <label className="grid gap-1 text-sm font-medium">{t("inspectionKind")}<input className="min-h-11 rounded-sm border border-input bg-background px-3" maxLength={120} required disabled={busy || created} value={inspectionKind} onChange={(event) => setInspectionKind(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-medium">{t("inspectionNo")}<input className="min-h-11 rounded-sm border border-input bg-background px-3" maxLength={120} disabled={busy || created} value={inspectionNo} onChange={(event) => setInspectionNo(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-medium">{t("scheduledAt")}<input type="datetime-local" className="min-h-11 rounded-sm border border-input bg-background px-3" disabled={busy || created} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>
      </div>}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {created && <p role="status" className="text-sm">{t("created")}</p>}
      {!canCreate && !disabledReason && <p role="note" className="text-sm text-muted-foreground">{t("required")}</p>}
      <ActionButton type="submit" disabled={!canCreate}>{busy ? t("saving") : t("createDraft")}</ActionButton>
    </form>
  </section>;
}
