import { recordVersionLabel } from "../labels";
import { RecordDetails } from "./RecordDetails";
import type { SupervisionClient } from "../data/supervision-client";
import { InspectionAuthoringPanel } from "./InspectionAuthoringPanel";
import { InspectionCaseFlowPanel } from "./parallel/InspectionCaseFlowPanel";
import { ActionAuthoringPanel } from "./parallel/ActionAuthoringPanel";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import type {
  CommandDescriptor,
  HumanRole,
  RecordDTO,
  WorkItem,
  Workspace,
} from "../data/ui-contract";
import { describeCommandAvailability } from "../data/ui-presentation";
import { commands, states } from "../labels";
import { EmptyState, StatusBadge } from "../ui";
import { ActionGate, DetailPane, StatusBoundaryGroup } from "../ui/catalog";
import { OwnerReportTemplate, WorkbenchTemplate } from "../ui/templates";
import { machineForRoute, machineLabels, routes } from "../app/routes";
import { PageBoundary } from "./PageBoundary";
import { FloorPlan, Icon, RecordList } from "./shared";
import { recordTitle } from "./record-utils";

export interface WorkbenchPageProps {
  route: string;
  role: HumanRole;
  workspace: Workspace;
  selected: string | null;
  current: WorkItem | null;
  online: boolean;
  onSelect: (id: string | null) => void;
  onOpenCommand: (item: WorkItem, action: CommandDescriptor) => void;
  client: SupervisionClient;
  onChanged: () => Promise<void>;
  onInspectionCreated: (record: RecordDTO) => Promise<void>;
  onActionCreated: (record: RecordDTO) => Promise<void>;
  onCreateIssue: (item: WorkItem) => Promise<void>;
}

