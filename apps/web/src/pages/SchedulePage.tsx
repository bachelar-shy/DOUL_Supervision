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
import i18n from "../i18n/config";
import { formatNumber } from "../i18n/format";

const SOURCE_TAB = "schedule_imports";
const tabs = [
  {
    id: "schedule_baseline",
    labelKey: "schedule.tab.baseline.label",
    descriptionKey: "schedule.tab.baseline.description",
  },
  {
    id: "schedule_progress",
    labelKey: "schedule.tab.progress.label",
    descriptionKey: "schedule.tab.progress.description",
  },
  {
    id: "delay_event",
    labelKey: "schedule.tab.delay.label",
    descriptionKey: "schedule.tab.delay.description",
  },
  {
    id: "recovery_plan",
    labelKey: "schedule.tab.recovery.label",
    descriptionKey: "schedule.tab.recovery.description",
  },
  {
    id: SOURCE_TAB,
    labelKey: "schedule.tab.source.label",
    descriptionKey: "schedule.tab.source.description",
  },
];

function tr(key: string, values: Record<string, string | number> = {}) {
  return i18n.t(key, values);
}

function tabLabel(id: string) {
  const tab = tabs.find((item) => item.id === id);
  return tab ? tr(tab.labelKey) : id;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function display(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return tr("schedule.display.none");
  }
  if (typeof value === "boolean") {
    return value ? i18n.t("common.yes") : i18n.t("common.no");
  }
  if (Array.isArray(value)) {
    return value.length ? value.map(display).join(" · ") : tr("schedule.display.noLinks");
  }
  if (typeof value === "object") {
    const ref = object(value);
    if (ref.objectId) return `${ref.objectType} · ${ref.objectId} · v${ref.version}`;
    return JSON.stringify(value);
  }
  return String(value);
}

