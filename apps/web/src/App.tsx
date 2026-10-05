import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClient, ApiError, newKey } from "@doul/client";
import type {
  HumanRole,
  Workspace,
  WorkItem,
  Fields,
  Json,
  CommandDescriptor,
  DomainRef,
  FormSchema,
  RecordDTO,
} from "@doul/client";
import { roles, states, commands, fields, reasonLabel } from "./labels";
import {
  ActionButton,
  EmptyState,
  KpiCard,
  PageHeader,
  Panel,
  SectionHeader,
  StatusBadge,
} from "./ui";
import {
  CaptureTemplate,
  DashboardTemplate,
  DocumentWorkspaceTemplate,
  OwnerReportTemplate,
  RegisterTemplate,
  WorkbenchTemplate,
} from "./ui/templates";
import "./App.css";

const api = new ApiClient("/api");
const routes = [
  ["today", "오늘", "home"],
  ["inspections", "검측·검수", "check"],
  ["capture", "현장·증빙", "camera"],
  ["observations", "관찰 후보", "eye"],
  ["issues", "부적합·이슈", "flag"],
  ["actions", "시정조치", "tool"],
  ["owner", "발주처 보고·결정", "report"],
  ["documents", "문서 작성", "document"],
  ["rfis", "설계질의", "layers"],
  ["admin", "배치·권한", "users"],
];
const roleRoutes: Record<HumanRole, string[]> = {
  SUP: routes.map((x) => x[0]).filter((x) => x !== "admin"),
  CON: [
    "today",
    "inspections",
    "capture",
    "issues",
    "actions",
    "rfis",
    "documents",
  ],
  OWN: ["today", "owner", "issues", "documents"],
  DES: ["today", "rfis", "capture", "documents"],
  ADM: routes.map((x) => x[0]),
};
const machineLabels: Record<string, string> = {
  inspection: "검측",
  observation: "관찰",
  issue: "이슈",
  action: "시정조치",
  report: "보고",
  decision: "의사결정",
  rfi: "설계질의",
  document: "문서",
  evidence: "증빙",
};
const machineForRoute: Record<string, string[]> = {
  inspections: ["inspection"],
  observations: ["observation"],
  issues: ["issue"],
  actions: ["action"],
  owner: ["report", "decision"],
  rfis: ["rfi"],
};
const icons: Record<string, string> = {
  home: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
  check: "M4 3h16v18H4z M8 8l2 2 5-5 M8 15h8",
  camera: "M3 7h4l2-3h6l2 3h4v14H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  flag: "M5 21V3h14l-3 5 3 5H5",
  tool: "m4 20 7-7 M14 3a5 5 0 0 0 7 7l-4-1-2-3z",
  report: "M4 21V3h16v18H4 M8 8h8 M8 12h8 M8 16h5",
  document: "M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h8",
  layers: "m12 3 10 6-10 6L2 9z M2 13l10 6 10-6 M2 17l10 6 10-6",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M18 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-4",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  refresh:
    "M20 7v5h-5 M4 17v-5h5 M5 7a8 8 0 0 1 14-2l1 2 M4 17l1 2a8 8 0 0 0 14-2",
  close: "m5 5 14 14 M19 5 5 19",
};
function Icon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[name] || icons.document} />
    </svg>
  );
}
function title(r: RecordDTO) {
  return (
    r.workName ||
    r.title ||
    r.description ||
    String(
      r.metadata?.name || machineLabels[r.mediaType || ""] || r.id.slice(0, 8),
    )
  );
}
function refFor(item: WorkItem): DomainRef {
  const kind: Record<string, string> = {
    inspection: "Inspection",
    issue: "Issue",
    observation: "Observation",
    action: "Action",
    rfi: "WorkItem",
    report: "InformationItem",
    decision: "Decision",
    document: "DocumentSnapshot",
  };
  return {
    objectType: kind[item.machine] || "InformationItem",
    objectId: item.record.id,
    version: item.record.version,
  };
}

