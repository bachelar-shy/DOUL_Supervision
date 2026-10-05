import type { HumanRole, WorkItem, Workspace } from "../data/ui-contract";
import { commands, states } from "../labels";
import { KpiCard, Panel, SectionHeader } from "../ui";
import { AuditTimeline, DecisionPanel } from "../ui/catalog";
import { DashboardTemplate } from "../ui/templates";
import { PageBoundary } from "./PageBoundary";
import { Icon, RecordList } from "./shared";

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
  const items = workspace.items;
  const kpis: Array<[string, number, string]> = [
    [
      "검측 대기",
      items.filter(
        (x) =>
          x.machine === "inspection" &&
          !["completed", "cancelled"].includes(x.record.status || ""),
      ).length,
      "inspections",
    ],
    [
      "미종결 이슈",
      items.filter(
        (x) => x.machine === "issue" && x.record.status !== "closed",
      ).length,
      "issues",
    ],
    [
      "시정조치",
      items.filter(
        (x) => x.machine === "action" && x.record.status !== "closed",
      ).length,
      "actions",
    ],
    [
      "발주처 수령·결정",
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
                  현재 조회 권한 기준 <Icon name="arrow" />
                </>
              }
            />
          ))}
        </div>
        <div className="work-grid">
          <Panel>
            <SectionHeader
              title={
                role === "OWN"
                  ? "보고·결정 대기"
                  : role === "DES"
                    ? "설계질의 대기"
                    : "우선 확인할 업무"
              }
              meta="현재 상태"
            />
            <RecordList items={priorityItems} onSelect={onOpenItem} />
          </Panel>
          <div className="right-stack">
            <DecisionPanel
              eyebrow="진행 전 확인"
              title={
                <>
                  적합 판정과
                  <br />
                  후속공정 승인은 다릅니다.
                </>
              }
              description="필수서명과 해당 Hold 승인이 완료되어야 다음 작업을 허용합니다."
              action={
                <button
                  className="text-button"
                  onClick={() =>
                    onNavigate(role === "OWN" ? "owner" : "inspections")
                  }
                >
                  선행조건 확인 <Icon name="arrow" />
                </button>
              }
            />
            <Panel>
              <SectionHeader title="최근 처리 이력" meta="서버 기록" />
              <AuditTimeline
                entries={workspace.audit
                  .slice(-5)
                  .reverse()
                  .map((x) => ({
                    id: x.id,
                    title: commands[x.command.split(":")[1]] || x.command,
                    meta: (
                      <>
                        {new Date(x.at).toLocaleTimeString("ko-KR")} ·{" "}
                        {states[x.afterState] || x.afterState}
                      </>
                    ),
                  }))}
              />
            </Panel>
          </div>
        </div>
      </DashboardTemplate>
    </PageBoundary>
  );
}