function scheduleState(item: WorkItem) {
  const state = item.record.status || "";
  if (item.machine === "schedule_source") return tr("schedule.state.sourceSnapshot");
  if (state === "active" && item.machine === "recovery_plan") {
    return tr("schedule.state.recoveryActive");
  }
  if (state === "effective" && item.machine === "recovery_plan") {
    return tr("schedule.state.recoveryEffective");
  }
  if (state === "completed" && item.machine === "recovery_plan") {
    return tr("schedule.state.recoveryCompleted");
  }
  if (state === "verification" && item.machine === "schedule_progress") {
    return tr("schedule.state.progressVerification");
  }
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
    baseline: tr("schedule.sourceKind.baseline"),
    progress_update: tr("schedule.sourceKind.progress"),
    recovery: tr("schedule.sourceKind.recovery"),
  } as Record<string, string>)[String(value)] || String(
    value || tr("schedule.sourceKind.unknown"),
  );
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
      title={tr("schedule.detail.boundary.title")}
      description={tr("schedule.detail.boundary.description")}
      items={[
        {
          id: "baseline",
          label: tr("schedule.detail.baselineFinish"),
          value: display(baselineData.contractualCompletionAt),
          detail: baseline
            ? `${recordTitle(baseline.record)} · v${baseline.record.version}`
            : tr("schedule.detail.baselineFinishFallback"),
        },
        {
          id: "forecast",
          label: tr("schedule.detail.forecastFinish"),
          value: display(data.forecastCompletionAt ?? data.currentForecastCompletionAt),
          detail: tr("schedule.detail.forecastDetail"),
        },
        {
          id: "data-date",
          label: tr("schedule.detail.dataDate"),
          value: display(data.dataDate),
          detail: tr("schedule.detail.dataDateDetail"),
        },
      ]}
    />
    <div className="meta-grid mt-3">
      <div><span>{tr("schedule.detail.originalId")}</span><strong className="break-all">{item.record.id}</strong></div>
      <div><span>{tr("schedule.detail.originalVersion")}</span><strong>v{item.record.version}</strong></div>
      <div><span>{tr("schedule.detail.fileHash")}</span><strong className="break-all">{display(data.sourceFileHash)}</strong></div>
      <div><span>{tr("schedule.detail.sourceFileVersion")}</span><strong>{display(data.sourceFileVersion)}</strong></div>
    </div>
    <section className="detail-section" aria-label={tr("schedule.detail.sourceAria")}>
      <SectionHeader
        title={tr("schedule.detail.sourceTitle")}
        meta={tr("schedule.detail.serverValue")}
      />
      <dl className="grid gap-3 sm:grid-cols-2">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="min-w-0 border-b border-border pb-2">
            <dt className="text-xs text-slate-500">{fields[key] || key}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-all text-xs">{display(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
    <section className="detail-section" aria-label={tr("schedule.detail.ownerLinkAria")}>
      <SectionHeader title={tr("schedule.detail.ownerLinkTitle")} />
      <p className="muted">{tr("schedule.detail.ownerLinkDescription")}</p>
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
        setError(e instanceof ApiError ? reasonLabel(e.detail.code) : String(e));
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
      title={tr("schedule.imported.boundary.title")}
      description={tr("schedule.imported.boundary.description")}
      items={[
        {
          id: "source-kind",
          label: tr("schedule.imported.sourceKind"),
          value: sourceKindLabel(kind),
          detail: tr("schedule.imported.sourceKindDetail"),
        },
        {
          id: "workflow-state",
          label: tr("schedule.imported.workflowState"),
          value: scheduleState(item),
          detail: tr("schedule.imported.workflowStateDetail"),
        },
        {
          id: "original-version",
          label: tr("schedule.imported.originalVersion"),
          value: detail ? `v${detail.record.version}` : tr("schedule.imported.loading"),
          detail: tr("schedule.imported.originalVersionDetail"),
        },
      ]}
    />
    <div className="meta-grid mt-3">
      <div><span>{tr("schedule.imported.inputMode")}</span><strong>{display(metadata.inputMode)}</strong></div>
      <div><span>{tr("schedule.imported.parserVersion")}</span><strong>{display(metadata.parserVersion)}</strong></div>
      <div><span>{tr("schedule.imported.sourceEvidence")}</span><strong className="break-all">{display(metadata.sourceEvidenceRef)}</strong></div>
      <div><span>{tr("schedule.imported.activityCount")}</span><strong>{display(currentData.activityCount ?? detail?.activities.length)}</strong></div>
    </div>
    {kind === "recovery" && (
      <div className="schedule-source-note" role="note">
        <strong>{tr("schedule.imported.recoveryTitle")}</strong>
        <span>{tr("schedule.imported.recoveryDescription")}</span>
      </div>
    )}
    {loading && (
      <div className="empty compact">{tr("schedule.imported.loadingDetail")}</div>
    )}
    {error && <div role="alert" className="error-box">{error}</div>}
    {detail && <>
      <section className="detail-section" aria-label={tr("schedule.imported.originalAria")}>
        <SectionHeader
          title={tr("schedule.imported.originalTitle")}
          meta={sourceKindLabel(originalData.scheduleKind)}
        />
        <dl className="grid gap-3 sm:grid-cols-2">
          {Object.entries(originalData).map(([key, value]) => (
            <div key={key} className="min-w-0 border-b border-border pb-2">
              <dt className="text-xs text-slate-500">{fields[key] || key}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-all text-xs">{display(value)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="detail-section" aria-label={tr("schedule.imported.activityAria")}>
        <SectionHeader
          title={tr("schedule.imported.activityTitle")}
          meta={`${tr("schedule.count", { count: detail.activities.length })} · read-only`}
        />
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
                <div><dt>{tr("schedule.activity.plan")}</dt><dd>{display(data.plannedStartAt)} → {display(data.plannedFinishAt)}</dd></div>
                <div><dt>{tr("schedule.activity.actual")}</dt><dd>{display(data.actualStartAt)} → {display(data.actualFinishAt)}</dd></div>
                <div><dt>{tr("schedule.activity.forecast")}</dt><dd>{display(data.forecastStartAt)} → {display(data.forecastFinishAt)}</dd></div>
                <div><dt>{tr("schedule.activity.progressFloat")}</dt><dd>{display(data.percentComplete)} / {display(data.totalFloat)}</dd></div>
                <div><dt>{tr("schedule.activity.predecessor")}</dt><dd>{display(data.predecessorRefs)}</dd></div>
                <div><dt>{tr("schedule.activity.successor")}</dt><dd>{display(data.successorRefs)}</dd></div>
              </dl>
            </article>;
          })}
        </div>
      </section>
    </>}
    <section className="detail-section">
      <SectionHeader title={tr("schedule.imported.commandsTitle")} />
      <p className="muted">{tr("schedule.imported.commandsDescription")}</p>
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
      if (!online) throw new Error(tr("schedule.error.offline"));
      if (!title.trim()) throw new Error(tr("schedule.error.titleRequired"));
      if (requiresEvidence && !selectedEvidenceId) {
        throw new Error(tr("schedule.error.evidenceRequired"));
      }
      const data: Record<string, unknown> = {};
      for (const [key, spec] of Object.entries(schema.fields)) {
        const text = values[key]?.trim();
        if (!text) continue;
        if (spec.type === "number" || spec.type === "integer") {
          const n = Number(text);
          if (!Number.isFinite(n) || (spec.type === "integer" && !Number.isInteger(n))) {
            throw new Error(
              tr("schedule.error.numberRequired", {
                field: fields[key] || key,
              }),
            );
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
          throw new Error(
            tr("schedule.error.fieldRequired", {
              field: fields[key] || key,
            }),
          );
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
      setError(e instanceof ApiError ? reasonLabel(e.detail.code) : String(e));
    } finally {
      setBusy(false);
    }
  }

  function input(key: string) {
    const spec = schema.fields[key];
    return <label key={key}>{fields[key] || key}{schema.required.includes(key) ? " *" : ""}
      {spec.type === "boolean" || spec.enum ? (
        <select value={values[key] || ""} onChange={(e) => setValues({ ...values, [key]: e.target.value })}>
          <option value="">{tr("schedule.select")}</option>
          {(spec.enum || ["false", "true"]).map((value) => (
            <option value={value} key={value}>
              {value === "true"
                ? i18n.t("common.yes")
                : value === "false"
                  ? i18n.t("common.no")
                  : value}
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
              ? tr("schedule.placeholder.jsonRef")
              : key.endsWith("At") || key === "dataDate"
                ? tr("schedule.placeholder.time")
                : fields[key] || key
          }
        />
      )}
    </label>;
  }

  return <div className="modal-backdrop">
    <section
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={tr("schedule.create.dialogAria")}
    >
      <div className="section-heading">
        <h2>{tr("schedule.create.title", { tab: tabLabel(machine) })}</h2>
        <button aria-label={tr("schedule.closeAria")} onClick={onClose} disabled={busy}>×</button>
      </div>
      <p className="muted">{tr("schedule.create.description")}</p>
      <div className="modal-fields">
        <label>{tr("schedule.create.titleField")}<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        {requiresEvidence && <label>{tr("schedule.create.evidenceField")}<select aria-label={tr("schedule.create.evidenceAria")} value={selectedEvidenceId} onChange={(e) => setSelectedEvidenceId(e.target.value)}>
          <option value="">{tr("schedule.create.evidenceSelect")}</option>
          {evidenceItems.map((item) => <option key={item.record.id} value={item.record.id}>{recordTitle(item.record)} · {item.record.id}</option>)}
        </select><small className="muted">{evidenceItems.length
          ? tr("schedule.create.evidenceAvailable")
          : tr("schedule.create.evidenceUnavailable")}</small></label>}
        {schema.required.filter((key) => key !== "scheduleKind").map(input)}
      </div>
      <details>
        <summary>{tr("schedule.create.additional")}</summary>
        <div className="modal-fields">
          {Object.keys(schema.fields).filter((key) => !schema.required.includes(key)).map(input)}
        </div>
      </details>
      {error && <div role="alert" className="error-box">{error}</div>}
      <div className="modal-actions">
        <button className="secondary" disabled={busy} onClick={onClose}>
          {tr("schedule.cancel")}
        </button>
        <button className="primary" disabled={busy || !online || (requiresEvidence && !selectedEvidenceId)} onClick={() => void submit()}>
          {busy ? tr("schedule.validating") : tr("schedule.create.submit")}
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
    throw new Error(tr("schedule.parser.invalidJson"));
  }
  const document = object(parsed);
  const keys = Object.keys(document).sort();
  const expected = [...scheduleSourceImport.documentProperties].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(tr("schedule.parser.documentShape"));
  }
  const schedule = object(document.schedule);
  if (!Object.keys(schedule).length) {
    throw new Error(tr("schedule.parser.scheduleRequired"));
  }
  for (const key of scheduleSourceImport.scheduleExcludes) {
    if (key in schedule) {
      throw new Error(tr("schedule.parser.excluded", { key }));
    }
  }
  for (const key of ["scheduleNo", "scheduleKind", "revision", "sourceFormat", "sourceFileVersion"]) {
    if (typeof schedule[key] !== "string" || !String(schedule[key]).trim()) {
      throw new Error(tr("schedule.parser.scheduleValueRequired", { key }));
    }
  }
  if (!(schedule.scheduleKind as string in scheduleSourceImport.kinds)) {
    throw new Error(tr("schedule.parser.kindInvalid"));
  }
  if (schedule.sourceFormat !== scheduleSourceImport.inputMode) {
    throw new Error(
      tr("schedule.parser.formatInvalid", {
        format: scheduleSourceImport.inputMode,
      }),
    );
  }
  if (!Array.isArray(document.activities) || document.activities.length === 0) {
    throw new Error(tr("schedule.parser.activitiesRequired"));
  }
  const activities = document.activities.map((raw, index) => {
    const activity = object(raw);
    const invalid = Object.keys(activity).filter(
      (key) => !scheduleSourceImport.activityProperties.includes(
        key as typeof scheduleSourceImport.activityProperties[number],
      ),
    );
    if (invalid.length) {
      throw new Error(
        tr("schedule.parser.activityMetadata", {
          index,
          fields: invalid.join(", "),
        }),
      );
    }
    const data = object(activity.data);
    for (const key of ["activityId", "wbsPath", "activityName"]) {
      if (typeof data[key] !== "string" || !String(data[key]).trim()) {
        throw new Error(
          tr("schedule.parser.activityDataRequired", {
            index,
            key,
          }),
        );
      }
    }
    for (const key of ["predecessorActivityIds", "successorActivityIds"] as const) {
      const value = activity[key];
      if (value !== undefined && (!Array.isArray(value) || value.some((id) => typeof id !== "string"))) {
        throw new Error(
          tr("schedule.parser.activityArrayRequired", {
            index,
            key,
          }),
        );
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
    throw new Error(tr("schedule.parser.criticalRequired"));
  }
  const critical = activities.find((activity) => activity.data.activityId === document.criticalActivityId);
  if (!critical || critical.data.critical !== true) {
    throw new Error(tr("schedule.parser.criticalMismatch"));
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
  const [stage, setStage] = useState(() => tr("schedule.import.stage.select"));
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
    setStage(
      next
        ? tr("schedule.import.stage.validate")
        : tr("schedule.import.stage.select"),
    );
    identity.current = null;
    if (!next) return;
    try {
      const bytes = new Uint8Array(await next.arrayBuffer());
      setPreview(parseNormalizedSource(bytes));
      setStage(tr("schedule.import.stage.ready"));
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
      setStage(tr("schedule.import.stage.check"));
    }
  }

  async function submit() {
    setError("");
    setBusy(true);
    try {
      if (!online) throw new Error(tr("schedule.error.offline"));
      if (client.kind === "mock") {
        throw new Error(tr("schedule.import.error.mock"));
      }
      if (!title.trim()) throw new Error(tr("schedule.error.titleRequired"));
      if (!file || !preview) {
        throw new Error(tr("schedule.import.error.fileRequired"));
      }
      if (!client.session) {
        throw new Error(tr("schedule.import.error.loginRequired"));
      }

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

      setStage(tr("schedule.import.stage.preserve"));
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
          throw new Error(tr("schedule.import.error.uploadRef"));
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
      setStage(tr("schedule.import.stage.generate"));
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
      setStage(tr("schedule.import.stage.complete"));
      await onImported(result.record.id);
    } catch (e) {
      setError(e instanceof ApiError ? reasonLabel(e.detail.code) : e instanceof Error ? e.message : String(e));
      setStage(tr("schedule.import.stage.review"));
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop">
    <section
      className="modal schedule-source-modal"
      role="dialog"
      aria-modal="true"
      aria-label={tr("schedule.import.dialogAria")}
    >
      <div className="section-heading">
        <h2>{tr("schedule.import.title")}</h2>
        <button aria-label={tr("schedule.closeAria")} onClick={onClose} disabled={busy}>×</button>
      </div>
      <div className="schedule-source-contract" role="note">
        <strong>{tr("schedule.import.supportTitle")}</strong>
        <span>{scheduleSourceImport.inputMode} · {scheduleSourceImport.parserVersion}</span>
        <small>{tr("schedule.import.parserUnsupported")}</small>
      </div>
      <div className="modal-fields">
        <label>{tr("schedule.create.titleField")}<input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} /></label>
        <label>{tr("schedule.import.jsonField")}
          <input
            aria-label={tr("schedule.import.jsonAria")}
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => void inspectFile(e.target.files?.[0] || null)}
          />
        </label>
      </div>
      {file && <div className="schedule-source-file">
        <strong>{file.name}</strong>
        <span>{formatNumber(file.size)} bytes</span>
      </div>}
      {preview && <div className="meta-grid schedule-source-preview" data-ui-component="schedule-source-preview">
        <div><span>{tr("schedule.import.preview.sourceKind")}</span><strong>{sourceKindLabel(preview.schedule.scheduleKind)}</strong></div>
        <div><span>{tr("schedule.import.preview.scheduleNo")}</span><strong>{display(preview.schedule.scheduleNo)}</strong></div>
        <div><span>{tr("schedule.import.preview.revision")}</span><strong>{display(preview.schedule.revision)}</strong></div>
        <div><span>{tr("schedule.import.preview.activity")}</span><strong>{tr("schedule.count", { count: preview.activities.length })}</strong></div>
        <div><span>Critical Activity</span><strong>{preview.criticalActivityId}</strong></div>
        <div><span>{tr("schedule.import.preview.sourceFormat")}</span><strong>{display(preview.schedule.sourceFormat)}</strong></div>
      </div>}
      {(busy || progress > 0) && <div className="schedule-source-progress" aria-live="polite">
        <div><strong>{stage}</strong><span>{progress}%</span></div>
        <progress max={100} value={progress} />
      </div>}
      {fileError && <div role="alert" className="error-box">{fileError}</div>}
      {error && <div role="alert" className="error-box">{error}</div>}
      <p className="muted">{tr("schedule.import.description")}</p>
      <div className="modal-actions">
        <button className="secondary" disabled={busy} onClick={onClose}>{tr("schedule.cancel")}</button>
        <button className="primary" disabled={busy || !online || !preview || client.kind === "mock"} onClick={() => void submit()}>
          {busy ? stage : tr("schedule.import.submit")}
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
          {tabs.map((tabItem) => (
            <TabsTrigger
              key={tabItem.id}
              value={tabItem.id}
              className="min-h-11 flex-none px-3 text-xs"
            >
              {tr(tabItem.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
        <p className="px-4 py-3 text-xs text-slate-500">
          {tr(tab.descriptionKey)}
        </p>
      </Tabs>
      <WorkbenchTemplate hasDetail={Boolean(item)}>
        <Panel className="list-pane">
          <SectionHeader
            title={tr(tab.labelKey)}
            meta={tr("schedule.count", { count: items.length })}
          />
          <div className="schedule-list-actions">
            <ActionButton
              disabled={!online || client.kind === "mock"}
              onClick={() => setImporting(true)}
            >
              {tr("schedule.page.importAction")}
            </ActionButton>
            {active !== SOURCE_TAB && (
              <ActionButton
                disabled={!online || client.kind === "mock"}
                onClick={() => setCreating(true)}
              >
                {tr("schedule.page.createAction")}
              </ActionButton>
            )}
          </div>
          {client.kind === "mock" && active === SOURCE_TAB && (
            <p className="muted">{tr("schedule.page.mockNoImport")}</p>
          )}
          <RecordList
            statusLabel={active === SOURCE_TAB
              ? (x) => sourceKindLabel(sourceData(x).scheduleKind)
              : scheduleState}
            contextLabel={(x) =>
              `${x.record.packageId || tr("schedule.page.scopeUnknown")} · ${x.record.discipline || tr("schedule.page.disciplineUnknown")}`
            }
            items={items}
            selected={selected}
            onSelect={(x) => onSelect(x.record.id)}
          />
        </Panel>
        <DetailPane>
          {!item ? (
            <div className="empty compact">
              <h2>{tr("schedule.page.detailTitle", { tab: tr(tab.labelKey) })}</h2>
              <p>
                {active === SOURCE_TAB
                  ? tr("schedule.page.emptySource")
                  : tr("schedule.page.emptyRecord")}
              </p>
            </div>
          ) : <>
            <button className="mobile-back" onClick={() => onSelect(null)}>
              {tr("schedule.page.back")}
            </button>
            <div className="detail-head">
              <div>
                <span className="eyebrow">{tr(tab.labelKey)}</span>
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
                <SectionHeader
                  title={tr("schedule.page.actionsTitle")}
                  meta={tr("schedule.page.actionsMeta")}
                />
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
                  <div className="empty compact">
                    {tr("schedule.page.noActions")}
                  </div>
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
