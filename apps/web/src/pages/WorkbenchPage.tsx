import type {
  CommandDescriptor,
  HumanRole,
  WorkItem,
  Workspace,
} from "../data/ui-contract";
import { commands, reasonLabel, states } from "../labels";
import { EmptyState, StatusBadge } from "../ui";
import { ActionGate, DetailPane } from "../ui/catalog";
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
  onCreateInspection: () => Promise<void>;
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
  onCreateInspection,
  onCreateIssue,
}: WorkbenchPageProps) {
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
            <h2>{routes.find((x) => x.id === route)?.label} 목록</h2>
            <span>{visibleItems.length}건</span>
          </div>
          {route === "inspections" && role === "CON" && (
            <button
              className="secondary wide"
              onClick={() => void onCreateInspection()}
            >
              예시 자체검측 추가
            </button>
          )}
          <RecordList
            items={visibleItems}
            selected={selected}
            onSelect={(item) => onSelect(item.record.id)}
          />
        </section>
        <DetailPane>
          {current ? (
            <>
              <button
                className="mobile-back text-button"
                onClick={() => onSelect(null)}
              >
                ← 목록
              </button>
              <div className="detail-head">
                <span className="eyebrow">
                  {machineLabels[current.machine]} ·{" "}
                  {current.record.id.slice(0, 8)}
                </span>
                <StatusBadge status={current.record.status}>
                  {states[current.record.status || ""] ||
                    current.record.status ||
                    "원본 보존"}
                </StatusBadge>
              </div>
              <h2 className="detail-title">{recordTitle(current.record)}</h2>
              <div className="meta-grid">
                <div>
                  <small>위치</small>
                  <b>A동 2층 / C-5</b>
                </div>
                <div>
                  <small>원본 버전</small>
                  <b>v{current.record.version}</b>
                </div>
                <div>
                  <small>관련 증빙</small>
                  <b>{current.record.evidenceIds?.length || 0}건</b>
                </div>
                <div>
                  <small>담당 범위</small>
                  <b>건축 / 시범 패키지</b>
                </div>
              </div>

              {current.machine === "inspection" && (
                <>
                  <FloorPlan />
                  <div className="gate-grid">
                    <div>
                      <small>검측 판정</small>
                      <b>
                        {current.record.resultStatus === "pass"
                          ? "적합"
                          : current.record.resultStatus === "fail"
                            ? "부적합"
                            : "미판정"}
                      </b>
                    </div>
                    <div>
                      <small>필수확인점</small>
                      <b>{current.record.holdPoint ? "Hold 적용" : "일반"}</b>
                    </div>
                    <div
                      className={
                        current.record.nextWorkAllowed ? "good" : "warn"
                      }
                    >
                      <small>후속공정</small>
                      <b>
                        {current.record.nextWorkAllowed
                          ? "허용"
                          : "아직 허용되지 않음"}
                      </b>
                    </div>
                  </div>
                </>
              )}

              {current.machine === "observation" && (
                <div className="notice">
                  <strong>관찰 확인 ≠ 공식 이슈 발행</strong>
                  <p>
                    음성의 주장과 실제 관찰·측정 근거를 구분하십시오. 이 예시는
                    측정기록에 연결된 사람 입력이며, 영상 AI 분석 결과가 아닙니다.
                  </p>
                  <div className="tags">
                    <span>원본 근거 연결</span>
                    <span>AI 서비스 미연결</span>
                  </div>
                </div>
              )}

              {current.machine === "issue" && (
                <div className="notice">
                  <strong>
                    시정 주기 {Number(current.record.correctionCycle || 0) + 1}
                  </strong>
                  <p>
                    현재 주기의 조치 검증 · 새 재검측 · 해당 버전의 서명을 모두
                    확인해야 종결할 수 있습니다.
                  </p>
                  <p>
                    연결 검측 {current.record.inspectionIds?.length || 0}건 /
                    시정조치 {current.record.actionIds?.length || 0}건
                  </p>
                </div>
              )}

              {current.record.report && (
                <div className="report-body">
                  <h3>현황</h3>
                  <p>{current.record.report.facts}</p>
                  <h3>원인</h3>
                  <p>{current.record.report.cause}</p>
                  <h3>감리 권고</h3>
                  <p>{current.record.report.recommendation}</p>
                  <div className="notice">
                    수령 확인 → 결정·조치 → 이행검증 → 종결. 읽음/수령을
                    승인으로 처리하지 않습니다.
                  </div>
                </div>
              )}

              {current.machine === "rfi" && (
                <div className="notice">
                  <strong>RFI 답변은 설계변경 승인이 아닙니다.</strong>
                  <p>
                    {String(
                      current.record.data?.question ||
                        "질의 근거를 확인하십시오.",
                    )}
                  </p>
                </div>
              )}

              <h3 className="subheading">현재 가능한 업무</h3>
              <ActionGate
                actions={current.actions.map((action) => ({
                  id: action.command,
                  label: commands[action.command] || action.command,
                  primary: ["close", "pass", "issue", "decide"].includes(
                    action.command,
                  ),
                  disabled:
                    !online || (!action.ready && !action.requiresInput),
                  reason:
                    action.blockedReason && !action.requiresInput
                      ? reasonLabel(action.blockedReason.code)
                      : action.requiresInput
                        ? "입력 후 서버에서 선행조건을 다시 확인합니다."
                        : undefined,
                  onAction: () => onOpenCommand(current, action),
                }))}
              />

              {!current.actions.length && (
                <p className="muted">
                  이 역할에서 실행할 수 있는 상태전이가 없습니다.
                </p>
              )}

              {current.machine === "observation" &&
                current.record.status === "confirmed" &&
                role === "SUP" && (
                  <button
                    className="primary wide"
                    onClick={() => void onCreateIssue(current)}
                    disabled={!online}
                  >
                    확인된 관찰로 공식 이슈 발행
                  </button>
                )}

              <details className="technical">
                <summary>연결 원본 · 버전 확인</summary>
                <pre>{JSON.stringify(current.record, null, 2)}</pre>
              </details>
            </>
          ) : (
            <EmptyState
              title="확인할 업무를 선택하십시오."
              description="목록과 원본, 허용된 동작을 함께 확인합니다."
              action={<Icon name="check" />}
            />
          )}
        </DetailPane>
      </WorkbenchLayout>
    </PageBoundary>
  );
}
