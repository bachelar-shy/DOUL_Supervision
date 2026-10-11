import { useTranslation } from "react-i18next";
import type { HumanRole, WorkItem, Workspace } from "../data/ui-contract";
import { auditCommandLabel, states } from "../labels";
import { KpiCard, Panel, SectionHeader } from "../ui";
import { AuditTimeline, DecisionPanel } from "../ui/catalog";
import { DashboardTemplate } from "../ui/templates";
import { ResizableWorkspace } from "../ui/ResizableWorkspace";
import { PageBoundary } from "./PageBoundary";
import { Icon, RecordList } from "./shared";
import { formatTime } from "../i18n/format";

export interface TodayPageProps {
  role: HumanRole;
  workspace: Workspace;
  allowedRoutes: readonly string[];
  onNavigate: (route: string) => void;
  onOpenItem: (item: WorkItem) => void;
}

export function TodayPage({
  role,
  workspace,
  allowedRoutes,
  onNavigate,
  onOpenItem,
}: TodayPageProps) {
  const { t } = useTranslation();
  const items = workspace.items;
  const kpis: Array<[string, number, string]> = [
    [
      t("today.kpi.inspectionPending"),
      items.filter(
        (x) =>
          x.machine === "inspection" &&
          !["completed", "cancelled"].includes(x.record.status || ""),
      ).length,
      "inspections",
    ],
    [
      t("today.kpi.openIssues"),
      items.filter(
        (x) => x.machine === "issue" && x.record.status !== "closed",
      ).length,
      "issues",
    ],
    [
      t("today.kpi.correctiveActions"),
      items.filter(
        (x) => x.machine === "action" && x.record.status !== "closed",
      ).length,
      "actions",
    ],
    [
      t("today.kpi.ownerReceiptDecision"),
      items.filter(
        (x) =>
          ["report", "decision"].includes(x.machine) &&
          x.record.status !== "closed",
      ).length,
      "owner",
    ],
  ];

  const priorityItems = items.filter((x) =>
    role === "OWN"
      ? ["report", "decision"].includes(x.machine)
      : role === "DES"
        ? x.machine === "rfi"
        : ["inspection", "action"].includes(x.machine),
  );

  return (
    <PageBoundary name="today">
      <DashboardTemplate>
        <div className="kpi-grid">
          {kpis.map(([label, value, route], index) => (
            <KpiCard
              key={label}
              label={label}
              value={value}
              className={"kpi-" + index}
              onClick={() =>
                allowedRoutes.includes(route) && onNavigate(route)
              }
              meta={
                <>
                  {t("today.meta.currentAccess")} <Icon name="arrow" />
                </>
              }
            />
          ))}
        </div>
        <ResizableWorkspace kind="dashboard" layoutId="today" className="work-grid">
          <Panel>
            <SectionHeader
              title={
                role === "OWN"
                  ? t("today.priority.owner")
                  : role === "DES"
                    ? t("today.priority.designer")
                    : t("today.priority.default")
              }
              meta={t("today.meta.currentState")}
            />
            <RecordList items={priorityItems} onSelect={onOpenItem}
              contextLabel={(item) => workspace.locations?.find(
                location => location.id === item.record.locationId,
              )?.name ?? item.record.locationId ?? t("record.context.sample")} />
          </Panel>
          <div className="right-stack">
            <DecisionPanel
              eyebrow={t("today.guard.eyebrow")}
              title={
                <>
                  {t("today.guard.line1")}
                  <br />
                  {t("today.guard.line2")}
                </>
              }
              description={t("today.guard.description")}
              action={
                <button
                  className="text-button"
                  onClick={() =>
                    onNavigate(role === "OWN" ? "owner" : "inspections")
                  }
                >
                  {t("today.guard.action")} <Icon name="arrow" />
                </button>
              }
            />
            <Panel>
              <SectionHeader
                title={t("today.audit.title")}
                meta={t("today.audit.meta")}
              />
              <AuditTimeline
                entries={workspace.audit
                  .slice(-5)
                  .reverse()
                  .map((x) => ({
                    id: x.id,
                    title: auditCommandLabel(x.command),
                    meta: (
                      <>
                        {formatTime(x.at)} ·{" "}
                        {states[x.afterState] || t("audit.stateUnknown")}
                      </>
                    ),
                  }))}
              />
            </Panel>
          </div>
        </ResizableWorkspace>
      </DashboardTemplate>
    </PageBoundary>
  );
}
