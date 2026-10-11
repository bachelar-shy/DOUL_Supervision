import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
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
import { OfflineCommandIntentPanel } from "../pages/OfflineCommandIntentPanel";
import { offlineIntentTitle } from "../data/offline-command-labels";
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

// Production UI defaults to the agreed five field workflows; development keeps
// full module coverage. Operators can explicitly override with VITE_DOUL_UI_SCOPE.
export const fieldCoreMode =
  import.meta.env.VITE_DOUL_UI_SCOPE === "field-core" ||
  (import.meta.env.PROD && import.meta.env.VITE_DOUL_UI_SCOPE !== "full");

const DrawingReviewPage = lazy(() => import("../pages/DrawingReviewPage").then((module) => ({ default: module.DrawingReviewPage })));

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem("doul.ui.sidebar.collapsed.v1") === "true"; }
    catch { return false; }
  });
  const navigationCopy = quietGraphiteNavigationCopy[quietGraphiteLanguage(i18n.resolvedLanguage ?? i18n.language)];
  const [dialog, setDialog] = useState<{
    item: WorkItem;
    action: CommandDescriptor;
  } | null>(null);
  useEffect(() => {
    try { window.localStorage.setItem("doul.ui.sidebar.collapsed.v1", String(sidebarCollapsed)); }
    catch { /* The optional navigation preference does not block work. */ }
  }, [sidebarCollapsed]);
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
  return (
    <div className={"app-shell" + (sidebarCollapsed ? " sidebar-collapsed" : "")} data-design-system="quiet-graphite-a">
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
          <span className="dot" /> {t("app.contractRef")}
          <small>{t("app.footer.tagline")}</small>
        </div>
      </aside>
      {menu && <button type="button" className="sidebar-backdrop" aria-label={t("app.menuClose")} onClick={() => setMenu(false)} />}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button menu-toggle"
            aria-label={t("app.menuOpen")}
            aria-controls="side-navigation"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Icon name="layers" />
          </button>
          <div className="breadcrumbs">
            DOUL / <b>{routeLabel(routes.find((x) => x.id === safeRoute))}</b>
          </div>
          <div className="top-actions">
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
            <>{t("app.demo.live")}</>
          )}
        </div>
        {!online && (
          <div role="alert" className="offline-bar">
            {t("app.offlineReadOnly")}
          </div>
        )}
        <main>
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
              {safeRoute === "drawings" && fieldCoreMode && (
                <div data-ui-page="field-drawings">
                  <Suspense fallback={<div className="loading-panel">{t("app.loading.workspace")}</div>}>
                    <DrawingReviewPage client={client} workspace={workspace} onNavigate={nav} onChanged={refresh} onSelect={setSelected} onOpenCommand={(item, action) => setDialog({ item, action })} />
                  </Suspense>
                </div>
              )}
              {safeRoute === "drawings" && !fieldCoreMode && (
                <DrawingReviewPage
                  key={`${workspace.project.id}:${workspace.role.id}:drawings`}
                  client={client}
                  workspace={workspace}
                  onChanged={refresh}
                  onSelect={setSelected}
                  onNavigate={nav}
                  onOpenCommand={(item, action) => setDialog({ item, action })}
                />
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
