import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, PanelLeftClose, PanelLeftOpen, Rows3, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  AccessibleProjects,
  CommandDescriptor,
  Fields,
  HumanRole,
  WorkItem,
  Workspace,
} from "../data/ui-contract";
import { ApiError, type DemoProject, type SupervisionClient } from "../data/supervision-client";
import { reasonLabel, roles } from "../labels";
import { ActionButton, EmptyState, PageHeader } from "../ui";
import { MobileNavigation, NavigationList } from "../ui/catalog";
import {
  AdminPage,
  CapturePage,
  CommandModal,
  ContractPage,
  MeasurementPaymentPage,
  CompletionHandoverPage,
  DocumentPage,
  OwnerGovernancePage,
  ParallelTestPage,
  RegisterPage,
  SafetyPage,
  SchedulePage,
  TodayPage,
  WorkbenchPage,
} from "../pages";
import { Icon } from "../pages/shared";
import { recordTitle } from "../pages/record-utils";
import { OfflineCommandIntentPanel } from "../pages/OfflineCommandIntentPanel";
import { FieldPhotoLibrary } from "../pages/FieldPhotoLibrary";
import { FieldWorkAreas } from "../pages/FieldWorkAreas";
import { FieldOfflineQueue } from "../pages/FieldOfflineQueue";
import { PersonnelRequestPage } from "../pages/PersonnelRequestPage";
import { offlineIntentTitle } from "../data/offline-command-labels";
import { requestDrawingFocus } from "../data/drawing-focus";
import { fieldCoreRouteFor, fieldCoreRoutes, machineForRoute, mobileRoutes, roleRoutes, routes, type CorrectionSection } from "./routes";
import { paymentLabelKeys } from "../data/payment-workspace";
import { completionLabelKeys } from "../data/completion-workspace";
import {
  appLanguages,
  changeAppLanguage,
  type AppLanguage,
} from "../i18n/config";
import { formatLongDate } from "../i18n/format";
import { quietGraphiteLanguage, quietGraphiteNavigationCopy } from "../design/quiet-graphite-copy";

// The user-facing app always defaults to the agreed five field workflows,
// including the development server used for site trials. Internal verification
// must explicitly opt into all modules with VITE_DOUL_UI_SCOPE=full.
export const fieldCoreMode = import.meta.env.VITE_DOUL_UI_SCOPE !== "full";

const DrawingSheetWorkspace = lazy(() => import("../pages/DrawingSheetWorkspace").then((module) => ({ default: module.DrawingSheetWorkspace })));

function millisecondsUntilNextLocalDay(now: Date) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 50);
  return Math.max(1000, next.getTime() - now.getTime());
}