export function WorkbenchPage({
  route,
  role,
  workspace,
  selected,
  current,
  online,
  onSelect,
  onOpenCommand,
  client,
  onChanged,
  onInspectionCreated,
  onActionCreated,
  onCreateIssue,
}: WorkbenchPageProps) {
  const { t } = useTranslation();
  const [newInspectionOpen, setNewInspectionOpen] = useState(false);
  const [newActionOpen, setNewActionOpen] = useState(false);
  const routeDefinition = routes.find((item) => item.id === route);
  const routeTitle = routeDefinition
    ? t(routeDefinition.labelKey ?? "", { defaultValue: routeDefinition.label })
    : route;
  const WorkbenchLayout =
    route === "owner" ? OwnerReportTemplate : WorkbenchTemplate;
  const machines = machineForRoute[route] || [];
  const visibleItems = workspace.items.filter((item) =>
    machines.includes(item.machine),
  );

  return (
    <PageBoundary name={route} data-workbench-route={route}>
      <WorkbenchLayout hasDetail={!!current}>
        <section className="panel list-pane">
          <div className="section-heading">
            <h2>{t("workbench.listTitle", { title: routeTitle })}</h2>
            <span>{t("workbench.count", { count: visibleItems.length })}</span>
          </div>
          {route === "inspections" && role === "CON" && (
            <div className="grid gap-2" data-ui-component="new-inspection-entry">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">시공사 자체검측 요청을 새로 작성합니다.</p>
                <button type="button" className="primary" style={{ minHeight: 44 }}
                  aria-expanded={newInspectionOpen} onClick={() => setNewInspectionOpen(value => !value)}>
                  {newInspectionOpen ? "작성 닫기" : "＋ 신규 검측"}
                </button>
              </div>
              {newInspectionOpen && <InspectionAuthoringPanel client={client} workspace={workspace}
                online={online} onCreated={async record => { await onInspectionCreated(record); setNewInspectionOpen(false); }} />}
            </div>
          )}
          {route === "inspections" && role !== "CON" && (
            <p className="rounded border p-3 text-sm" role="note">
              검측 신규 요청은 시공사에서 작성합니다. 감리자는 등록된 요청을 선택해 검측 일정·결과를 처리하고,
              관리자는 배정 및 기록 조회를 관리합니다. 테스트 시에는 로그인 화면에서 시공사 역할을 선택하십시오.
            </p>
          )}
          {route === "actions" && role !== "OWN" && (
            <div className="grid gap-2" data-ui-component="new-action-entry">
              <div className="flex flex-wrap items-center items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">기존 부적합 사항에 연결되는 시정조치 초안을 작성합니다.</p>
                <button type="button" className="primary" style={{ minHeight: 44 }}
                  aria-expanded={newActionOpen} onClick={() => setNewActionOpen(value => !value)}>
                  {newActionOpen ? "작성 닫기" : "＋ 신규 시정조치"}
                </button>
              </div>
              {newActionOpen && <ActionAuthoringPanel client={client} workspace={workspace}
                online={online} onCreated={onActionCreated} />}
            </div>
          )}
          <RecordList
            items={visibleItems}
            selected={selected}
            onSelect={(item) => onSelect(item.record.id)}
          />
          {route === "inspections" && role === "CON" && (
            <InspectionCaseFlowPanel client={client} workspace={workspace} online={online}
              onChanged={onChanged} onSelect={onSelect} onOpenCommand={onOpenCommand} />
          )}
        </section>
        <DetailPane>
          {current ? (
            <>
              <button
                className="mobile-back text-button"
                onClick={() => onSelect(null)}
              >
                {t("workbench.back")}
              </button>
              <div className="detail-head">
                <span className="eyebrow">
                  {machineLabels[current.machine]} ·{" "}
                  {current.record.id.slice(0, 8)}
                </span>
                <StatusBadge status={current.record.status}>
                  {states[current.record.status || ""] ||
                    current.record.status ||
                    t("workbench.originalPreserved")}
                </StatusBadge>
              </div>
              <h2 className="detail-title">{recordTitle(current.record)}</h2>
              <div className="meta-grid">
                <div>
                  <small>{t("workbench.location")}</small>
                  <b>{workspace.locations?.find(location => location.id === current.record.locationId)?.name || current.record.locationId || t("workbench.sampleLocation")}</b>
                </div>
                <div>
                  <small>{t("workbench.originalVersion")}</small>
                  <b>{recordVersionLabel(current.record.version)}</b>
                </div>
                <div>
                  <small>{t("workbench.relatedEvidence")}</small>
                  <b>
                    {t("workbench.count", {
                      count: current.record.evidenceIds?.length || 0,
                    })}
                  </b>
                </div>
                <div>
                  <small>{t("workbench.scope")}</small>
                  <b>{[current.record.discipline, current.record.packageId].filter(Boolean).join(" / ") || t("workbench.sampleScope")}</b>
                </div>
              </div>

              {current.machine === "inspection" && (
                <>
                  <FloorPlan />
                  <StatusBoundaryGroup
                    title={t("workbench.inspectionBoundary.title")}
                    description={t(
                      "workbench.inspectionBoundary.description",
                    )}
                    items={[
                      {
                        id: "inspection-result",
                        label: t("workbench.inspectionBoundary.result"),
                        value:
                          current.record.resultStatus === "pass"
                            ? t("workbench.inspectionBoundary.pass")
                            : current.record.resultStatus === "fail"
                              ? t("workbench.inspectionBoundary.fail")
                              : t("workbench.inspectionBoundary.unjudged"),
                        tone:
                          current.record.resultStatus === "pass"
                            ? "positive"
                            : current.record.resultStatus === "fail"
                              ? "critical"
                              : "neutral",
                        detail: t("workbench.inspectionBoundary.resultDetail"),
                      },
                      {
                        id: "next-work",
                        label: t("workbench.inspectionBoundary.nextWork"),
                        value: current.record.nextWorkAllowed
                          ? t("workbench.inspectionBoundary.allowed")
                          : t("workbench.inspectionBoundary.notAllowed"),
                        tone: current.record.nextWorkAllowed
                          ? "positive"
                          : "warning",
                        detail: t("workbench.inspectionBoundary.nextWorkDetail"),
                      },
                      {
                        id: "hold-point",
                        label: t("workbench.inspectionBoundary.holdPoint"),
                        value: current.record.holdPoint
                          ? t("workbench.inspectionBoundary.holdApplied")
                          : t("workbench.inspectionBoundary.normal"),
                        tone: current.record.holdPoint ? "warning" : "neutral",
                        detail: t("workbench.inspectionBoundary.holdDetail"),
                      },
                    ]}
                  />
                </>
              )}

              {current.machine === "observation" && (
                <div className="notice">
                  <strong>{t("workbench.observation.title")}</strong>
                  <p>{t("workbench.observation.description")}</p>
                  <div className="tags">
                    <span>{t("workbench.observation.originalLinked")}</span>
                    <span>{t("workbench.observation.aiDisconnected")}</span>
                  </div>
                </div>
              )}

              {current.machine === "issue" && (
                <div className="notice">
                  <strong>
                    {t("workbench.issue.cycle", {
                      cycle: Number(current.record.correctionCycle || 0) + 1,
                    })}
                  </strong>
                  <p>{t("workbench.issue.description")}</p>
                  <p>
                    {t("workbench.issue.links", {
                      inspectionCount: current.record.inspectionIds?.length || 0,
                      actionCount: current.record.actionIds?.length || 0,
                    })}
                  </p>
                </div>
              )}

              {current.record.report && (
                <div className="report-body">
                  <h3>{t("workbench.report.facts")}</h3>
                  <p>{current.record.report.facts}</p>
                  <h3>{t("workbench.report.cause")}</h3>
                  <p>{current.record.report.cause}</p>
                  <h3>{t("workbench.report.recommendation")}</h3>
                  <p>{current.record.report.recommendation}</p>
                  <div className="notice">{t("workbench.report.flow")}</div>
                </div>
              )}

              {current.machine === "rfi" && (
                <div className="notice">
                  <strong>{t("workbench.rfi.title")}</strong>
                  <p>
                    {String(
                      current.record.data?.question ||
                        t("workbench.rfi.missingQuestion"),
                    )}
                  </p>
                </div>
              )}

              <h3 className="subheading">{t("workbench.availableActions")}</h3>
              <ActionGate
                actions={current.actions.map((action) => {
                  const presentation = describeCommandAvailability(action, online);
                  return {
                    id: action.command,
                    label: commands[action.command] || action.command,
                    primary: ["close", "pass", "issue", "decide"].includes(
                      action.command,
                    ),
                    disabled: presentation.disabled,
                    availability: presentation.availability,
                    availabilityLabel: presentation.label,
                    reason: presentation.reason,
                    onAction: () => onOpenCommand(current, action),
                  };
                })}
              />

              {!current.actions.length && (
                <p className="muted">{t("workbench.noTransitions")}</p>
              )}

              {current.machine === "observation" &&
                current.record.status === "confirmed" &&
                role === "SUP" && (
                  <button
                    className="primary wide"
                    onClick={() => void onCreateIssue(current)}
                    disabled={!online}
                  >
                    {t("workbench.issueFromObservation")}
                  </button>
                )}

              <details className="technical">
                <summary>{t("workbench.technicalSummary")}</summary>
                <RecordDetails value={current.record} />
              </details>
            </>
          ) : (
            <EmptyState
              title={t("workbench.empty.title")}
              description={t("workbench.empty.description")}
              action={<Icon name="check" />}
            />
          )}
        </DetailPane>
      </WorkbenchLayout>
    </PageBoundary>
  );
}
