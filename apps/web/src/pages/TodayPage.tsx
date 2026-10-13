import { useTranslation } from "react-i18next";
import type { SupervisionClient } from "../data/supervision-client";
import { TodayDrawingActivity } from "./TodayDrawingActivity";
import type { HumanRole, WorkItem, Workspace } from "../data/ui-contract";
import { auditCommandLabel, states } from "../labels";
import { KpiCard, Panel, SectionHeader } from "../ui";
import "./fieldwire-today-compact.css";
import { AuditTimeline } from "../ui/catalog";
import { DashboardTemplate } from "../ui/templates";
import { ResizableWorkspace } from "../ui/ResizableWorkspace";
import { PageBoundary } from "./PageBoundary";
import { Icon, RecordList } from "./shared";
import { formatTime } from "../i18n/format";

export interface TodayPageProps {
  role: HumanRole;
  workspace: Workspace;
  client: SupervisionClient;
  onOpenDrawingPin: (sheetId: string, pinId: string) => void;
  allowedRoutes: readonly string[];
  onNavigate: (route: string) => void;
  onOpenItem: (item: WorkItem) => void;
}

export function TodayPage({
  role,
  workspace,
  client,
  onOpenDrawingPin,
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
        {["SUP", "CON", "ADM"].includes(role) && <section className="panel flex flex-wrap items-center gap-2 p-2" data-ui-component="quick-create-launcher">
          <h2 className="font-semibold">{t("today.quick.title")}</h2>
          <p className="today-quick-help text-sm text-muted-foreground">{t("today.quick.description")}</p>
          <div className="today-quick-actions flex flex-wrap gap-2">
            {allowedRoutes.includes("capture") && <button type="button" className="primary" style={{ minHeight: 44 }} onClick={() => onNavigate("capture")}>{t("today.quick.capture")}</button>}
            {role === "CON" && allowedRoutes.includes("inspections") && <button type="button" className="secondary" style={{ minHeight: 44 }} onClick={() => onNavigate("inspections")}>{t("today.quick.inspection")}</button>}
            {role !== "CON" && allowedRoutes.includes("corrections") && <button type="button" className="secondary" style={{ minHeight: 44 }} onClick={() => onNavigate("actions")}>{t("today.quick.action")}</button>}
          </div>
        </section>}
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
            {allowedRoutes.includes("drawings") && client.kind === "http" &&
              <TodayDrawingActivity key={workspace.project.id + ":" + workspace.role.id}
                client={client} onOpenPin={onOpenDrawingPin} />}
          </Panel>
          <div className="right-stack">
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
