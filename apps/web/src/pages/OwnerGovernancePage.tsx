import { recordVersionLabel } from "../labels";
import { X } from "lucide-react";
import type { CommandDescriptor, RecordDTO, WorkItem, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { OwnerDecisionAuthoringPanel } from "./OwnerDecisionAuthoringPanel";
import { describeCommandAvailability } from "../data/ui-presentation";
import { commands, states } from "../labels";
import { EmptyState, StatusBadge } from "../ui";
import { ActionGate, OwnerDecisionPanel, StatusBoundaryGroup } from "../ui/catalog";
import { OwnerReportTemplate } from "../ui/templates";
import { PageBoundary } from "./PageBoundary";
import { RecordList } from "./shared";
import { recordTitle } from "./record-utils";
import { formatDateTime, formatNumber } from "../i18n/format";
import i18n from "../i18n/config";

function tr(
  key: string,
  values: Record<string, string | number | boolean> = {},
) {
  return i18n.t(key, values);
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return tr("owner.value.noInfo");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDateTime(date);
}

function impactRows(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([key, item]) => ({
    label: tr(`owner.impact.${key}`, { defaultValue: key }),
    value:
      item === null || item === undefined || item === ""
        ? tr("owner.value.noInfo")
        : typeof item === "number"
          ? formatNumber(item)
          : typeof item === "boolean"
            ? tr(item ? "common.yes" : "common.no")
            : typeof item === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(item)
              ? formatDate(item)
              : String(item),
  }));
}

export interface OwnerGovernancePageProps {
  client: SupervisionClient;
  onCreated: (record: RecordDTO) => Promise<void>;
  workspace: Workspace;
  selected: string | null;
  current: WorkItem | null;
  online: boolean;
  onSelect: (id: string | null) => void;
  onOpenCommand: (item: WorkItem, action: CommandDescriptor) => void;
}

