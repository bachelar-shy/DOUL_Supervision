import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CommandDescriptor,
  Fields,
  HumanRole,
  WorkItem,
  Workspace,
} from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { roles } from "../labels";
import { ActionButton, EmptyState, PageHeader } from "../ui";
import { MobileNavigation, NavigationList } from "../ui/catalog";
import {
  AdminPage,
  CapturePage,
  CommandModal,
  DocumentPage,
  OwnerGovernancePage,
  RegisterPage,
  SafetyPage,
  TodayPage,
  WorkbenchPage,
} from "../pages";
import { Icon } from "../pages/shared";
import { machineForRoute, mobileRoutes, roleRoutes, routes } from "./routes";

export function AppShell({ client }: { client: SupervisionClient }) {
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
      setWorkspace(await client.workspace());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "연결 오류");
    } finally {
      setLoading(false);
    }
  }, [client]);
  useEffect(() => {
    const n = ++sequence.current;
    client
      .login(role)
      .then(() => client.workspace())
      .then((w) => {
        if (n === sequence.current) setWorkspace(w);
      })
      .catch((e) => {
        if (n === sequence.current) setError(String(e));
      })
      .finally(() => {
        if (n === sequence.current) setLoading(false);
      });
  }, [client, role]);
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
  const mobileItems = mobileRoutes[role].filter((item) =>
    allowed.includes(item.id),
  );
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
    await client.execute(item, command, payload);
    setToast("서버에서 처리했습니다.");
    await refresh();
  }
  async function createInspection() {
    if (!workspace) return;
    try {
      const r = await client.create("inspection", {
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
      await client.create("issue", {
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
        <NavigationList
          activeId={safeRoute}
          onNavigate={nav}
          items={routes
            .filter((x) => allowed.includes(x.id))
            .map(({ id, label, icon }) => ({
              id,
              label,
              icon: <Icon name={icon} />,
              badge:
                id === "observations"
                  ? items.filter(
                      (item) =>
                        item.machine === "observation" &&
                        item.record.status !== "confirmed",
                    ).length
                  : undefined,
            }))}
        />
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
            DOUL / <b>{routes.find((x) => x.id === safeRoute)?.label}</b>
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
          {client.kind === "mock" ? (
            <>
              UI Mock Preview · 실제 서버 동작이 아닙니다.{" "}
              <span>업무 명령·업로드·발행은 실행하지 않습니다.</span>
            </>
          ) : (
            <>
              개발 미리보기 · 실제 현장 기록이 아닙니다.{" "}
              <span>법적 서명·AI·AR은 연동 전입니다.</span>
            </>
          )}
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
            title={routes.find((x) => x.id === safeRoute)?.label}
            description={
              safeRoute === "today"
                ? "확인이 필요한 업무부터, 증빙과 함께."
                : safeRoute === "registers"
                  ? "역할별 추천에서 시작해 29개 표준 관리대장을 서버 권한 범위에서 조회합니다."
                  : safeRoute === "safety"
                    ? "작업허가, 작업중지, 재개 Gate와 장비 안전상태를 서버 원본 기준으로 확인합니다."
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
                <TodayPage
                  role={role}
                  workspace={workspace}
                  allowedRoutes={allowed}
                  onNavigate={nav}
                  onOpenItem={(item) => {
                    nav(
                      item.machine === "inspection"
                        ? "inspections"
                        : item.machine === "rfi"
                          ? "rfis"
                          : item.machine === "action"
                            ? "actions"
                            : "owner",
                    );
                    setSelected(item.record.id);
                  }}
                />
              )}
              {safeRoute === "safety" && (
                <SafetyPage
                  workspace={workspace}
                  selected={selected}
                  current={current}
                  online={online}
                  onSelect={setSelected}
                  onOpenCommand={(item, action) => setDialog({ item, action })}
                />
              )}
              {safeRoute === "owner" && (
                <OwnerGovernancePage
                  workspace={workspace}
                  selected={selected}
                  current={current}
                  online={online}
                  onSelect={setSelected}
                  onOpenCommand={(item, action) => setDialog({ item, action })}
                />
              )}
              {!["owner", "safety"].includes(safeRoute) && machineForRoute[safeRoute] && (
                <WorkbenchPage
                  route={safeRoute}
                  role={role}
                  workspace={workspace}
                  selected={selected}
                  current={current}
                  online={online}
                  onSelect={setSelected}
                  onOpenCommand={(item, action) => setDialog({ item, action })}
                  onCreateInspection={createInspection}
                  onCreateIssue={createIssue}
                />
              )}
              {safeRoute === "capture" && (
                <CapturePage
                  client={client}
                  workspace={workspace}
                  online={online}
                  refresh={refresh}
                  notify={setToast}
                />
              )}
              {safeRoute === "documents" && (
                <DocumentPage
                  client={client}
                  workspace={workspace}
                  online={online}
                  refresh={refresh}
                />
              )}
              {safeRoute === "registers" && (
                <RegisterPage client={client} workspace={workspace} />
              )}
              {safeRoute === "admin" && (
                <AdminPage client={client} workspace={workspace} />
              )}
            </>
          )}
        </main>
        <footer className="app-footer">
          DOUL INTERNATIONAL <span>업무 원본 · 증빙 · 검증 · 기록</span>
        </footer>
      </div>
      <MobileNavigation
        activeId={safeRoute}
        items={mobileItems.map(({ id, label, icon }) => ({
          id,
          label,
          icon: <Icon name={icon} />,
        }))}
        onNavigate={nav}
        onMore={() => setMenu(!menu)}
        moreOpen={menu}
        moreActive={!mobileItems.some((item) => item.id === safeRoute)}
        moreIcon={<Icon name="layers" />}
      />
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