export function AppShell({ client, passwordMode = false, onLogout }: { client: SupervisionClient; passwordMode?: boolean; onLogout?: (revoked: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const roleLabel = (value: HumanRole) =>
    t(`roles.${value}`, { defaultValue: roles[value] });
  const routeLabel = (value: (typeof routes)[number] | undefined) => {
    if (!value) return "";
    if (fieldCoreMode && value.id === "owner") return t("launch.reports");
    if (fieldCoreMode && value.id === "drawings") return t("launch.drawings");
    if (fieldCoreMode && value.id === "capture") return t("launch.notes");
    return t(value.labelKey ?? "", { defaultValue: value.label });
  };
  const [role, setRole] = useState<HumanRole>(passwordMode ? client.session?.actor.actorGroup ?? "SUP" : "SUP");
  const [approvedProjects,setApprovedProjects]=useState<AccessibleProjects["items"]>([]);
  const [pendingPersonnelRequests, setPendingPersonnelRequests] = useState(0);
  const [projectSwitching,setProjectSwitching]=useState(false);
  const [demoProjects, setDemoProjects] = useState<DemoProject[]>([]);
  const [projectChoice, setProjectChoice] = useState("");
  const [projectDirectoryReady, setProjectDirectoryReady] = useState(client.kind !== "http" || passwordMode);
  const [todayDate, setTodayDate] = useState(() => formatLongDate(new Date()));
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [route, setRoute] = useState(location.hash.slice(2) || "today");
  const [selected, setSelected] = useState<string | null>(null);
  const [correctionSection, setCorrectionSection] = useState<CorrectionSection>("issues");
  const [reportSection, setReportSection] = useState<"reports" | "forms">("reports");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [menu, setMenu] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const globalSearchRef = useRef<HTMLInputElement>(null);
  const searchAreaRef = useRef<HTMLDivElement>(null);
  const [compactDensity, setCompactDensity] = useState(() => {
    try { return window.localStorage.getItem("doul.ui.field-layout.compact.v1") !== "false"; }
    catch { return true; }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem("doul.ui.sidebar.collapsed.v1") === "true"; }
    catch { return false; }
  });
  const [projectViewport,setProjectViewport]=useState(() => window.innerWidth < 768 ? "phone" : window.innerWidth <= 1100 ? "tablet" : "desktop");
  useEffect(()=>{
    const resize=()=>setProjectViewport(window.innerWidth < 768 ? "phone" : window.innerWidth <= 1100 ? "tablet" : "desktop");
    window.addEventListener("resize",resize);
    return ()=>window.removeEventListener("resize",resize);
  },[]);
  const hasProjectChoices=passwordMode ? approvedProjects.length>1 : demoProjects.length>1;
  const projectPickerInHeader=hasProjectChoices&&(projectViewport==="tablet"||(projectViewport==="desktop"&&sidebarCollapsed));
  const navigationCopy = quietGraphiteNavigationCopy[quietGraphiteLanguage(i18n.resolvedLanguage ?? i18n.language)];
  const [dialog, setDialog] = useState<{
    item: WorkItem;
    action: CommandDescriptor;
  } | null>(null);
  useEffect(() => {
    try { window.localStorage.setItem("doul.ui.sidebar.collapsed.v1", String(sidebarCollapsed)); }
    catch { /* The optional navigation preference does not block work. */ }
  }, [sidebarCollapsed]);
  useEffect(() => {
    try { window.localStorage.setItem("doul.ui.field-layout.compact.v1", String(compactDensity)); }
    catch { /* Density is optional and never blocks work. */ }
  }, [compactDensity]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        globalSearchRef.current?.focus();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        globalSearchRef.current?.blur();
      }
    };
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !searchAreaRef.current?.contains(event.target))
        setSearchOpen(false);
    };
    window.addEventListener("keydown", keyboard);
    document.addEventListener("mousedown", outside);
    return () => {
      window.removeEventListener("keydown", keyboard);
      document.removeEventListener("mousedown", outside);
    };
  }, []);
  const sequence = useRef(0);
  const refreshSequence = useRef(0);
  const activeRole = useRef(role);
  const refresh = useCallback(async () => {
    if (client.session?.actor.actorGroup !== activeRole.current) return;
    const generation = sequence.current;
    const n = ++refreshSequence.current;
    const current = () => generation === sequence.current && n === refreshSequence.current;
    setLoading(true);
    try {
      const next = await client.workspace();
      if (!current()) return;
      setWorkspace(next);
      setError("");
    } catch (e) {
      if (current()) setError(e instanceof ApiError ? reasonLabel(e.detail.code) : t("app.error.connection"));
    } finally {
      if (current()) setLoading(false);
    }
  }, [client, t]);
  useEffect(() => {
    if (!passwordMode || client.kind !== "http") return;
    let current = true;
    void client.accessibleProjects().then(directory => {
      if (current) setApprovedProjects(directory.items);
    }).catch(() => { if (current) setApprovedProjects([]); });
    return () => { current = false; };
  }, [client, passwordMode, workspace?.project.id, workspace?.project.name]);
  async function switchProject(projectId: string) {
    if (projectId === client.session?.projectId) return true;
    if (projectSwitching || !online) return false;
    // Retain the current workspace until the server has approved the new session.
    ++sequence.current; ++refreshSequence.current;
    setProjectSwitching(true); setDialog(null); setSelected(null); setError("");
    try {
      const session = await client.selectProject(projectId);
      activeRole.current = session.actor.actorGroup;
      setRole(session.actor.actorGroup); setWorkspace(null); setLoading(true);
      setProjectChoice(session.projectId); nav("today"); setMenu(false);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? reasonLabel(e.detail.code) : t("app.error.connection"));
      setLoading(false);
      return false;
    } finally { setProjectSwitching(false); }
  }
  useEffect(() => {
    if (client.kind !== "http" || passwordMode) {
      setProjectDirectoryReady(true);
      return;
    }
    let mounted = true;
    setProjectDirectoryReady(false);
    void client.demoProjects().then((directory) => {
      if (!mounted) return;
      setDemoProjects(directory.items);
      setProjectChoice(directory.defaultProjectId);
    }).catch(() => {
      /* Production hosts never expose /dev/projects. */
      if (mounted) {
        setDemoProjects([]);
        setProjectChoice("");
      }
    }).finally(() => {
      if (mounted) setProjectDirectoryReady(true);
    });
    return () => { mounted = false; };
  }, [client, passwordMode]);
  useEffect(() => {
    if (!projectDirectoryReady) return;
    const n = ++sequence.current;
    setLoading(true);
    (passwordMode ? Promise.resolve(client.session) : client.login(role, projectChoice || undefined))
      .then(() => n === sequence.current ? client.workspace() : undefined)
      .then((w) => {
        if (w && n === sequence.current) { setWorkspace(w); setError(""); }
      })
      .catch((e) => {
        if (n === sequence.current) setError(e instanceof ApiError ? reasonLabel(e.detail.code) : t("app.error.connection"));
      })
      .finally(() => {
        if (n === sequence.current) setLoading(false);
      });
    return () => { ++sequence.current; };
  }, [client, role, passwordMode, projectChoice, projectDirectoryReady]);
  useEffect(() => {
    let timer = 0;
    setTodayDate(formatLongDate(new Date()));
    const scheduleDateRefresh = () => {
      const now = new Date();
      timer = window.setTimeout(() => {
        setTodayDate(formatLongDate(new Date()));
        scheduleDateRefresh();
      }, millisecondsUntilNextLocalDay(now));
    };
    scheduleDateRefresh();
    return () => window.clearTimeout(timer);
  }, [i18n.resolvedLanguage]);
  useEffect(() => {
    const net = () => setOnline(navigator.onLine);
    const hash = () => {
      setRoute(location.hash.slice(2) || "today");
      setSelected(null);
      setDialog(null);
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
  useEffect(() => {
    if (!menu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menu]);
  // Development-only diagnostics belong to the SUP/ADM route definitions.
  // Never append them to contractor, owner, or designer navigation based on
  // whether a synthetic project's workspace has finished loading.
  const allowed = fieldCoreMode ? fieldCoreRoutes[role] : roleRoutes[role];
  // Only synthetic, unauthenticated development sessions may deep-link to
  // integration diagnostics. Never add diagnostics to CON/OWN/DES navigation,
  // stage-one field routes, or a real password-authenticated session.
  const demoDiagnosticDeepLink = !fieldCoreMode && !passwordMode
    && client.kind === "http" && workspace?.demo === true && route === "parallel-test";
  const nav = (to: string) => {
    const resolved = fieldCoreMode ? fieldCoreRouteFor(to) : { route: to };
    const target = allowed.includes(resolved.route) ? resolved.route : "today";
    if ("correction" in resolved && resolved.correction) setCorrectionSection(resolved.correction);
    if ("reportForm" in resolved && resolved.reportForm) setReportSection("forms");
    else if (target === "owner") setReportSection("reports");
    history.pushState(null, "", "#/" + target);
    setRoute(target);
    setSelected(null);
    setDialog(null);
    setMenu(false);
    setSearchOpen(false);
  };
  const safeRoute = allowed.includes(route) || demoDiagnosticDeepLink ? route : "today";
  useEffect(() => {
    if (!fieldCoreMode) return;
    const mapped = fieldCoreRouteFor(route);
    const target = allowed.includes(mapped.route) ? mapped.route : "today";
    if (target === route) return;
    if (mapped.correction) setCorrectionSection(mapped.correction);
    if (mapped.reportForm) setReportSection("forms");
    history.replaceState(null, "", "#/" + target);
    setRoute(target);
    setSelected(null);
  }, [route, role]);
  useEffect(() => {
    if (fieldCoreMode || !workspace || allowed.includes(route) || demoDiagnosticDeepLink) return;
    history.replaceState(null, "", "#/today");
    setRoute("today");
    setSelected(null);
    setMenu(false);
  }, [allowed, route, workspace, demoDiagnosticDeepLink]);
  useEffect(() => {
    if (role !== "ADM" || !workspace || client.kind !== "http") {
      setPendingPersonnelRequests(0);
      return;
    }
    let active = true;
    setPendingPersonnelRequests(0);
    const loadPending = () => {
      void client.request<{ pendingCount: number }>(client.path("/personnel-requests"))
        .then(result => { if (active) setPendingPersonnelRequests(Math.max(0, result.pendingCount || 0)); })
        .catch(() => { if (active) setPendingPersonnelRequests(0); });
    };
    loadPending();
    window.addEventListener("focus", loadPending);
    const interval = window.setInterval(loadPending, 60_000);
    return () => { active = false; window.removeEventListener("focus", loadPending); window.clearInterval(interval); };
  }, [client, role, workspace?.project.id]);
  const mobileChoices = fieldCoreMode
    ? routes.filter((item) => allowed.includes(item.id) && ["today", "capture", "inspections", "corrections"].includes(item.id))
    : mobileRoutes[role];
  const mobileItems = mobileChoices
    .filter((item) => allowed.includes(item.id))
    .map((item) => ({
      ...item,
      label: routeLabel(item),
    }));
  const items = workspace?.items || [];
  const trimmedSearch = globalSearch.trim().toLocaleLowerCase();
  const menuMatches = trimmedSearch.length
    ? routes.filter((entry) => allowed.includes(entry.id)
        && routeLabel(entry).toLocaleLowerCase().includes(trimmedSearch)).slice(0, 6)
    : [];
  const recordMatches = trimmedSearch.length >= 2
    ? items.filter((item) => recordTitle(item.record).toLocaleLowerCase().includes(trimmedSearch)
        || item.record.id.toLocaleLowerCase().includes(trimmedSearch)).slice(0, 6)
    : [];
  const current = items.find((x) => x.record.id === selected) || null;
  async function perform(
    item: WorkItem,
    command: string,
    payload: Fields = {},
    evidenceIds: string[] = [],
  ) {
    if (!online) throw new Error(t("app.error.offline"));
    await client.execute(item, command, payload, evidenceIds);
    setToast(t("app.toast.serverProcessed"));
    await refresh();
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
      setToast(t("app.toast.issuePublished"));
      await refresh();
      nav("issues");
    } catch (e) {
      setError(e instanceof ApiError ? reasonLabel(e.detail.code) : t("app.error.connection"));
    }
  }
  function renderProjectPicker() {
    return <>
            {passwordMode && approvedProjects.length > 1 && <label className="project-switch">
              프로젝트 선택
              <select aria-label="프로젝트 선택" value={client.session?.projectId ?? ""}
                disabled={projectSwitching || !online} onChange={e=>void switchProject(e.target.value)}>
                {approvedProjects.map(project=><option key={project.projectId} value={project.projectId}>{project.name}</option>)}
              </select>
            </label>}
                {!passwordMode && demoProjects.length > 1 && (
                  <label className="project-switch">
                    시험 프로젝트{" "}
                    <select aria-label="프로젝트 선택" value={projectChoice}
                      onChange={(e) => {
                        if (e.target.value === projectChoice) return;
                        ++sequence.current;
                        setDialog(null);
                        setSelected(null);
                        setError("");
                        setWorkspace(null);
                        setLoading(true);
                        setProjectChoice(e.target.value);
                        nav("today");
                        setMenu(false);
                      }}>
                      {demoProjects.map((project) => (
                        <option key={project.projectId} value={project.projectId}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
    </>;
  }
  return (
    <div className={"app-shell" + (sidebarCollapsed ? " sidebar-collapsed" : "") + (compactDensity ? " is-compact" : "")}
      data-design-system="quiet-graphite-a" data-layout-system="field-workspace"
      data-workspace-route={safeRoute}>
      <aside id="side-navigation" className={"sidebar " + (menu ? "open" : "")} data-navigation-collapsed={String(sidebarCollapsed)}>
        <button type="button" className="sidebar-close" aria-label={t("app.menuClose")}
          onClick={() => setMenu(false)}>×</button>
        <div className="sidebar-identity">
          <div className="brand">
            <b>
              DOUL<span> / </span>
            </b>
            <small>SUPERVISION</small>
          </div>
          <button type="button" className="sidebar-collapse-toggle"
            aria-label={sidebarCollapsed ? navigationCopy.expand : navigationCopy.collapse}
            title={sidebarCollapsed ? navigationCopy.expand : navigationCopy.collapse}
            aria-pressed={sidebarCollapsed}
            onClick={() => setSidebarCollapsed((current) => !current)}>
            {sidebarCollapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}
          </button>
        </div>
        <div className="workspace-label">{t("app.workspace")}</div>
        <div className="project-chip">
          <span className="project-mark">D</span>
          <div>
            <strong>{workspace?.project.name ?? t("app.sampleSite")}</strong>
            {workspace?.demo && <small>{t("app.sampleData")}</small>}
            {!projectPickerInHeader && renderProjectPicker()}
          </div>
        </div>
        <NavigationList
          activeId={safeRoute}
          onNavigate={nav}
          items={(fieldCoreMode
            ? fieldCoreRoutes[role].map((id) => routes.find((entry) => entry.id === id)).filter((entry): entry is (typeof routes)[number] => Boolean(entry))
            : routes.filter((entry) =>
                allowed.includes(entry.id) &&
                entry.id !== "corrections"))
            .map(({ id, label, labelKey, icon }) => ({
              id,
              label: routeLabel({ id, label, labelKey, icon }),
              icon: <Icon name={icon} />,
              badge:
                id === "admin" && pendingPersonnelRequests > 0
                  ? pendingPersonnelRequests
                  : id === "observations"
                  ? items.filter(
                      (item) =>
                        item.machine === "observation" &&
                        item.record.status !== "confirmed",
                    ).length
                  : undefined,
            }))}
        />
        <div className="side-bottom">
          <span className="dot" /> {t("app.contractRef")}
          <small>{t("app.footer.tagline")}</small>
        </div>
      </aside>
      {menu && <button type="button" className="sidebar-backdrop" aria-label={t("app.menuClose")} onClick={() => setMenu(false)} />}
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-start">
            <button
              className="icon-button menu-toggle"
              aria-label={t("app.menuOpen")}
              aria-controls="side-navigation"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Icon name="layers" />
            </button>
            {projectPickerInHeader ? <div className="header-project-picker">{renderProjectPicker()}</div> : <div className="breadcrumbs" data-ui-component="project-context-breadcrumb">
              <span>DOUL</span> <span aria-hidden="true">/</span> <b title={workspace?.project.name ?? t("app.sampleSite")}>{workspace?.project.name ?? t("app.sampleSite")}</b>
            </div>}
          </div>
          <div className="workspace-global-search" ref={searchAreaRef} data-ui-component="global-navigation-search">
            <Search aria-hidden="true" size={16} />
            <input ref={globalSearchRef} type="search" aria-label="메뉴 및 업무 검색"
              placeholder="메뉴·업무 검색 (Ctrl+K)" value={globalSearch}
              onFocus={() => setSearchOpen(true)} onChange={(event) => {
                setGlobalSearch(event.target.value);
                setSearchOpen(true);
              }} />
            {globalSearch && <button type="button" className="search-clear" aria-label="검색어 지우기" onClick={() => {
              setGlobalSearch(""); globalSearchRef.current?.focus();
            }}><X size={15} aria-hidden="true" /></button>}
            {searchOpen && trimmedSearch && <div className="workspace-search-results" role="group" aria-label="검색 결과">
              {menuMatches.length > 0 && <div className="workspace-search-caption">메뉴</div>}
              {menuMatches.map((entry) => <button type="button" key={entry.id} onClick={() => {
                nav(entry.id); setGlobalSearch("");
              }}><Icon name={entry.icon} /><span>{routeLabel(entry)}</span></button>)}
              {recordMatches.length > 0 && <div className="workspace-search-caption">업무 기록</div>}
              {recordMatches.map((item) => <button type="button" key={item.record.id} onClick={() => {
                const routeEntry = Object.entries(machineForRoute).find(([target, machines]) =>
                  machines.includes(item.machine) && (allowed.includes(target)
                    || (fieldCoreMode && allowed.includes(fieldCoreRouteFor(target).route))));
                if (routeEntry) nav(routeEntry[0]);
                else nav("today");
                setSelected(item.record.id);
                setGlobalSearch("");
              }}><Icon name="document" /><span>{recordTitle(item.record)}</span><small>{item.record.id.slice(0, 6)}</small></button>)}
              {!menuMatches.length && !recordMatches.length &&
                <p>일치하는 메뉴나 기록이 없습니다.</p>}
            </div>}
          </div>
          <div className="top-actions">
            <button type="button" className="workspace-density-toggle"
              title={compactDensity ? "여유 있는 간격으로 보기" : "조밀하게 보기"}
              aria-label="화면 밀도 변경" aria-pressed={compactDensity}
              onClick={() => setCompactDensity((value) => !value)}>
              <Rows3 size={16} aria-hidden="true" />
            </button>
            <span className={"connection " + (!online ? "offline" : "")}>
              {online ? t("app.connection.online") : t("app.connection.offline")}
            </span>
            <label className="role-picker">
              {t("app.languagePicker")}{" "}
              <select
                aria-label={t("app.languagePickerAria")}
                value={i18n.resolvedLanguage ?? i18n.language}
                onChange={(e) =>
                  void changeAppLanguage(e.target.value as AppLanguage)
                }
              >
                {appLanguages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.nativeName}
                  </option>
                ))}
              </select>
            </label>
            {!passwordMode && <label className="role-picker">
              {t("app.rolePicker")}{" "}
              <select
                aria-label={t("app.rolePickerAria")}
                value={role}
                onChange={(e) => {
                  if (e.target.value === activeRole.current) return;
                  ++sequence.current;
                  activeRole.current = e.target.value as HumanRole;
                  setDialog(null);
                  setError("");
                  setWorkspace(null);
                  setLoading(true);
                  setRole(e.target.value as HumanRole);
                  setSelected(null);
                  nav("today");
                }}
              >
                {Object.keys(roles).map((k) => (
                  <option key={k} value={k}>
                    {roleLabel(k as HumanRole)}
                  </option>
                ))}
              </select>
            </label>}
            {passwordMode && <button className="secondary" onClick={() => {void client.logout().then(() => onLogout?.(true)).catch(() => onLogout?.(false));}}>{t("auth.logout")}</button>}
            <span className="avatar">{roleLabel(role)[0]}</span>
          </div>
        </header>
        <div className="demo-bar">
          {client.kind === "mock" ? (
            <>
              {t("app.demo.mock")}{" "}
              <span>{t("app.demo.mockDetail")}</span>
            </>
          ) : (
            <>{workspace?.context.dataClassification === "SYNTHETIC_TEST_NOT_SITE_EVIDENCE" ? "합성 테스트 자료 · 실제 현장 증빙 아님" : t("app.demo.live")}</>
          )}
        </div>
        {!online && (
          <div role="alert" className="offline-bar">
            {t("app.offlineReadOnly")}
          </div>
        )}
        <main data-ui-component="workspace-main">
          <PageHeader
            eyebrow={t("mobile.roleWorkspace", { role: roleLabel(role) })}
            title={routeLabel(routes.find((x) => x.id === safeRoute))}
            description={
              safeRoute === "today"
                ? t("app.page.todayDescription")
                : safeRoute === "registers"
                  ? t("app.page.registersDescription")
                  : safeRoute === "safety"
                    ? t("app.page.safetyDescription")
                    : safeRoute === "contract"
                      ? t("app.page.contractDescription")
                      : t("app.page.defaultDescription")
            }
            details={
              safeRoute === "today" ? (
                <div className="heading-context">
                  <span data-ui-component="today-date-context">
                    <CalendarDays aria-hidden="true" />
                    {todayDate}
                  </span>
                </div>
              ) : null
            }
            actions={
              <>
                <ActionButton
                  onClick={() => void refresh()}
                  disabled={loading || !online}
                >
                  <Icon name="refresh" />
                  {t("app.action.refresh")}
                </ActionButton>
                {role === "SUP" && (
                  <ActionButton
                    variant="primary"
                    onClick={() => nav("capture")}
                  >
                    <Icon name="camera" />
                    {t("app.action.capture")}
                  </ActionButton>
                )}
              </>
            }
          />
          {workspace && client.kind !== "mock" && <details className="mb-3">
            <summary>{offlineIntentTitle(i18n.resolvedLanguage || "ko")}</summary>
            <OfflineCommandIntentPanel key={`${workspace.project.id}:${client.session?.actor.roleAssignmentId ?? workspace.role.id}:${client.session?.actor.partyId}`} client={client} workspace={workspace} online={online} onChanged={refresh} />
            <FieldOfflineQueue key={`outbox:${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} online={online} onChanged={refresh} />
          </details>}
          {error && (
            <div role="alert" className="error-box">
              <strong>{t("app.error.unprocessed")}</strong> {error}
              <button onClick={() => setError("")} aria-label={t("app.error.dismiss")}>
                ×
              </button>
            </div>
          )}
          {!workspace && loading ? (
            <div className="loading-panel">
              {t("app.loading.workspace")}
            </div>
          ) : !workspace ? (
            <EmptyState
              title={t("app.error.apiUnavailable")}
              description={t("app.error.apiHelp")}
              action={
                <ActionButton onClick={() => void refresh()}>
                  {t("app.action.retry")}
                </ActionButton>
              }
            />
          ) : (
            <>
              {safeRoute === "today" && (
                <TodayPage
                  role={role}
                  workspace={workspace}
                  client={client}
                  onOpenDrawingPin={(sheetId, pinId) => {
                    nav("drawings");
                    if (!requestDrawingFocus(workspace.project.id, sheetId, pinId))
                      setToast("해당 도면 마크를 열지 못했습니다.");
                  }}
                  allowedRoutes={fieldCoreMode && allowed.includes("corrections") ? [...allowed, "observations", "issues", "actions"] : allowed}
                  onNavigate={nav}
                  onOpenItem={(item) => {
                    nav(Object.entries(machineForRoute).find(([, machines]) =>
                      machines.includes(item.machine))?.[0] ?? "today");
                    setSelected(item.record.id);
                  }}
                />
              )}
              {safeRoute === "schedule" && (
                <SchedulePage client={client} workspace={workspace} selected={selected}
                  current={current} online={online} onSelect={setSelected} refresh={refresh}
                  onOpenCommand={(item, action) => setDialog({ item, action })} />
              )}
              {safeRoute === "contract" && (
                <ContractPage
                  client={client}
                  workspace={workspace}
                  selected={selected}
                  current={current}
                  online={online}
                  onSelect={setSelected}
                  refresh={refresh}
                  onOpenCommand={(item, action) => setDialog({ item, action })}
                />
              )}
              {safeRoute === "payment" && (
                <MeasurementPaymentPage
                  client={client} workspace={workspace} selected={selected}
                  current={current} online={online} onSelect={setSelected}
                  refresh={refresh}
                  onOpenCommand={(item, action) => setDialog({ item, action })}
                  createCapabilities={workspace.context.creationCapabilities}
                  labels={Object.fromEntries(paymentLabelKeys.map(key => [key, t(`payment.${key}`)]))}
                />
              )}
              {safeRoute === "completion" && (
                <CompletionHandoverPage
                  client={client} workspace={workspace} selected={selected}
                  current={current} online={online} onSelect={setSelected}
                  refresh={refresh}
                  onOpenCommand={(item, action) => setDialog({ item, action })}
                  labels={Object.fromEntries(completionLabelKeys.map(key => [key, t(`completion.${key}`)]))}
                />
              )}
              {safeRoute === "safety" && (
                <SafetyPage
                  client={client}
                  onCreated={async (record) => { await refresh(); setSelected(record.id); }}
                  workspace={workspace}
                  selected={selected}
                  current={current}
                  online={online}
                  onSelect={setSelected}
                  onOpenCommand={(item, action) => setDialog({ item, action })}
                />
              )}
              {safeRoute === "owner" && fieldCoreMode && (
                <div role="tablist" aria-label={t("launch.reports")} className="flex flex-wrap gap-2 pb-3">
                  <button type="button" role="tab" aria-selected={reportSection === "reports"} className={reportSection === "reports" ? "primary" : "secondary"} onClick={() => { setReportSection("reports"); setSelected(null); }}>{t("launch.ownerReports")}</button>
                  <button type="button" role="tab" aria-selected={reportSection === "forms"} className={reportSection === "forms" ? "primary" : "secondary"} onClick={() => { setReportSection("forms"); setSelected(null); }}>{t("launch.reportForms")}</button>
                </div>
              )}
              {safeRoute === "owner" && (!fieldCoreMode || reportSection === "reports") && (
                <OwnerGovernancePage
                  client={client}
                  onCreated={async (record) => { await refresh(); setSelected(record.id); }}
                  workspace={workspace}
                  selected={selected}
                  current={current}
                  online={online}
                  onSelect={setSelected}
                  onOpenCommand={(item, action) => setDialog({ item, action })}
                />
              )}
              {safeRoute === "drawings" && (
                <div data-ui-page="field-drawings" className="drawing-sheet-shell">
                  <Suspense fallback={<div className="loading-panel">{t("app.loading.workspace")}</div>}>
                    <DrawingSheetWorkspace
                      key={`${workspace.project.id}:${workspace.role.id}:drawing-sheets`}
                      client={client} workspace={workspace}
                      onChanged={refresh} onSelect={setSelected} onNavigate={nav}
                      onOpenCommand={(item, action) => setDialog({ item, action })}
                    />
                  </Suspense>
                </div>
              )}
              {safeRoute === "corrections" && (
                <div data-ui-page="field-corrections">
                  <div role="tablist" aria-label={t("launch.corrections")} className="flex flex-wrap gap-2 pb-3">
                    {(["observations", "issues", "actions"] as CorrectionSection[]).map((section) => (
                      <button key={section} type="button" role="tab" aria-selected={correctionSection === section}
                        className={correctionSection === section ? "primary" : "secondary"}
                        onClick={() => { setCorrectionSection(section); setSelected(null); }}>
                        {t("launch." + section)}
                      </button>
                    ))}
                  </div>
                  <WorkbenchPage
                    route={correctionSection} role={role} workspace={workspace}
                    selected={selected} current={current} online={online} onSelect={setSelected}
                    onOpenCommand={(item, action) => setDialog({ item, action })}
                    client={client}
                    onChanged={refresh}
                    onInspectionCreated={async (record) => { await refresh(); setSelected(record.id); }}
                    onActionCreated={async (record) => { await refresh(); setSelected(record.id); }}
                    onCreateIssue={createIssue}
                  />
                </div>
              )}
              {safeRoute === "owner" && fieldCoreMode && reportSection === "forms" && (
                <DocumentPage client={client} workspace={workspace} online={online} refresh={refresh} />
              )}
              {!["owner", "safety", "schedule", "contract", "payment", "completion"].includes(safeRoute) && machineForRoute[safeRoute] && (
                <WorkbenchPage
                  route={safeRoute}
                  role={role}
                  workspace={workspace}
                  selected={selected}
                  current={current}
                  online={online}
                  onSelect={setSelected}
                  onOpenCommand={(item, action) => setDialog({ item, action })}
                  client={client}
                  onChanged={refresh}
                  onInspectionCreated={async record => { await refresh(); setSelected(record.id); }}
                  onActionCreated={async record => { await refresh(); setSelected(record.id); }}
                  onCreateIssue={createIssue}
                />
              )}
              {safeRoute === "capture" && (
                <>
                  <CapturePage
                    client={client}
                    workspace={workspace}
                    online={online}
                    refresh={refresh}
                    notify={setToast}
                  />
                  {client.kind === "http" && (
                    <FieldPhotoLibrary key={workspace.project.id + ":" + workspace.role.id}
                      client={client} workspace={workspace} online={online} />
                  )}
                </>
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
              {safeRoute === "staff-requests" && (
                <PersonnelRequestPage key={workspace.project.id + ":" + workspace.role.id} client={client} workspace={workspace} online={online} />
              )}
              {safeRoute === "admin" && (
                <>
                  <AdminPage key={workspace.project.id} client={client} workspace={workspace} online={online} onChanged={refresh} onProjectCreated={async projectId=>{const directory=await client.accessibleProjects();setApprovedProjects(directory.items);if(!await switchProject(projectId))throw new Error("Project selection did not complete");nav("admin");}} />
                  {client.kind === "http" && <FieldWorkAreas key={workspace.project.id + ":" + workspace.role.id}
                    client={client} workspace={workspace} online={online} />}
                </>
              )}
              {safeRoute === "parallel-test" && (
                <ParallelTestPage key={`${workspace.project.id}:${workspace.role.id}`} client={client} workspace={workspace} online={online} onNavigate={nav} onChanged={refresh} onSelect={setSelected} onOpenCommand={(item, action) => setDialog({ item, action })} />
              )}
            </>
          )}
        </main>
        <footer className="app-footer">
          DOUL INTERNATIONAL <span>{t("app.footer.tagline")}</span>
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
        moreControls="side-navigation"
        moreOpen={menu}
        moreActive={!mobileItems.some((item) => item.id === safeRoute)}
        moreIcon={<Icon name="layers" />}
      />
      {dialog && workspace && (
        <CommandModal
          dialog={dialog}
          workspace={workspace}
          onClose={() => setDialog(null)}
          onSubmit={async (p, evidenceIds) => {
            await perform(dialog.item, dialog.action.command, p, evidenceIds);
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
