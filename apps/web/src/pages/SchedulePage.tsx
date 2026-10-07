import { useEffect, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CommandDescriptor, WorkItem, Workspace } from "../data/ui-contract";
import type {
  NormalizedScheduleSource,
  ScheduleSourceImportDetail,
  SupervisionClient,
} from "../data/supervision-client";
import { ApiError } from "../data/supervision-client";
import { scheduleInputs } from "../data/schedule-fields.generated";
import { scheduleSourceImport } from "../data/schedule-source-import.generated";
import { describeCommandAvailability } from "../data/ui-presentation";
import { commands, fields, reasonLabel, states } from "../labels";
import { ActionButton, Panel, SectionHeader, StatusBadge } from "../ui";
import { ActionGate, DetailPane, StatusBoundaryGroup } from "../ui/catalog";
import { WorkbenchTemplate } from "../ui/templates";
import { PageBoundary } from "./PageBoundary";
import { recordTitle } from "./record-utils";
import { RecordList } from "./shared";

const SOURCE_TAB = "schedule_imports";
const tabs = [
  { id: "schedule_baseline", label: "기준공정", description: "승인된 비교 기준입니다. 진도·예측 변경으로 덮어쓰지 않습니다." },
  { id: "schedule_progress", label: "진도기록", description: "기준일별 실적·예측 기록입니다. 확정 후 정정은 새 기록과 사유로 남깁니다." },
  { id: "delay_event", label: "지연사건", description: "지연 사실과 영향평가를 관리합니다. 지연 확인은 공기연장 승인이 아닙니다." },
  { id: "recovery_plan", label: "회복계획", description: "회복계획 수락·실행·효과를 관리합니다. 기준공정과 계약 결정은 별도입니다." },
  { id: SOURCE_TAB, label: "원본입력", description: "정규화 JSON 원본과 생성된 Activity 스냅샷을 보존·조회합니다. 원본 입력 자체는 승인·활성화·공기연장 결정이 아닙니다." },
];

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function display(value: unknown): string {
  if (value === undefined || value === null || value === "") return "기록 없음";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (Array.isArray(value)) return value.length ? value.map(display).join(" · ") : "연결 없음";
  if (typeof value === "object") {
    const ref = object(value);
    if (ref.objectId) return `${ref.objectType} · ${ref.objectId} · v${ref.version}`;
    return JSON.stringify(value);
  }
  return String(value);
}

function scheduleState(item: WorkItem) {
  const state = item.record.status || "";
  if (item.machine === "schedule_source") return "원본 스냅샷";
  if (state === "active" && item.machine === "recovery_plan") return "회복계획 실행 중";
  if (state === "effective" && item.machine === "recovery_plan") return "회복효과 확인";
  if (state === "completed" && item.machine === "recovery_plan") return "회복계획 완료";
  if (state === "verification" && item.machine === "schedule_progress") return "진도 검증";
  return states[state] || state;
}

function sourceData(item: WorkItem) {
  return object(item.record.schedule ?? item.record.data);
}

function sourceImportMetadata(item: WorkItem) {
  return object(object(item.record.metadata).sourceImport);
}

function isImportedSchedule(item: WorkItem | null | undefined) {
  return Boolean(item && item.record.subtype === "Schedule" && Object.keys(sourceImportMetadata(item)).length);
}

function sourceKindLabel(value: unknown) {
  return ({
    baseline: "기준공정 원본",
    progress_update: "진도 원본",
    recovery: "회복공정 지원 원본",
  } as Record<string, string>)[String(value)] || String(value || "원본 종류 미기록");
}