export default function App() {
  const [role, setRole] = useState<HumanRole>("SUP");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [route, setRoute] = useState(location.hash.slice(2) || "today");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<{
    item: WorkItem;
    action: CommandDescriptor;
  } | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setWorkspace(await api.workspace());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "연결 오류");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const n = ++sequence.current;
    api
      .login(role)
      .then(() => api.workspace())
      .then((w) => {
        if (n === sequence.current) setWorkspace(w);
      })
      .catch((e) => {
        if (n === sequence.current) setError(String(e));
      })
      .finally(() => {
        if (n === sequence.current) setLoading(false);
      });
  }, [role]);
  useEffect(() => {
    const net = () => setOnline(navigator.onLine);
    const hash = () => {
      setRoute(location.hash.slice(2) || "today");
      setSelected(null);
      setMenu(false);
    };
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    window.addEventListener("hashchange", hash);
    return () => {
      window.removeEventListener("online", net);
      window.removeEventListener("offline", net);
      window.removeEventListener("hashchange", hash);
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const nav = (to: string) => {
    history.pushState(null, "", "#/" + to);
    setRoute(to);
    setSelected(null);
    setMenu(false);
  };
  const allowed = roleRoutes[role];
  const safeRoute = allowed.includes(route) ? route : "today";
  const items = workspace?.items || [];
  const current = items.find((x) => x.record.id === selected) || null;
  async function perform(
    item: WorkItem,
    command: string,
    payload: Fields = {},
  ) {
    if (!online)
      throw new Error(
        "오프라인입니다. 공식 제출은 연결 복구 후 다시 확인하십시오.",
      );
    await api.execute(item, command, payload);
    setToast("서버에서 처리했습니다.");
    await refresh();
  }
  async function createInspection() {
    if (!workspace) return;
    try {
      const r = await api.create("inspection", {
        ...workspace.context.scope,
        workName: "새 자체검측 · 예시",
        selfInspectionComplete: true,
        precheck: {
          drawing: true,
          material: true,
          test: true,
          previous: true,
          change: true,
        },
        holdPoint: false,
        nextWorkAllowed: false,
        requirementRefs: [workspace.context.requirementRef],
        drawingRef: workspace.context.drawingRef,
        evidenceIds: [workspace.context.evidenceId],
      });
      await refresh();
      setSelected(r.record.id);
    } catch (e) {
      setError(String(e));
    }
  }
  async function createIssue(item: WorkItem) {
    if (!workspace) return;
    try {
      await api.create("issue", {
        ...workspace.context.scope,
        subtype: "NCR",
        title: "확인된 관찰의 부적합 기록",
        observationIds: [item.record.id],
        actionIds: [],
        inspectionIds: [],
        correctionCycle: 0,
        evidenceIds: item.record.evidenceIds || [],
      });
      setToast("공식 이슈가 발행되었습니다.");
      await refresh();
      nav("issues");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <div className="brand">
          <b>
            DOUL<span> / </span>
          </b>
          <small>SUPERVISION</small>
        </div>
        <div className="workspace-label">PROJECT WORKSPACE</div>
        <div className="project-chip">
          <span className="project-mark">D</span>
          <div>
            <strong>시범현장</strong>
            <small>예시 데이터 · 개발용</small>
          </div>
        </div>
        <nav aria-label="주 메뉴">
          {routes
            .filter((x) => allowed.includes(x[0]))
            .map(([id, label, icon]) => (
              <button
                key={id}
                className={safeRoute === id ? "active" : ""}
                onClick={() => nav(id)}
              >
                <Icon name={icon} />
                <span>{label}</span>
                {id === "observations" && (
                  <i>
                    {
                      items.filter(
                        (x) =>
                          x.machine === "observation" &&
                          x.record.status !== "confirmed",
                      ).length
                    }
                  </i>
                )}
              </button>
            ))}
        </nav>
        <div className="side-bottom">
          <span className="dot" /> 참조 계약 v2.1
          <small>EXPLAIN · VERIFY · RECORD</small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button menu-toggle"
            aria-label="메뉴 열기"
            onClick={() => setMenu(!menu)}
          >
            <Icon name="layers" />
          </button>
          <div className="breadcrumbs">
            DOUL / <b>{routes.find((x) => x[0] === safeRoute)?.[1]}</b>
          </div>
          <div className="top-actions">
            <span className={"connection " + (!online ? "offline" : "")}>
              {online ? "온라인" : "오프라인"}
            </span>
            <label className="role-picker">
              개발 역할{" "}
              <select
                aria-label="개발 역할 선택"
                value={role}
                onChange={(e) => {
                  setWorkspace(null);
                  setLoading(true);
                  setRole(e.target.value as HumanRole);
                  setSelected(null);
                  nav("today");
                }}
              >
                {Object.entries(roles).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <span className="avatar">{roles[role][0]}</span>
          </div>
        </header>
        <div className="demo-bar">
          개발 미리보기 · 실제 현장 기록이 아닙니다.{" "}
          <span>법적 서명·AI·AR은 연동 전입니다.</span>
        </div>
        {!online && (
          <div role="alert" className="offline-bar">
            오프라인 · 보이는 화면은 마지막 조회본입니다. 승인·종결은 온라인
            재검증 전까지 확정되지 않습니다.
          </div>
        )}
        <main>
          <PageHeader
            eyebrow={roles[role] + " 작업공간"}
            title={routes.find((x) => x[0] === safeRoute)?.[1]}
            description={
              safeRoute === "today"
                ? "확인이 필요한 업무부터, 증빙과 함께."
                : "현장 기록 · 승인 기준 · 조치 이력을 하나로 확인합니다."
            }
            actions={
              <>
                <ActionButton
                  onClick={() => void refresh()}
                  disabled={loading || !online}
                >
                  <Icon name="refresh" />
                  새로고침
                </ActionButton>
                {role === "SUP" && (
                  <ActionButton
                    variant="primary"
                    onClick={() => nav("capture")}
                  >
                    <Icon name="camera" />
                    현장 촬영
                  </ActionButton>
                )}
              </>
            }
          />
          {error && (
            <div role="alert" className="error-box">
              <strong>처리되지 않았습니다.</strong> {error}
              <button onClick={() => setError("")} aria-label="오류 닫기">
                ×
              </button>
            </div>
          )}
          {!workspace && loading ? (
            <div className="loading-panel">
              프로젝트와 유효 권한을 불러오고 있습니다…
            </div>
          ) : !workspace ? (
            <EmptyState
              title="개발 API에 연결할 수 없습니다."
              description="localhost:8791의 API를 먼저 실행하십시오."
              action={
                <ActionButton onClick={() => void refresh()}>
                  다시 연결
                </ActionButton>
              }
            />
          ) : (
            <>
              {safeRoute === "today" && (
                <DashboardTemplate>
                  <div className="kpi-grid">
                    {[
                      [
                        "검측 대기",
                        items.filter(
                          (x) =>
                            x.machine === "inspection" &&
                            !["completed", "cancelled"].includes(
                              x.record.status || "",
                            ),
                        ).length,
                        "inspections",
                      ],
                      [
                        "미종결 이슈",
                        items.filter(
                          (x) =>
                            x.machine === "issue" &&
                            x.record.status !== "closed",
                        ).length,
                        "issues",
                      ],
                      [
                        "시정조치",
                        items.filter(
                          (x) =>
                            x.machine === "action" &&
                            x.record.status !== "closed",
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
                    ].map(([label, value, to], i) => (
                      <KpiCard
                        key={String(label)}
                        label={label}
                        value={value}
                        className={"kpi-" + i}
                        onClick={() =>
                          allowed.includes(String(to)) && nav(String(to))
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
                      <RecordList
                        items={items.filter((x) =>
                          role === "OWN"
                            ? ["report", "decision"].includes(x.machine)
                            : role === "DES"
                              ? x.machine === "rfi"
                              : ["inspection", "action"].includes(x.machine),
                        )}
                        onSelect={(x) => {
                          nav(
                            x.machine === "inspection"
                              ? "inspections"
                              : x.machine === "rfi"
                                ? "rfis"
                                : x.machine === "action"
                                  ? "actions"
                                  : "owner",
                          );
                          setSelected(x.record.id);
                        }}
                      />
                    </Panel>
                    <div className="right-stack">
                      <Panel className="priority">
                        <span className="eyebrow">진행 전 확인</span>
                        <h2>
                          적합 판정과
                          <br />
                          후속공정 승인은 다릅니다.
                        </h2>
                        <p>
                          필수서명과 해당 Hold 승인이 완료되어야 다음 작업을
                          허용합니다.
                        </p>
                        <button
                          className="text-button"
                          onClick={() =>
                            nav(role === "OWN" ? "owner" : "inspections")
                          }
                        >
                          선행조건 확인 <Icon name="arrow" />
                        </button>
                      </Panel>
                      <Panel>
                        <SectionHeader title="최근 처리 이력" meta="서버 기록" />
                        <div className="timeline">
                          {workspace.audit
                            .slice(-5)
                            .reverse()
                            .map((x) => (
                              <div key={x.id}>
                                <span className="time-dot" />
                                <strong>
                                  {commands[x.command.split(":")[1]] ||
                                    x.command}
                                </strong>
                                <small>
                                  {new Date(x.at).toLocaleTimeString("ko-KR")} ·{" "}
                                  {states[x.afterState] || x.afterState}
                                </small>
                              </div>
                            ))}
                        </div>
                      </Panel>
                    </div>
                  </div>
                </DashboardTemplate>
              )}
              {machineForRoute[safeRoute] && (() => {
                  const WorkbenchLayout =
                    safeRoute === "owner"
                      ? OwnerReportTemplate
                      : WorkbenchTemplate;
                  return (
                    <WorkbenchLayout hasDetail={!!current}>
                  <section className="panel list-pane">
                    <div className="section-heading">
                      <h2>
                        {routes.find((x) => x[0] === safeRoute)?.[1]} 목록
                      </h2>
                      <span>
                        {
                          items.filter((x) =>
                            machineForRoute[safeRoute].includes(x.machine),
                          ).length
                        }
                        건
                      </span>
                    </div>
                    {safeRoute === "inspections" && role === "CON" && (
                      <button
                        className="secondary wide"
                        onClick={() => void createInspection()}
                      >
                        예시 자체검측 추가
                      </button>
                    )}
                    <RecordList
                      items={items.filter((x) =>
                        machineForRoute[safeRoute].includes(x.machine),
                      )}
                      selected={selected}
                      onSelect={(x) => setSelected(x.record.id)}
                    />
                  </section>
                  <section className="panel detail-pane">
                    {current ? (
                      <>
                        <button
                          className="mobile-back text-button"
                          onClick={() => setSelected(null)}
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
                        <h2 className="detail-title">
                          {title(current.record)}
                        </h2>
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
                                <b>
                                  {current.record.holdPoint
                                    ? "Hold 적용"
                                    : "일반"}
                                </b>
                              </div>
                              <div
                                className={
                                  current.record.nextWorkAllowed
                                    ? "good"
                                    : "warn"
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
                              음성의 주장과 실제 관찰·측정 근거를 구분하십시오.
                              이 예시는 측정기록에 연결된 사람 입력이며, 영상 AI
                              분석 결과가 아닙니다.
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
                              시정 주기{" "}
                              {Number(current.record.correctionCycle || 0) + 1}
                            </strong>
                            <p>
                              현재 주기의 조치 검증 · 새 재검측 · 해당 버전의
                              서명을 모두 확인해야 종결할 수 있습니다.
                            </p>
                            <p>
                              연결 검측{" "}
                              {current.record.inspectionIds?.length || 0}건 /
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
                              수령 확인 → 결정·조치 → 이행검증 → 종결.
                              읽음/수령을 승인으로 처리하지 않습니다.
                            </div>
                          </div>
                        )}
                        {current.machine === "rfi" && (
                          <div className="notice">
                            <strong>
                              RFI 답변은 설계변경 승인이 아닙니다.
                            </strong>
                            <p>
                              {String(
                                current.record.data?.question ||
                                  "질의 근거를 확인하십시오.",
                              )}
                            </p>
                          </div>
                        )}
                        <h3 className="subheading">현재 가능한 업무</h3>
                        <div className="command-grid">
                          {current.actions.map((a) => (
                            <div key={a.command} className="command-option">
                              <button
                                className={
                                  ["close", "pass", "issue", "decide"].includes(
                                    a.command,
                                  )
                                    ? "primary"
                                    : "secondary"
                                }
                                disabled={
                                  !online || (!a.ready && !a.requiresInput)
                                }
                                onClick={() =>
                                  setDialog({ item: current, action: a })
                                }
                              >
                                {commands[a.command] || a.command}
                              </button>
                              {a.blockedReason && !a.requiresInput && (
                                <small>
                                  {reasonLabel(a.blockedReason.code)}
                                </small>
                              )}
                              {a.requiresInput && (
                                <small>
                                  입력 후 서버에서 선행조건을 다시 확인합니다.
                                </small>
                              )}
                            </div>
                          ))}
                        </div>
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
                              onClick={() => void createIssue(current)}
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
                  </section>
                    </WorkbenchLayout>
                  );
                })()}
              {safeRoute === "capture" && (
                <Capture
                  workspace={workspace}
                  online={online}
                  refresh={refresh}
                  notify={setToast}
                />
              )}
              {safeRoute === "documents" && (
                <DocumentEditor
                  workspace={workspace}
                  online={online}
                  refresh={refresh}
                />
              )}
              {safeRoute === "admin" && <AdminPanel workspace={workspace} />}
            </>
          )}
        </main>
        <footer className="app-footer">
          DOUL INTERNATIONAL <span>업무 원본 · 증빙 · 검증 · 기록</span>
        </footer>
      </div>
      <nav className="bottom-nav" aria-label="모바일 메뉴">
        {(role === "OWN"
          ? [
              ["today", "오늘", "home"],
              ["owner", "결정", "report"],
              ["issues", "이슈", "flag"],
              ["documents", "문서", "document"],
            ]
          : [
              ["today", "오늘", "home"],
              ["inspections", "검측", "check"],
              ["capture", "촬영", "camera"],
              ["issues", "이슈", "flag"],
            ]
        ).map(([id, label, icon]) => (
          <button
            key={id}
            className={safeRoute === id ? "active" : ""}
            onClick={() => nav(id)}
          >
            <Icon name={icon} />
            {label}
          </button>
        ))}
        <button onClick={() => setMenu(!menu)}>
          <Icon name="layers" />
          더보기
        </button>
      </nav>
      {dialog && workspace && (
        <CommandModal
          dialog={dialog}
          workspace={workspace}
          onClose={() => setDialog(null)}
          onSubmit={async (p) => {
            await perform(dialog.item, dialog.action.command, p);
            setDialog(null);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function RecordList({
  items,
  onSelect,
  selected,
}: {
  items: WorkItem[];
  onSelect: (x: WorkItem) => void;
  selected?: string | null;
}) {
  return (
    <div className="record-list">
      {items.length ? (
        items.map((x) => (
          <button
            key={x.record.id}
            className={
              "record-row " + (selected === x.record.id ? "selected" : "")
            }
            onClick={() => onSelect(x)}
          >
            <div className="record-icon">
              <Icon
                name={
                  x.machine === "inspection"
                    ? "check"
                    : x.machine === "action"
                      ? "tool"
                      : "document"
                }
              />
            </div>
            <div className="record-summary">
              <div>
                <small>
                  {machineLabels[x.machine] || x.machine} ·{" "}
                  {x.record.id.slice(0, 6)}
                </small>
                <StatusBadge status={x.record.status}>
                  {states[x.record.status || ""] ||
                    x.record.status ||
                    "원본 보존"}
                </StatusBadge>
              </div>
              <strong>{title(x.record)}</strong>
              <span>
                A동 2층 / C-5 <i>·</i> 원본 v{x.record.version}
              </span>
            </div>
            <Icon name="arrow" />
          </button>
        ))
      ) : (
        <div className="empty compact">
          현재 권한에서 조회할 항목이 없습니다.
        </div>
      )}
    </div>
  );
}
function FloorPlan() {
  return (
    <div className="floorplan">
      <span>
        도면 예시 · A-201 Rev.03 <small>실제 위치 정합 전</small>
      </span>
      <svg viewBox="0 0 620 170" aria-label="샘플 도면">
        <g fill="none" stroke="#c5ccd4" strokeWidth="1">
          <path d="M30 20H590V150H30Z M150 20v130 M290 20v130 M440 20v130 M30 80h560" />
          <path
            strokeDasharray="4 4"
            d="M10 45h600 M10 115h600 M90 0v170 M360 0v170 M510 0v170"
          />
        </g>
        <path
          d="M150 20h140v60H150z M290 80h150v70H290z"
          fill="#17365d0d"
          stroke="#17365D"
          strokeWidth="2"
        />
        <circle cx="360" cy="115" r="7" fill="#17365D" />
        <circle
          cx="360"
          cy="115"
          r="17"
          fill="none"
          stroke="#17365D"
          opacity=".3"
        />
        <text x="382" y="120" fill="#17365D" fontSize="14">
          C-5
        </text>
      </svg>
    </div>
  );
}
function fieldDefault(field: string, w: Workspace, item: WorkItem): string {
  if (field.endsWith("At"))
    return new Date(
      Date.now() + (field === "dueAt" ? 86400000 : 0),
    ).toISOString();
  if (field === "checkResults")
    return JSON.stringify(
      [
        {
          itemId: "dimension",
          requirementRef: w.context.requirementRef,
          result: "pass",
          evidenceIds: item.record.evidenceIds || [],
          measuredValue: 120,
          unit: "mm",
        },
      ],
      null,
      2,
    );
  if (field === "responseInformationRefs" || field === "references")
    return JSON.stringify([w.context.drawingRef], null, 2);
  if (field === "changeRequired") return "false";
  if (field === "decision") return "approved";
  if (field === "selectedOption") return "A";
  if (field === "responsibleOrganizationId")
    return w.context.scope.responsibleOrganizationId;
  if (field.endsWith("Ids"))
    return JSON.stringify(item.record[field] || [], null, 2);
  if (field === "verificationGrounding") return "[]";
  return "";
}
function CommandModal({
  dialog,
  workspace,
  onClose,
  onSubmit,
}: {
  dialog: { item: WorkItem; action: CommandDescriptor };
  workspace: Workspace;
  onClose: () => void;
  onSubmit: (p: Fields) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      dialog.action.fields.map((f) => [
        f,
        fieldDefault(f, workspace, dialog.item),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const title = commands[dialog.action.command] || dialog.action.command;
  async function submit() {
    setBusy(true);
    setErr("");
    try {
      const payload: Fields = {};
      for (const f of dialog.action.fields) {
        const v = values[f];
        if (!v?.trim()) continue;
        payload[f] =
          f === "changeRequired"
            ? v === "true"
            : /Ids$|Refs$|^references$|^checkResults$|^verificationGrounding$|^conditions$|^replacementRef$/.test(
                  f,
                )
              ? (JSON.parse(v) as Json)
              : v;
      }
      await onSubmit(payload);
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? reasonLabel(e.detail.code) + " " + e.message
          : String(e),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="section-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="대화상자 닫기"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="muted">
          원본 v{dialog.item.record.version} 기준 · 제출할 때 권한과 선행조건을
          다시 검증합니다.
        </p>
        <div className="modal-fields">
          {dialog.action.fields.map((f) => (
            <label key={f}>
              {fields[f] || f}
              {f === "decision" ? (
                <select
                  value={values[f]}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
                  <option value="approved">승인</option>
                  <option value="rejected">거절</option>
                  <option value="returned">보완 요청</option>
                </select>
              ) : f === "changeRequired" ? (
                <select
                  value={values[f]}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
                  <option value="false">필요 없음</option>
                  <option value="true">설계변경 필요</option>
                </select>
              ) : f === "responsiblePartyId" ? (
                <select
                  value={values[f]}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
                  <option value="">담당자 선택</option>
                  {workspace.participants.map((p) => (
                    <option value={p.partyId} key={p.partyId}>
                      {roles[p.actorGroup]} · {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <textarea
                  rows={f === "checkResults" ? 8 : f.endsWith("At") ? 1 : 3}
                  value={values[f]}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                  placeholder={
                    f.endsWith("At") ? "RFC3339 · 시간대 포함" : fields[f] || f
                  }
                />
              )}
            </label>
          ))}
        </div>
        {!dialog.action.fields.length && (
          <div className="notice">
            이 동작은 서버에 기록됩니다. 근거와 현재 상태를 확인한 뒤
            실행하십시오.
          </div>
        )}
        {err && (
          <div role="alert" className="error-box">
            {err}
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            className="primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? "검증 중…" : "확인 후 실행"}
          </button>
        </div>
      </section>
    </div>
  );
}

interface LocalCapture {
  id: string;
  projectId: string;
  partyId: string;
  name: string;
  mime: string;
  bytes: ArrayBuffer;
  hash: string;
  capturedAt: string;
}
async function captures(
  action: "list" | "put" | "delete",
  value?: LocalCapture | string,
): Promise<LocalCapture[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("doul-captures", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("originals", { keyPath: "id" });
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(
        "originals",
        action === "list" ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("originals");
      if (action === "put") store.put(value);
      if (action === "delete") store.delete(value as string);
      const all = store.getAll();
      tx.oncomplete = () => {
        resolve(all.result as LocalCapture[]);
        db.close();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}
function Capture({
  workspace,
  online,
  refresh,
  notify,
}: {
  workspace: Workspace;
  online: boolean;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [pending, setPending] = useState<LocalCapture[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setPending(
      (await captures("list")).filter(
        (x) =>
          x.projectId === workspace.project.id &&
          x.partyId === api.session!.actor.partyId,
      ),
    );
  }, [workspace.project.id]);
  useEffect(() => {
    let active = true;
    captures("list")
      .then((rows) => {
        if (active)
          setPending(
            rows.filter(
              (x) =>
                x.projectId === workspace.project.id &&
                x.partyId === api.session!.actor.partyId,
            ),
          );
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [workspace.project.id]);
  async function intake(file: File) {
    try {
      if (file.size > 64 * 1024 * 1024)
        throw new Error("개발용 업로드는 64MB 이하입니다.");
      const bytes = await file.arrayBuffer();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      )
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      await captures("put", {
        id: newKey(),
        projectId: workspace.project.id,
        partyId: api.session!.actor.partyId,
        name: file.name,
        mime: file.type,
        bytes,
        hash,
        capturedAt: new Date().toISOString(),
      });
      await load();
      notify("원본을 기기에 저장했습니다. 아직 제출되지 않았습니다.");
    } catch (e) {
      setError(String(e));
    }
  }
  async function send(p: LocalCapture) {
    setError("");
    setProgress("전송 시작");
    try {
      await api.upload(
        new Uint8Array(p.bytes),
        {
          name: p.name,
          mime: p.mime,
          hash: p.hash,
          captureId: p.id,
          scope: workspace.context.scope,
          sourcePartyId: api.session!.actor.partyId,
          capturedAt: p.capturedAt,
        },
        (o, t) => setProgress(Math.round((o / t) * 100) + "%"),
      );
      await captures("delete", p.id);
      await load();
      await refresh();
      notify("서버 해시 확인 후 증빙을 등록했습니다.");
    } catch (e) {
      setError(String(e));
    } finally {
      setProgress("");
    }
  }
  return (
    <CaptureTemplate>
      <section className="panel">
        <div className="section-heading">
          <h2>현장 기록 가져오기</h2>
          <span>원본 보존</span>
        </div>
        <div className="capture-drop">
          <Icon name="camera" />
          <h2>사진·영상·음성을 기록합니다.</h2>
          <p>
            촬영 위치는 수동 선택값입니다. 자동 측위·AI 판정은 실행하지
            않습니다.
          </p>
          <label className="primary upload-label">
            파일 선택
            <input
              aria-label="증빙 파일 선택"
              type="file"
              accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void intake(f);
                e.target.value = "";
              }}
            />
          </label>
          <label className="secondary upload-label">
            카메라 촬영
            <input
              aria-label="카메라 사진 촬영"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void intake(f);
              }}
            />
          </label>
        </div>
        <h3>기기 저장 · 제출 대기 {pending.length}건</h3>
        {pending.map((p) => (
          <div className="pending-row" key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <small>
                {(p.bytes.byteLength / 1024).toFixed(0)} KB · SHA256{" "}
                {p.hash.slice(0, 12)}…
              </small>
            </div>
            <button
              className="secondary"
              disabled={!online || !!progress}
              onClick={() => void send(p)}
            >
              서버 전송
            </button>
          </div>
        ))}
        {progress && <p role="status">{progress}</p>}
        {error && (
          <div role="alert" className="error-box">
            {error}
          </div>
        )}
      </section>
      <div className="right-stack">
        <section className="panel">
          <h2>현재 촬영 맥락</h2>
          <div className="meta-grid">
            <div>
              <small>건물 / 층</small>
              <b>A동 / 2층</b>
            </div>
            <div>
              <small>위치 방식</small>
              <b>수동 지정</b>
            </div>
          </div>
          <FloorPlan />
          <div className="notice">
            기기에 저장된 파일은 전송 버튼을 누르기 전까지 서버 증빙이 아닙니다.
            재연결 시 자동 승인·종결하지 않습니다.
          </div>
        </section>
        <section className="panel">
          <h2>서버 증빙</h2>
          {workspace.items
            .filter((x) => x.machine === "evidence")
            .map((x) => (
              <div className="evidence-row" key={x.record.id}>
                <Icon name="document" />
                <div>
                  <strong>{title(x.record)}</strong>
                  <small>
                    {x.record.mediaType} · 원본 /{" "}
                    {x.record.fileHash?.slice(0, 12)}…
                  </small>
                </div>
              </div>
            ))}
          <button className="secondary wide" disabled>
            AI 분석 · 서비스 미연결
          </button>
        </section>
      </div>
    </CaptureTemplate>
  );
}
function putPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const keys = path.split(".");
  let node = target;
  for (const k of keys.slice(0, -1)) {
    if (!node[k] || typeof node[k] !== "object") node[k] = {};
    node = node[k] as Record<string, unknown>;
  }
  node[keys.at(-1)!] = value;
}
function formData(schema: FormSchema, values: Record<string, string>) {
  const data: Record<string, unknown> = {};
  for (const [f, r] of Object.entries(schema.scalar_fields)) {
    const v = values[f] || "";
    if (v) putPath(data, f, r.type === "boolean" ? v === "true" : v);
  }
  for (const t of schema.tables)
    putPath(
      data,
      t.path,
      ["review_table", "check_table"].includes(t.type)
        ? Object.fromEntries(t.columns.map((c) => [c, ""]))
        : [],
    );
  return data;
}
function DocumentEditor({
  workspace,
  online,
  refresh,
}: {
  workspace: Workspace;
  online: boolean;
  refresh: () => Promise<void>;
}) {
  const [form, setForm] = useState("FM-20");
  const [source, setSource] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [snapshot, setSnapshot] = useState<RecordDTO | null>(null);
  const schema = workspace.formSchemas[form];
  const sources = workspace.items.filter((x) =>
    ["report", "issue", "inspection"].includes(x.machine),
  );
  async function preview() {
    setBusy(true);
    setErr("");
    try {
      const item =
        sources.find((x) => x.record.id === source) ||
        sources.find((x) =>
          form === "FM-09"
            ? x.machine === "inspection"
            : form === "FM-12"
              ? x.machine === "issue"
              : x.machine === "report",
        );
      if (!item) throw new Error("문서 원본을 선택하십시오.");
      const doc = await api.render(
        form,
        [refFor(item)],
        formData(schema, values),
      );
      setSnapshot(doc);
      setHtml(await api.documentHtml(doc.id));
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <DocumentWorkspaceTemplate>
      <section className="panel editor-pane">
        <h2>데이터 연결 문서</h2>
        <label>
          DOUL 양식
          <select
            aria-label="문서 양식"
            value={form}
            onChange={(e) => {
              setForm(e.target.value);
              setHtml("");
              setValues({});
            }}
          >
            {[
              ["FM-20", "발주처 즉시보고"],
              ["FM-19", "주간보고"],
              ["FM-21", "의사결정 요청서"],
              ["FM-12", "부적합 보고서"],
              ["FM-09", "검수기록"],
            ].map(([id, t]) => (
              <option key={id} value={id}>
                {id} · {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          원본 기록
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="문서 원본 선택"
          >
            <option value="">양식에 맞는 원본 자동 선택</option>
            {sources.map((x) => (
              <option value={x.record.id} key={x.record.id}>
                {title(x.record)} · v{x.record.version}
              </option>
            ))}
          </select>
        </label>
        <div className="notice">
          미리보기는 초안입니다. 발행본은 원본 버전·템플릿·출력 해시를
          보존합니다.
        </div>
        <details open>
          <summary>초안 작성 항목</summary>
          <div className="document-fields">
            {Object.entries(schema.scalar_fields).map(([f, r]) => (
              <label key={f}>
                {f}
                {r.required ? " *" : ""}
                <input
                  value={values[f] || ""}
                  placeholder={
                    r.type === "date-time"
                      ? "2026-10-05T09:00:00+07:00"
                      : r.type === "boolean"
                        ? "true / false"
                        : "원본 연결 또는 직접 입력"
                  }
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
        </details>
        <button
          className="primary wide"
          onClick={() => void preview()}
          disabled={busy || !online}
        >
          {busy ? "원본 버전으로 생성 중…" : "초안 HTML 생성"}
        </button>
        <div className="two-buttons">
          <button className="secondary" disabled>
            DOCX 연동 전
          </button>
          <button className="secondary" disabled>
            PDF 연동 전
          </button>
        </div>
        {err && (
          <div role="alert" className="error-box">
            {err}
          </div>
        )}
      </section>
      <section className="preview-pane">
        <div className="preview-header">
          <b>A4 미리보기</b>
          <span>초안 · 법정 발행본 아님</span>
        </div>
        {html ? (
          <iframe title="문서 초안 미리보기" sandbox="" srcDoc={html} />
        ) : (
          <div className="paper-empty">
            <Icon name="document" />
            <h2>문서를 원본 데이터에 연결합니다.</h2>
            <p>왼쪽에서 양식과 기록을 선택해 초안을 만드십시오.</p>
          </div>
        )}
        {snapshot && (
          <small className="snapshot-note">
            스냅샷 {snapshot.id.slice(0, 8)} · 출력 해시{" "}
            {String(snapshot.renderHash).slice(0, 20)}…
          </small>
        )}
      </section>
    </DocumentWorkspaceTemplate>
  );
}
function AdminPanel({ workspace }: { workspace: Workspace }) {
  const [rows, setRows] = useState<RecordDTO[]>([]);
  useEffect(() => {
    api
      .request<RecordDTO[]>(api.path("/roles"))
      .then(setRows)
      .catch(() => setRows([]));
  }, [workspace]);
  return (
    <RegisterTemplate
      header={
        <SectionHeader title="프로젝트 역할배정" meta="현재 조회 전용" />
      }
      notice={
        <div className="notice">
          관리자 계정은 기술승인·법정서명 권한을 자동으로 갖지 않습니다.
          시험기관·외부검토기관은 자료 출처만 보존하고 로그인 대상에서 제외합니다.
        </div>
      }
    >
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>사용자군</th>
              <th>프로젝트 역할</th>
              <th>분야</th>
              <th>배치 종료</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{roles[String(r.actorGroup)] || String(r.actorGroup)}</td>
                <td>{String(r.roleCode)}</td>
                <td>건축 / 지정 패키지</td>
                <td>{String(r.validTo).slice(0, 10)}</td>
                <td>{r.active ? "유효" : "중지"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RegisterTemplate>
  );
}