export function OwnerGovernancePage({
  client,
  onCreated,
  workspace,
  selected,
  current,
  online,
  onSelect,
  onOpenCommand,
}: OwnerGovernancePageProps) {
  const items = workspace.items.filter((item) =>
    ["report", "decision"].includes(item.machine),
  );
  const ownerCurrent =
    current && ["report", "decision"].includes(current.machine) ? current : null;

  const receiptReady = items.filter((item) =>
    item.actions.some((action) => action.command === "acknowledge" && action.ready),
  ).length;
  const decisionReady = items.filter((item) =>
    item.actions.some((action) => action.command === "decide" && action.ready),
  ).length;
  const verifyReady = items.filter((item) =>
    item.actions.some(
      (action) => ["verify", "close"].includes(action.command) && action.ready,
    ),
  ).length;

  const detail = ownerCurrent?.record;
  const report = detail?.report;
  const impact = report?.impact ?? detail?.impact;
  const options = Array.isArray(detail?.options) ? detail.options : [];
  const receiptAction = ownerCurrent?.actions.find(
    (action) => action.command === "acknowledge",
  );
  const decisionAction = ownerCurrent?.actions.find(
    (action) => action.command === "decide",
  );
  const receiptPresentation = receiptAction
    ? describeCommandAvailability(receiptAction, online)
    : null;
  const decisionPresentation = decisionAction
    ? describeCommandAvailability(decisionAction, online)
    : null;

  return (
    <PageBoundary name="owner" data-owner-governance="true">
      <OwnerDecisionAuthoringPanel client={client} workspace={workspace} online={online} onCreated={onCreated} />
      <div
        className="grid gap-3 md:grid-cols-3"
        data-ui-component="owner-governance-summary"
      >
        <div className="panel rounded-sm border-t-2 border-t-slate-300 p-4">
          <span className="eyebrow">{tr("owner.summary.receipt.label")}</span>
          <strong className="mt-2 block text-2xl font-semibold text-slate-900">
            {receiptReady}
          </strong>
          <small className="mt-1 block text-slate-500">
            {tr("owner.summary.receipt.description")}
          </small>
        </div>
        <div className="panel rounded-sm border-t-2 border-t-primary p-4">
          <span className="eyebrow">{tr("owner.summary.decision.label")}</span>
          <strong className="mt-2 block text-2xl font-semibold text-slate-900">
            {decisionReady}
          </strong>
          <small className="mt-1 block text-slate-500">
            {tr("owner.summary.decision.description")}
          </small>
        </div>
        <div className="panel rounded-sm border-t-2 border-t-slate-700 p-4">
          <span className="eyebrow">{tr("owner.summary.verify.label")}</span>
          <strong className="mt-2 block text-2xl font-semibold text-slate-900">
            {verifyReady}
          </strong>
          <small className="mt-1 block text-slate-500">
            {tr("owner.summary.verify.description")}
          </small>
        </div>
      </div>

      <div
        className="mt-3 rounded-sm border border-border bg-card px-4 py-3 text-[10px] leading-5 text-slate-500"
        data-ui-component="owner-governance-flow"
      >
        <strong className="mr-2 text-slate-700">
          {tr("owner.flow.title")}
        </strong>
        {tr("owner.flow.steps")}
        <span className="ml-2 text-slate-400">
          {tr("owner.flow.warning")}
        </span>
      </div>

      <OwnerReportTemplate hasDetail={!!ownerCurrent} className="mt-3">
        <section className="panel list-pane">
          <div className="section-heading">
            <h2>{tr("owner.queue.title")}</h2>
            <span>{tr("common.count", { count: items.length })}</span>
          </div>
          <RecordList
            items={items}
            selected={selected}
            onSelect={(item) => onSelect(item.record.id)}
          />
        </section>

        <OwnerDecisionPanel>
          {ownerCurrent ? (
            <>
              <button
                className="mobile-back text-button"
                onClick={() => onSelect(null)}
              >
                {tr("owner.back")}
              </button>

              <div className="detail-head">
                <span className="eyebrow">
                  {ownerCurrent.machine === "report"
                    ? tr("owner.type.report")
                    : tr("owner.type.decision")} ·{" "}
                  {detail?.id.slice(0, 8)}
                </span>
                <div className="flex min-w-0 shrink-0 items-center gap-2">
                  <StatusBadge status={detail?.status}>
                    {states[detail?.status || ""] ||
                      detail?.status ||
                      tr("owner.value.noStatus")}
                  </StatusBadge>
                  <button type="button"
                    className="hidden size-8 items-center justify-center rounded-sm border border-border bg-white text-muted-foreground hover:bg-muted md:inline-flex"
                    data-ui-component="workbench-detail-close"
                    aria-label={tr("owner.back")}
                    title={tr("owner.back")}
                    onClick={() => onSelect(null)}>
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <h2 className="detail-title">{recordTitle(detail!)}</h2>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-sm border border-border bg-slate-50 p-3">
                  <small className="block text-slate-400">
                    {tr("owner.meta.sourceVersion")}
                  </small>
                  <b className="mt-1 block text-sm text-slate-700">{recordVersionLabel(detail?.version)}</b>
                </div>
                <div className="rounded-sm border border-border bg-slate-50 p-3">
                  <small className="block text-slate-400">
                    {tr("owner.meta.evidence")}
                  </small>
                  <b className="mt-1 block text-sm text-slate-700">
                    {tr("common.count", {
                      count: detail?.evidenceIds?.length || 0,
                    })}
                  </b>
                </div>
                <div className="rounded-sm border border-border bg-slate-50 p-3">
                  <small className="block text-slate-400">
                    {ownerCurrent.machine === "report"
                      ? tr("owner.meta.receiptDue")
                      : tr("owner.meta.decisionDue")}
                  </small>
                  <b className="mt-1 block text-[11px] text-slate-700">
                    {formatDate(
                      ownerCurrent.machine === "report"
                        ? report?.receiptDueAt
                        : detail?.dueAt,
                    )}
                  </b>
                </div>
                <div className="rounded-sm border border-border bg-slate-50 p-3">
                  <small className="block text-slate-400">
                    {tr("owner.meta.readyActions")}
                  </small>
                  <b className="mt-1 block text-sm text-slate-700">
                    {tr("common.count", {
                      count: ownerCurrent.actions.filter((action) => action.ready)
                        .length,
                    })}
                  </b>
                </div>
              </div>

              <StatusBoundaryGroup
                className="mt-3"
                title={tr("owner.boundary.title")}
                description={tr("owner.boundary.description")}
                items={[
                  {
                    id: "owner-object-state",
                    label: tr("owner.boundary.objectState.label"),
                    value:
                      states[detail?.status || ""] ||
                      detail?.status ||
                      tr("owner.value.noStatus"),
                    detail:
                      ownerCurrent.machine === "report"
                        ? tr("owner.boundary.objectState.report")
                        : tr("owner.boundary.objectState.decision"),
                  },
                  {
                    id: "owner-receipt",
                    label: tr("owner.boundary.receipt.label"),
                    value:
                      receiptPresentation?.label || tr("owner.value.noCommand"),
                    tone:
                      receiptPresentation?.availability === "ready"
                        ? "positive"
                        : receiptPresentation?.availability === "forbidden"
                          ? "critical"
                          : receiptPresentation?.availability === "blocked"
                            ? "warning"
                            : "neutral",
                    detail: tr("owner.boundary.receipt.detail"),
                  },
                  {
                    id: "owner-decision",
                    label: tr("owner.boundary.decision.label"),
                    value:
                      decisionPresentation?.label || tr("owner.value.noCommand"),
                    tone:
                      decisionPresentation?.availability === "ready"
                        ? "positive"
                        : decisionPresentation?.availability === "forbidden"
                          ? "critical"
                          : decisionPresentation?.availability === "blocked"
                            ? "warning"
                            : "neutral",
                    detail: tr("owner.boundary.decision.detail"),
                  },
                ]}
              />

              {ownerCurrent.machine === "report" ? (
                <div className="report-body mt-5">
                  <h3>{tr("owner.report.facts")}</h3>
                  <p>{report?.facts || tr("owner.value.noInfoCheck")}</p>
                  <h3>{tr("owner.report.cause")}</h3>
                  <p>{report?.cause || tr("owner.value.noInfoCheck")}</p>
                  <h3>{tr("owner.report.recommendation")}</h3>
                  <p>
                    {report?.recommendation || tr("owner.value.noInfoCheck")}
                  </p>
                </div>
              ) : (
                <div className="mt-5">
                  <h3 className="subheading">{tr("owner.decision.options")}</h3>
                  {options.length ? (
                    <div className="grid gap-2">
                      {options.map((option, index) => {
                        const value =
                          option && typeof option === "object"
                            ? (option as Record<string, unknown>)
                            : {};
                        return (
                          <div
                            className="rounded-sm border border-border px-3 py-2 text-xs"
                            key={String(value.id ?? index)}
                          >
                            <strong className="mr-2 text-slate-700">
                              {String(value.id ?? index + 1)}
                            </strong>
                            <span className="text-slate-500">
                              {String(
                                value.description ??
                                  tr("owner.value.noDescription"),
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="muted">
                      {tr("owner.decision.noOptions")}
                    </p>
                  )}
                  {detail?.recommendation ? (
                    <div className="notice mt-3">
                      <strong>{tr("owner.decision.recommendation")}</strong>
                      <p>{String(detail.recommendation)}</p>
                    </div>
                  ) : null}
                </div>
              )}

              {impactRows(impact).length ? (
                <div className="mt-5">
                  <h3 className="subheading">{tr("owner.impact.title")}</h3>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {impactRows(impact).map((row) => (
                      <div
                        key={row.label}
                        className="rounded-sm border border-border bg-slate-50 p-3"
                      >
                        <small className="block text-slate-400">{row.label}</small>
                        <b className="mt-1 block text-[11px] text-slate-700">
                          {row.value}
                        </b>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="notice mt-5">
                <strong>{tr("owner.decisionBoundary.title")}</strong>
                <p>{tr("owner.decisionBoundary.description")}</p>
              </div>

              <h3 className="subheading">{tr("owner.actions.title")}</h3>
              <ActionGate
                actions={ownerCurrent.actions.map((action) => {
                  const presentation = describeCommandAvailability(action, online);
                  return {
                    id: action.command,
                    label: commands[action.command] || action.command,
                    primary: ["acknowledge", "decide", "verify", "close"].includes(
                      action.command,
                    ),
                    disabled: presentation.disabled,
                    availability: presentation.availability,
                    availabilityLabel: presentation.label,
                    reason: presentation.reason,
                    onAction: () => onOpenCommand(ownerCurrent, action),
                  };
                })}
              />
              {!ownerCurrent.actions.length ? (
                <p className="muted">{tr("owner.actions.none")}</p>
              ) : null}

              <details className="technical">
                <summary>{tr("owner.technical.summary")}</summary>
                <pre>{JSON.stringify(detail, null, 2)}</pre>
              </details>
            </>
          ) : (
            <EmptyState
              title={tr("owner.empty.title")}
              description={tr("owner.empty.description")}
            />
          )}
        </OwnerDecisionPanel>
      </OwnerReportTemplate>
    </PageBoundary>
  );
}