function ScheduleDetail({ item, workspace }: { item: WorkItem; workspace: Workspace }) {
  const data = sourceData(item);
  const baselineRef = object(data.baselineScheduleRef);
  const baseline = workspace.items.find(
    (x) => x.record.id === baselineRef.objectId && x.record.version === baselineRef.version,
  );
  const baselineData = item.machine === "schedule_baseline"
    ? data
    : baseline
      ? sourceData(baseline)
      : {};
  return <>
    <StatusBoundaryGroup
      title="공정 기준 · 예측 · 기준일"
      description="각 값은 저장된 원본을 표시합니다. 기록이 없으면 공정 상태를 추정하지 않습니다."
      items={[
        {
          id: "baseline",
          label: "기준공정 완료일",
          value: display(baselineData.contractualCompletionAt),
          detail: baseline
            ? `${recordTitle(baseline.record)} · v${baseline.record.version}`
            : "해당 원본의 계약 완료일",
        },
        {
          id: "forecast",
          label: "예측 완료일",
          value: display(data.forecastCompletionAt ?? data.currentForecastCompletionAt),
          detail: "현재 원본에 기록된 예측",
        },
        { id: "data-date", label: "기준일", value: display(data.dataDate), detail: "진도 판단의 기준일 보존" },
      ]}
    />
    <div className="meta-grid mt-3">
      <div><span>원본 ID</span><strong className="break-all">{item.record.id}</strong></div>
      <div><span>원본 버전</span><strong>v{item.record.version}</strong></div>
      <div><span>원본 파일 해시</span><strong className="break-all">{display(data.sourceFileHash)}</strong></div>
      <div><span>공정 원본 파일 버전</span><strong>{display(data.sourceFileVersion)}</strong></div>
    </div>
    <section className="detail-section" aria-label="공정 원본 상세">
      <SectionHeader title="공정 원본 상세" meta="서버 저장값" />
      <dl className="grid gap-3 sm:grid-cols-2">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="min-w-0 border-b border-border pb-2">
            <dt className="text-xs text-slate-500">{fields[key] || key}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-all text-xs">{display(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
    <section className="detail-section" aria-label="보고 및 계약 연결">
      <SectionHeader title="발주처 보고 · 계약 연결" />
      <p className="muted">업무 종결과 발주처 후속조치 종결은 각각 확인합니다. 공기연장 결정 기능은 별도 구현 단계입니다.</p>
      <dl className="grid gap-3 sm:grid-cols-2 mt-3">
        {["ownerReportRefs", "decisionRefs", "ownerDecisionRef", "contractNoticeRefs", "claimRefs", "eotDecisionRef", "contractTrackRefs"].map((key) => (
          <div key={key}>
            <dt className="text-xs text-slate-500">{fields[key] || key}</dt>
            <dd className="break-all text-xs">{display(data[key])}</dd>
          </div>
        ))}
      </dl>
    </section>
  </>;
}

