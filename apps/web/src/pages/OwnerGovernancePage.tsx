import type { CommandDescriptor, WorkItem, Workspace } from "../data/ui-contract";
import { describeCommandAvailability } from "../data/ui-presentation";
import { commands, states } from "../labels";
import { EmptyState, StatusBadge } from "../ui";
import { ActionGate, OwnerDecisionPanel, StatusBoundaryGroup } from "../ui/catalog";
import { OwnerReportTemplate } from "../ui/templates";
import { PageBoundary } from "./PageBoundary";
import { RecordList } from "./shared";
import { recordTitle } from "./record-utils";

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "정보 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function impactRows(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([key, item]) => ({
    label:
      key === "quality"
        ? "품질"
        : key === "schedule"
          ? "공정"
          : key === "cost"
            ? "비용"
            : key,
    value: item === null || item === undefined || item === "" ? "정보 없음" : String(item),
  }));
}

export interface OwnerGovernancePageProps {
  workspace: Workspace;
  selected: string | null;
  current: WorkItem | null;
  online: boolean;
  onSelect: (id: string | null) => void;
  onOpenCommand: (item: WorkItem, action: CommandDescriptor) => void;
}

export function OwnerGovernancePage({
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
      <div
        className="grid gap-3 md:grid-cols-3"
        data-ui-component="owner-governance-summary"
      >
        <div className="panel rounded-sm border-t-2 border-t-slate-300 p-4">
          <span className="eyebrow">수령 확인 가능</span>
          <strong className="mt-2 block text-2xl font-semibold text-slate-900">
            {receiptReady}
          </strong>
          <small className="mt-1 block text-slate-500">
            서버가 수령확인 명령을 허용한 항목
          </small>
        </div>
        <div className="panel rounded-sm border-t-2 border-t-primary p-4">
          <span className="eyebrow">결정 가능</span>
          <strong className="mt-2 block text-2xl font-semibold text-slate-900">
            {decisionReady}
          </strong>
          <small className="mt-1 block text-slate-500">
            서버가 결정 명령을 허용한 항목
          </small>
        </div>
        <div className="panel rounded-sm border-t-2 border-t-slate-700 p-4">
          <span className="eyebrow">검증·종결 가능</span>
          <strong className="mt-2 block text-2xl font-semibold text-slate-900">
            {verifyReady}
          </strong>
          <small className="mt-1 block text-slate-500">
            서버가 검증 또는 종결을 허용한 항목
          </small>
        </div>
      </div>

      <div
        className="mt-3 rounded-sm border border-border bg-card px-4 py-3 text-[10px] leading-5 text-slate-500"
        data-ui-component="owner-governance-flow"
      >
        <strong className="mr-2 text-slate-700">발주처 업무 흐름</strong>
        보고 발행 → 수령 확인 → 결정·조치 → 이행 검증 → 종결
        <span className="ml-2 text-slate-400">
          수령 확인은 승인과 다르며, 기한 초과도 자동승인으로 처리하지 않습니다.
        </span>
      </div>

      <OwnerReportTemplate hasDetail={!!ownerCurrent} className="mt-3">
        <section className="panel list-pane">
          <div className="section-heading">
            <h2>보고·결정 대기열</h2>
            <span>{items.length}건</span>
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
                ← 목록
              </button>

              <div className="detail-head">
                <span className="eyebrow">
                  {ownerCurrent.machine === "report" ? "발주처 보고" : "의사결정"} ·{" "}
                  {detail?.id.slice(0, 8)}
                </span>
                <StatusBadge status={detail?.status}>
                  {states[detail?.status || ""] || detail?.status || "상태 없음"}
                </StatusBadge>
              </div>

              <h2 className="detail-title">{recordTitle(detail!)}</h2>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-sm border border-border bg-slate-50 p-3">
                  <small className="block text-slate-400">원본 버전</small>
                  <b className="mt-1 block text-sm text-slate-700">v{detail?.version}</b>
                </div>
                <div className="rounded-sm border border-border bg-slate-50 p-3">
                  <small className="block text-slate-400">관련 증빙</small>
                  <b className="mt-1 block text-sm text-slate-700">
                    {detail?.evidenceIds?.length || 0}건
                  </b>
                </div>
                <div className="rounded-sm border border-border bg-slate-50 p-3">
                  <small className="block text-slate-400">
                    {ownerCurrent.machine === "report" ? "수령 기한" : "결정 기한"}
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
                  <small className="block text-slate-400">현재 실행 가능</small>
                  <b className="mt-1 block text-sm text-slate-700">
                    {ownerCurrent.actions.filter((action) => action.ready).length}건
                  </b>
                </div>
              </div>

              <StatusBoundaryGroup
                className="mt-3"
                title="수령·결정 상태 경계"
                description="수령 확인은 승인이나 결정이 아닙니다. 현재 객체 상태와 서버가 허용한 다음 명령을 별도로 표시합니다."
                items={[
                  {
                    id: "owner-object-state",
                    label: "현재 객체 상태",
                    value:
                      states[detail?.status || ""] ||
                      detail?.status ||
                      "상태 없음",
                    detail:
                      ownerCurrent.machine === "report"
                        ? "보고 객체 상태"
                        : "결정 객체 상태",
                  },
                  {
                    id: "owner-receipt",
                    label: "수령 확인",
                    value: receiptPresentation?.label || "현재 명령 없음",
                    tone:
                      receiptPresentation?.availability === "ready"
                        ? "positive"
                        : receiptPresentation?.availability === "forbidden"
                          ? "critical"
                          : receiptPresentation?.availability === "blocked"
                            ? "warning"
                            : "neutral",
                    detail: "승인·결정과 별도",
                  },
                  {
                    id: "owner-decision",
                    label: "결정 제출",
                    value: decisionPresentation?.label || "현재 명령 없음",
                    tone:
                      decisionPresentation?.availability === "ready"
                        ? "positive"
                        : decisionPresentation?.availability === "forbidden"
                          ? "critical"
                          : decisionPresentation?.availability === "blocked"
                            ? "warning"
                            : "neutral",
                    detail: "수령 확인과 별도",
                  },
                ]}
              />

              {ownerCurrent.machine === "report" ? (
                <div className="report-body mt-5">
                  <h3>현황</h3>
                  <p>{report?.facts || "정보 없음/확인 필요"}</p>
                  <h3>원인</h3>
                  <p>{report?.cause || "정보 없음/확인 필요"}</p>
                  <h3>감리 권고</h3>
                  <p>{report?.recommendation || "정보 없음/확인 필요"}</p>
                </div>
              ) : (
                <div className="mt-5">
                  <h3 className="subheading">결정 대안</h3>
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
                              {String(value.description ?? "설명 없음")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="muted">서버에 등록된 결정 대안이 없습니다.</p>
                  )}
                  {detail?.recommendation ? (
                    <div className="notice mt-3">
                      <strong>권고안</strong>
                      <p>{String(detail.recommendation)}</p>
                    </div>
                  ) : null}
                </div>
              )}

              {impactRows(impact).length ? (
                <div className="mt-5">
                  <h3 className="subheading">영향</h3>
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
                <strong>결정 경계</strong>
                <p>
                  수령 확인은 승인이나 결정이 아닙니다. 후속조치가 연결된 경우에는
                  이행 검증 후에만 종결할 수 있습니다.
                </p>
              </div>

              <h3 className="subheading">현재 가능한 업무</h3>
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
                <p className="muted">
                  현재 역할에서 서버가 허용한 업무가 없습니다.
                </p>
              ) : null}

              <details className="technical">
                <summary>연결 원본 · 버전 확인</summary>
                <pre>{JSON.stringify(detail, null, 2)}</pre>
              </details>
            </>
          ) : (
            <EmptyState
              title="확인할 보고 또는 결정요청을 선택하십시오."
              description="수령, 결정, 후속조치, 검증, 종결을 같은 흐름에서 확인합니다."
            />
          )}
        </OwnerDecisionPanel>
      </OwnerReportTemplate>
    </PageBoundary>
  );
}