function ImportedSourceDetail({
  item,
  client,
}: {
  item: WorkItem;
  client: SupervisionClient;
}) {
  const [detail, setDetail] = useState<ScheduleSourceImportDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    client.scheduleSourceImportDetail(item.record.id)
      .then((value) => {
        if (alive) setDetail(value);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof ApiError ? `${reasonLabel(e.detail.code)} ${e.message}` : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [client, item.record.id]);

  const currentData = sourceData(item);
  const metadata = sourceImportMetadata(item);
  const originalData = detail ? object(detail.record.schedule ?? detail.record.data) : {};
  const kind = currentData.scheduleKind ?? originalData.scheduleKind;

  return <>
    <StatusBoundaryGroup
      title="원본 입력 · 업무 상태 경계"
      description="원본 보존과 업무 승인·활성화는 별도입니다. 회복공정 원본은 Recovery Plan을 자동 생성하거나 기준공정을 변경하지 않습니다."
      items={[
        { id: "source-kind", label: "원본 종류", value: sourceKindLabel(kind), detail: "업로드 원본의 scheduleKind" },
        { id: "workflow-state", label: "현재 업무 상태", value: scheduleState(item), detail: "서버의 현재 Schedule 상태" },
        { id: "original-version", label: "보존 원본", value: detail ? `v${detail.record.version}` : "조회 중", detail: "원본 Schedule은 v1 스냅샷으로 조회" },
      ]}
    />
    <div className="meta-grid mt-3">
      <div><span>입력 방식</span><strong>{display(metadata.inputMode)}</strong></div>
      <div><span>파서 버전</span><strong>{display(metadata.parserVersion)}</strong></div>
      <div><span>원본 증빙</span><strong className="break-all">{display(metadata.sourceEvidenceRef)}</strong></div>
      <div><span>Activity 수</span><strong>{display(currentData.activityCount ?? detail?.activities.length)}</strong></div>
    </div>
    {kind === "recovery" && (
      <div className="schedule-source-note" role="note">
        <strong>회복공정 지원 원본</strong>
        <span>이 기록은 Recovery Plan 수락·실행 상태가 아니며 Baseline 활성화 명령도 제공하지 않습니다.</span>
      </div>
    )}
    {loading && <div className="empty compact">원본 Schedule v1과 Activity 스냅샷을 조회하고 있습니다.</div>}
    {error && <div role="alert" className="error-box">{error}</div>}
    {detail && <>
      <section className="detail-section" aria-label="보존 원본 Schedule">
        <SectionHeader title="보존 원본 Schedule v1" meta={sourceKindLabel(originalData.scheduleKind)} />
        <dl className="grid gap-3 sm:grid-cols-2">
          {Object.entries(originalData).map(([key, value]) => (
            <div key={key} className="min-w-0 border-b border-border pb-2">
              <dt className="text-xs text-slate-500">{fields[key] || key}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-all text-xs">{display(value)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="detail-section" aria-label="원본 Activity 스냅샷">
        <SectionHeader title="Activity 스냅샷" meta={`${detail.activities.length}건 · read-only`} />
        <div className="schedule-activity-list">
          {detail.activities.map((activity) => {
            const data = object(activity.data);
            const isCritical = data.critical === true;
            return <article className="schedule-activity-card" key={activity.id}>
              <div className="schedule-activity-head">
                <div>
                  <span className="eyebrow">{display(data.wbsPath)}</span>
                  <strong>{display(data.activityId)} · {display(data.activityName)}</strong>
                </div>
                {isCritical && <span className="schedule-critical">CRITICAL</span>}
              </div>
              <dl>
                <div><dt>계획</dt><dd>{display(data.plannedStartAt)} → {display(data.plannedFinishAt)}</dd></div>
                <div><dt>실적</dt><dd>{display(data.actualStartAt)} → {display(data.actualFinishAt)}</dd></div>
                <div><dt>예측</dt><dd>{display(data.forecastStartAt)} → {display(data.forecastFinishAt)}</dd></div>
                <div><dt>진도 / Float</dt><dd>{display(data.percentComplete)} / {display(data.totalFloat)}</dd></div>
                <div><dt>선행</dt><dd>{display(data.predecessorRefs)}</dd></div>
                <div><dt>후행</dt><dd>{display(data.successorRefs)}</dd></div>
              </dl>
            </article>;
          })}
        </div>
      </section>
    </>}
    <section className="detail-section">
      <SectionHeader title="업무 명령" />
      <p className="muted">승인·활성화·검증·동결 명령은 기준공정 또는 진도기록 탭에서 현재 업무 버전에 대해 수행합니다.</p>
    </section>
  </>;
}

function CreateSchedule({
  machine,
  workspace,
  client,
  online,
  onCreated,
  onClose,
}: {
  machine: string;
  workspace: Workspace;
  client: SupervisionClient;
  online: boolean;
  onCreated: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const schema = scheduleInputs[machine];
  const [values, setValues] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [selectedEvidenceId, setSelectedEvidenceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const identity = useRef({ id: crypto.randomUUID(), key: crypto.randomUUID(), body: "" });
  const isSchedule = machine.startsWith("schedule_");
  const requiresEvidence = machine === "delay_event";
  const evidenceItems = workspace.items.filter((item) => item.machine === "evidence");

  async function submit() {
    setError("");
    setBusy(true);
    try {
      if (!online) throw new Error("연결 복구 후 다시 제출하십시오.");
      if (!title.trim()) throw new Error("제목을 입력하십시오.");
      if (requiresEvidence && !selectedEvidenceId) throw new Error("지연사건의 근거 증빙을 선택하십시오.");
      const data: Record<string, unknown> = {};
      for (const [key, spec] of Object.entries(schema.fields)) {
        const text = values[key]?.trim();
        if (!text) continue;
        if (spec.type === "number" || spec.type === "integer") {
          const n = Number(text);
          if (!Number.isFinite(n) || (spec.type === "integer" && !Number.isInteger(n))) {
            throw new Error(`${fields[key] || key}: 숫자를 입력하십시오.`);
          }
          data[key] = n;
        } else if (spec.type === "boolean") {
          data[key] = text === "true";
        } else if (spec.type === "array" || spec.type === "object") {
          data[key] = JSON.parse(text);
        } else {
          data[key] = text;
        }
      }
      for (const key of schema.required) {
        if (key !== "scheduleKind" && data[key] === undefined) {
          throw new Error(`${fields[key] || key}: 필수 입력입니다.`);
        }
      }
      if (isSchedule) {
        data.scheduleKind = machine === "schedule_baseline" ? "baseline" : "progress_update";
      }
      const payload = {
        ...workspace.context.scope,
        title: title.trim(),
        ...(requiresEvidence ? { evidenceIds: [selectedEvidenceId] } : {}),
        ...(isSchedule
          ? {
              revision: data.revision,
              fileIds: data.sourceFileRef ? [data.sourceFileRef] : [],
              schedule: data,
            }
          : { data }),
      };
      const body = JSON.stringify(payload);
      if (identity.current.body && identity.current.body !== body) {
        identity.current = { id: crypto.randomUUID(), key: crypto.randomUUID(), body };
      }
      identity.current.body = body;
      const result = await client.create(machine, payload, identity.current.id, identity.current.key);
      await onCreated(result.record.id);
    } catch (e) {
      setError(e instanceof ApiError ? `${reasonLabel(e.detail.code)} ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  }

  function input(key: string) {
    const spec = schema.fields[key];
    return <label key={key}>{fields[key] || key}{schema.required.includes(key) ? " *" : ""}
      {spec.type === "boolean" || spec.enum ? (
        <select value={values[key] || ""} onChange={(e) => setValues({ ...values, [key]: e.target.value })}>
          <option value="">선택</option>
          {(spec.enum || ["false", "true"]).map((value) => (
            <option value={value} key={value}>
              {value === "true" ? "예" : value === "false" ? "아니오" : value}
            </option>
          ))}
        </select>
      ) : (
        <textarea
          value={values[key] || ""}
          rows={spec.type === "object" || spec.type === "array" ? 3 : 1}
          onChange={(e) => setValues({ ...values, [key]: e.target.value })}
          placeholder={
            spec.type === "object" || spec.type === "array"
              ? "JSON · 원본 ID와 버전 참조"
              : key.endsWith("At") || key === "dataDate"
                ? "RFC3339 · 시간대 포함"
                : fields[key] || key
          }
        />
      )}
    </label>;
  }

  return <div className="modal-backdrop">
    <section className="modal" role="dialog" aria-modal="true" aria-label="공정 기록 추가">
      <div className="section-heading">
        <h2>{tabs.find((x) => x.id === machine)?.label} 기록 추가</h2>
        <button aria-label="대화상자 닫기" onClick={onClose} disabled={busy}>×</button>
      </div>
      <p className="muted">원본 파일과 정확한 버전 참조를 입력하십시오. 권한·공정 연계·필수자료는 제출 시 서버가 검증합니다.</p>
      <div className="modal-fields">
        <label>제목 *<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        {requiresEvidence && <label>근거 증빙 *<select aria-label="근거 증빙" value={selectedEvidenceId} onChange={(e) => setSelectedEvidenceId(e.target.value)}>
          <option value="">증빙 선택</option>
          {evidenceItems.map((item) => <option key={item.record.id} value={item.record.id}>{recordTitle(item.record)} · {item.record.id}</option>)}
        </select><small className="muted">{evidenceItems.length ? "지연사건은 서버에 보존된 근거 증빙을 선택해야 등록할 수 있습니다." : "현재 프로젝트에 연결 가능한 서버 증빙이 없어 지연사건을 등록할 수 없습니다."}</small></label>}
        {schema.required.filter((key) => key !== "scheduleKind").map(input)}
      </div>
      <details>
        <summary>추가 공정자료 · 참조 · 정정 사유</summary>
        <div className="modal-fields">
          {Object.keys(schema.fields).filter((key) => !schema.required.includes(key)).map(input)}
        </div>
      </details>
      {error && <div role="alert" className="error-box">{error}</div>}
      <div className="modal-actions">
        <button className="secondary" disabled={busy} onClick={onClose}>취소</button>
        <button className="primary" disabled={busy || !online || (requiresEvidence && !selectedEvidenceId)} onClick={() => void submit()}>
          {busy ? "검증 중…" : "기록 추가"}
        </button>
      </div>
    </section>
  </div>;
}

function parseNormalizedSource(bytes: Uint8Array): NormalizedScheduleSource {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("UTF-8 형식의 유효한 JSON 파일을 선택하십시오.");
  }
  const document = object(parsed);
  const keys = Object.keys(document).sort();
  const expected = [...scheduleSourceImport.documentProperties].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("원본 JSON은 schedule, activities, criticalActivityId 세 항목만 포함해야 합니다.");
  }
  const schedule = object(document.schedule);
  if (!Object.keys(schedule).length) throw new Error("schedule 객체가 필요합니다.");
  for (const key of scheduleSourceImport.scheduleExcludes) {
    if (key in schedule) throw new Error(`${key}는 원본 JSON에 넣지 않습니다. 업로드 후 서버 요청에서 연결됩니다.`);
  }
  for (const key of ["scheduleNo", "scheduleKind", "revision", "sourceFormat", "sourceFileVersion"]) {
    if (typeof schedule[key] !== "string" || !String(schedule[key]).trim()) {
      throw new Error(`schedule.${key} 값이 필요합니다.`);
    }
  }
  if (!(schedule.scheduleKind as string in scheduleSourceImport.kinds)) {
    throw new Error("scheduleKind는 baseline, progress_update, recovery 중 하나여야 합니다.");
  }
  if (schedule.sourceFormat !== scheduleSourceImport.inputMode) {
    throw new Error(`sourceFormat은 현재 ${scheduleSourceImport.inputMode}만 지원합니다.`);
  }
  if (!Array.isArray(document.activities) || document.activities.length === 0) {
    throw new Error("activities에는 최소 1개의 Activity가 필요합니다.");
  }
  const activities = document.activities.map((raw, index) => {
    const activity = object(raw);
    const invalid = Object.keys(activity).filter(
      (key) => !scheduleSourceImport.activityProperties.includes(
        key as typeof scheduleSourceImport.activityProperties[number],
      ),
    );
    if (invalid.length) throw new Error(`activities[${index}]에 요청용 메타데이터가 포함되어 있습니다: ${invalid.join(", ")}`);
    const data = object(activity.data);
    for (const key of ["activityId", "wbsPath", "activityName"]) {
      if (typeof data[key] !== "string" || !String(data[key]).trim()) {
        throw new Error(`activities[${index}].data.${key} 값이 필요합니다.`);
      }
    }
    for (const key of ["predecessorActivityIds", "successorActivityIds"] as const) {
      const value = activity[key];
      if (value !== undefined && (!Array.isArray(value) || value.some((id) => typeof id !== "string"))) {
        throw new Error(`activities[${index}].${key}는 문자열 배열이어야 합니다.`);
      }
    }
    return {
      data,
      ...(activity.predecessorActivityIds !== undefined
        ? { predecessorActivityIds: activity.predecessorActivityIds as string[] }
        : {}),
      ...(activity.successorActivityIds !== undefined
        ? { successorActivityIds: activity.successorActivityIds as string[] }
        : {}),
    };
  });
  if (typeof document.criticalActivityId !== "string" || !document.criticalActivityId) {
    throw new Error("criticalActivityId 값이 필요합니다.");
  }
  const critical = activities.find((activity) => activity.data.activityId === document.criticalActivityId);
  if (!critical || critical.data.critical !== true) {
    throw new Error("criticalActivityId는 activities에 존재하고 critical=true여야 합니다.");
  }
  return {
    schedule,
    activities,
    criticalActivityId: document.criticalActivityId,
  };
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function ImportScheduleSource({
  workspace,
  client,
  online,
  onImported,
  onClose,
}: {
  workspace: Workspace;
  client: SupervisionClient;
  online: boolean;
  onImported: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<NormalizedScheduleSource | null>(null);
  const [fileError, setFileError] = useState("");
  const [error, setError] = useState("");
  const [stage, setStage] = useState("원본 JSON 선택");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const identity = useRef<{
    fingerprint: string;
    scheduleId: string;
    activityIds: string[];
    key: string;
    evidence: { id: string; version: number; fileId: string; fileHash: string } | null;
  } | null>(null);

  async function inspectFile(next: File | null) {
    setFile(next);
    setPreview(null);
    setFileError("");
    setError("");
    setProgress(0);
    setStage(next ? "원본 JSON 검증" : "원본 JSON 선택");
    identity.current = null;
    if (!next) return;
    try {
      const bytes = new Uint8Array(await next.arrayBuffer());
      setPreview(parseNormalizedSource(bytes));
      setStage("입력 준비");
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
      setStage("원본 JSON 확인 필요");
    }
  }

  async function submit() {
    setError("");
    setBusy(true);
    try {
      if (!online) throw new Error("연결 복구 후 다시 제출하십시오.");
      if (client.kind === "mock") throw new Error("UI Mock Preview에서는 원본 입력을 실행하지 않습니다.");
      if (!title.trim()) throw new Error("제목을 입력하십시오.");
      if (!file || !preview) throw new Error("검증된 정규화 JSON 파일을 선택하십시오.");
      if (!client.session) throw new Error("로그인이 필요합니다.");

      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = parseNormalizedSource(bytes);
      const hash = await sha256(bytes);
      const fingerprint = `${hash}:${title.trim()}:${parsed.activities.length}`;
      if (!identity.current || identity.current.fingerprint !== fingerprint) {
        identity.current = {
          fingerprint,
          scheduleId: crypto.randomUUID(),
          activityIds: parsed.activities.map(() => crypto.randomUUID()),
          key: crypto.randomUUID(),
          evidence: null,
        };
      }

      setStage("원본 파일 보존");
      let evidence = identity.current.evidence;
      if (!evidence) {
        const uploaded = await client.upload(
          bytes,
          {
            name: file.name,
            mime: "application/json",
            hash,
            scope: workspace.context.scope,
            sourcePartyId: client.session.actor.partyId,
          },
          (offset, total) => setProgress(total ? Math.round((offset / total) * 100) : 0),
        );
        if (!uploaded.fileId || !uploaded.fileHash) {
          throw new Error("원본 업로드 결과에서 파일 참조를 확인할 수 없습니다.");
        }
        evidence = {
          id: uploaded.id,
          version: uploaded.version,
          fileId: String(uploaded.fileId),
          fileHash: String(uploaded.fileHash),
        };
        identity.current.evidence = evidence;
      }

      const {
        minimumQualificationRank: _minimumQualificationRank,
        ...scope
      } = workspace.context.scope;
      const schedule = {
        ...parsed.schedule,
        sourceFileRef: evidence.fileId,
        sourceFileHash: hash,
      };
      const activities = parsed.activities.map((activity, index) => ({
        clientObjectId: identity.current!.activityIds[index],
        data: activity.data,
        ...(activity.predecessorActivityIds !== undefined
          ? { predecessorActivityIds: activity.predecessorActivityIds }
          : {}),
        ...(activity.successorActivityIds !== undefined
          ? { successorActivityIds: activity.successorActivityIds }
          : {}),
      }));

      setProgress(100);
      setStage("Schedule · Activity 생성");
      const result = await client.importScheduleSource(
        {
          clientObjectId: identity.current.scheduleId,
          scope,
          title: title.trim(),
          sourceEvidenceRef: {
            objectType: "Evidence",
            objectId: evidence.id,
            version: evidence.version,
          },
          inputMode: scheduleSourceImport.inputMode,
          parserVersion: scheduleSourceImport.parserVersion,
          schedule,
          activities,
          criticalActivityId: parsed.criticalActivityId,
        },
        identity.current.key,
      );
      setStage("원본 입력 완료");
      await onImported(result.record.id);
    } catch (e) {
      setError(e instanceof ApiError ? `${reasonLabel(e.detail.code)} ${e.message}` : e instanceof Error ? e.message : String(e));
      setStage("입력 확인 필요");
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop">
    <section className="modal schedule-source-modal" role="dialog" aria-modal="true" aria-label="공정 원본 입력">
      <div className="section-heading">
        <h2>정규화 JSON 원본 입력</h2>
        <button aria-label="대화상자 닫기" onClick={onClose} disabled={busy}>×</button>
      </div>
      <div className="schedule-source-contract" role="note">
        <strong>현재 지원 범위</strong>
        <span>{scheduleSourceImport.inputMode} · {scheduleSourceImport.parserVersion}</span>
        <small>XER / MSP / CSV 직접 파서는 아직 지원하지 않습니다.</small>
      </div>
      <div className="modal-fields">
        <label>제목 *<input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} /></label>
        <label>원본 JSON *
          <input
            aria-label="공정 원본 JSON"
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => void inspectFile(e.target.files?.[0] || null)}
          />
        </label>
      </div>
      {file && <div className="schedule-source-file">
        <strong>{file.name}</strong>
        <span>{file.size.toLocaleString()} bytes</span>
      </div>}
      {preview && <div className="meta-grid schedule-source-preview" data-ui-component="schedule-source-preview">
        <div><span>원본 종류</span><strong>{sourceKindLabel(preview.schedule.scheduleKind)}</strong></div>
        <div><span>공정번호</span><strong>{display(preview.schedule.scheduleNo)}</strong></div>
        <div><span>리비전</span><strong>{display(preview.schedule.revision)}</strong></div>
        <div><span>Activity</span><strong>{preview.activities.length}건</strong></div>
        <div><span>Critical Activity</span><strong>{preview.criticalActivityId}</strong></div>
        <div><span>원본 포맷</span><strong>{display(preview.schedule.sourceFormat)}</strong></div>
      </div>}
      {(busy || progress > 0) && <div className="schedule-source-progress" aria-live="polite">
        <div><strong>{stage}</strong><span>{progress}%</span></div>
        <progress max={100} value={progress} />
      </div>}
      {fileError && <div role="alert" className="error-box">{fileError}</div>}
      {error && <div role="alert" className="error-box">{error}</div>}
      <p className="muted">
        업로드한 원본 바이트와 SHA-256을 보존한 뒤 Schedule과 Activity를 하나의 원본 입력 단위로 생성합니다.
        승인·활성화·진도 동결은 각 업무 탭에서 별도로 수행합니다.
      </p>
      <div className="modal-actions">
        <button className="secondary" disabled={busy} onClick={onClose}>취소</button>
        <button className="primary" disabled={busy || !online || !preview || client.kind === "mock"} onClick={() => void submit()}>
          {busy ? stage : "원본 입력"}
        </button>
      </div>
    </section>
  </div>;
}

export function SchedulePage({
  client,
  workspace,
  selected,
  current,
  online,
  onSelect,
  onOpenCommand,
  refresh,
}: {
  client: SupervisionClient;
  workspace: Workspace;
  selected: string | null;
  current: WorkItem | null;
  online: boolean;
  onSelect: (id: string | null) => void;
  onOpenCommand: (item: WorkItem, action: CommandDescriptor) => void;
  refresh: () => Promise<void>;
}) {
  const [machine, setMachine] = useState("schedule_baseline");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const currentImported = isImportedSchedule(current);
  const active = current?.machine === "schedule_source"
    ? SOURCE_TAB
    : machine === SOURCE_TAB && currentImported
      ? SOURCE_TAB
      : current && tabs.some((x) => x.id === current.machine)
        ? current.machine
        : machine;
  const tab = tabs.find((x) => x.id === active)!;
  const items = active === SOURCE_TAB
    ? workspace.items.filter((x) => isImportedSchedule(x))
    : workspace.items.filter((x) => x.machine === active);
  const item = active === SOURCE_TAB
    ? currentImported ? current : null
    : current?.machine === active ? current : null;

  return <PageBoundary name="schedule">
    <section data-ui-component="schedule-workspace">
      <Tabs
        value={active}
        onValueChange={(value) => {
          setMachine(value);
          onSelect(null);
        }}
        className="mb-4 gap-0 overflow-hidden rounded-sm border border-border bg-white"
      >
        <TabsList variant="line" className="w-full justify-start flex-wrap h-auto border-b border-border px-3">
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="min-h-11 flex-none px-3 text-xs">{t.label}</TabsTrigger>
          ))}
        </TabsList>
        <p className="px-4 py-3 text-xs text-slate-500">{tab.description}</p>
      </Tabs>
      <WorkbenchTemplate hasDetail={Boolean(item)}>
        <Panel className="list-pane">
          <SectionHeader title={tab.label} meta={`${items.length}건`} />
          <div className="schedule-list-actions">
            <ActionButton
              disabled={!online || client.kind === "mock"}
              onClick={() => setImporting(true)}
            >
              정규화 JSON 원본 입력
            </ActionButton>
            {active !== SOURCE_TAB && (
              <ActionButton
                disabled={!online || client.kind === "mock"}
                onClick={() => setCreating(true)}
              >
                공정 기록 추가
              </ActionButton>
            )}
          </div>
          {client.kind === "mock" && active === SOURCE_TAB && (
            <p className="muted">UI Mock Preview에서는 원본 업로드·생성을 실행하지 않습니다.</p>
          )}
          <RecordList
            statusLabel={active === SOURCE_TAB
              ? (x) => sourceKindLabel(sourceData(x).scheduleKind)
              : scheduleState}
            contextLabel={(x) => `${x.record.packageId || "범위 미기록"} · ${x.record.discipline || "분야 미기록"}`}
            items={items}
            selected={selected}
            onSelect={(x) => onSelect(x.record.id)}
          />
        </Panel>
        <DetailPane>
          {!item ? (
            <div className="empty compact">
              <h2>{tab.label} 상세</h2>
              <p>
                {active === SOURCE_TAB
                  ? "원본을 선택해 보존 Schedule v1과 생성된 Activity 스냅샷을 확인하십시오."
                  : "원본을 선택해 날짜·버전·연결 기록과 가능한 명령을 확인하십시오."}
              </p>
            </div>
          ) : <>
            <button className="mobile-back" onClick={() => onSelect(null)}>← 목록</button>
            <div className="detail-head">
              <div>
                <span className="eyebrow">{tab.label}</span>
                <h2>{recordTitle(item.record)}</h2>
              </div>
              <StatusBadge status={item.record.status}>
                {active === SOURCE_TAB ? sourceKindLabel(sourceData(item).scheduleKind) : scheduleState(item)}
              </StatusBadge>
            </div>
            {active === SOURCE_TAB ? (
              <ImportedSourceDetail key={item.record.id} item={item} client={client} />
            ) : <>
              <ScheduleDetail item={item} workspace={workspace} />
              <div className="detail-section">
                <SectionHeader title="가능한 업무 명령" meta="서버 권한 · 선행조건" />
                {item.actions.length ? (
                  <ActionGate actions={item.actions.map((action) => {
                    const presentation = describeCommandAvailability(action, online);
                    return {
                      id: action.command,
                      label: commands[action.command] || action.command,
                      primary: action.ready,
                      disabled: presentation.disabled,
                      availability: presentation.availability,
                      availabilityLabel: presentation.label,
                      reason: presentation.reason,
                      onAction: () => onOpenCommand(item, action),
                    };
                  })} />
                ) : (
                  <div className="empty compact">현재 역할과 상태에서 가능한 명령이 없습니다.</div>
                )}
              </div>
            </>}
          </>}
        </DetailPane>
      </WorkbenchTemplate>
      {creating && active !== SOURCE_TAB && (
        <CreateSchedule
          machine={active}
          workspace={workspace}
          client={client}
          online={online}
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false);
            await refresh();
            onSelect(id);
          }}
        />
      )}
      {importing && (
        <ImportScheduleSource
          workspace={workspace}
          client={client}
          online={online}
          onClose={() => setImporting(false)}
          onImported={async (id) => {
            setImporting(false);
            setMachine(SOURCE_TAB);
            await refresh();
            onSelect(id);
          }}
        />
      )}
    </section>
  </PageBoundary>;
}
