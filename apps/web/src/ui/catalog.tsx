import { useMemo, useState, type HTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ChevronRight, Search } from "lucide-react";

export interface NavigationItemSpec {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}

export interface NavigationListProps {
  items: readonly NavigationItemSpec[];
  activeId?: string | null;
  onNavigate: (id: string) => void;
  ariaLabel?: string;
  className?: string;
}

export function NavigationList({
  items,
  activeId,
  onNavigate,
  ariaLabel,
  className,
}: NavigationListProps) {
  const { t } = useTranslation();
  const resolvedAriaLabel = ariaLabel ?? t("ui.navigation.mainAria");
  return (
    <nav
      aria-label={resolvedAriaLabel}
      className={cn("doul-navigation", className)}
      data-ui-component="navigation"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          data-route={item.id}
          className={activeId === item.id ? "active" : ""}
          aria-current={activeId === item.id ? "page" : undefined}
          title={typeof item.label === "string" ? item.label : undefined}
          disabled={item.disabled}
          onClick={() => onNavigate(item.id)}
        >
          {item.icon}
          <span>{item.label}</span>
          {item.badge !== undefined && item.badge !== null ? (
            <i
              aria-label={
                typeof item.badge === "number"
                  ? t("common.count", { count: item.badge })
                  : undefined
              }
            >
              {item.badge}
            </i>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

export interface MobileNavigationProps {
  items: readonly NavigationItemSpec[];
  activeId?: string | null;
  onNavigate: (id: string) => void;
  onMore: () => void;
  moreControls?: string;
  moreOpen?: boolean;
  moreActive?: boolean;
  moreIcon?: ReactNode;
  moreLabel?: ReactNode;
  ariaLabel?: string;
}

export function MobileNavigation({
  items,
  activeId,
  onNavigate,
  onMore,
  moreControls,
  moreOpen = false,
  moreActive = false,
  moreIcon,
  moreLabel,
  ariaLabel,
}: MobileNavigationProps) {
  const { t } = useTranslation();
  const resolvedMoreLabel = moreLabel ?? t("ui.navigation.more");
  const resolvedAriaLabel = ariaLabel ?? t("ui.navigation.mobileAria");
  return (
    <nav
      className="bottom-nav"
      aria-label={resolvedAriaLabel}
      data-ui-component="mobile-navigation"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          data-route={item.id}
          className={activeId === item.id ? "active" : ""}
          aria-current={activeId === item.id ? "page" : undefined}
          disabled={item.disabled}
          onClick={() => onNavigate(item.id)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
      <button
        type="button"
        className={moreActive ? "active" : ""}
        aria-expanded={moreOpen}
        aria-controls={moreControls}
        onClick={onMore}
      >
        {moreIcon}
        <span>{resolvedMoreLabel}</span>
      </button>
    </nav>
  );
}

export interface FilterBarProps extends HTMLAttributes<HTMLDivElement> {
  query?: string;
  onQueryChange?: (value: string) => void;
  queryPlaceholder?: string;
  queryLabel?: string;
  children?: ReactNode;
  actions?: ReactNode;
}

export function FilterBar({
  query,
  onQueryChange,
  queryPlaceholder,
  queryLabel,
  children,
  actions,
  className,
  ...props
}: FilterBarProps) {
  const { t } = useTranslation();
  const resolvedQueryPlaceholder = queryPlaceholder ?? t("ui.filter.search");
  const resolvedQueryLabel = queryLabel ?? t("ui.filter.listSearch");
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-y border-border bg-card px-3 py-2",
        className,
      )}
      data-ui-component="filter-bar"
      {...props}
    >
      {onQueryChange ? (
        <label className="relative min-w-52 flex-1 sm:max-w-80">
          <span className="sr-only">{resolvedQueryLabel}</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query ?? ""}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={resolvedQueryPlaceholder}
            className="pl-9"
          />
        </label>
      ) : null}
      {children}
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export interface RegisterNavigatorItem {
  id: string;
  name: string;
  modeLabel: string;
}

export interface RegisterNavigatorGroup {
  id: string;
  label: string;
  description?: string;
  items: readonly RegisterNavigatorItem[];
}

export function RegisterNavigator({
  roleLabel,
  roleDescription,
  activeId,
  recommendedItems,
  groups,
  onSelect,
}: {
  roleLabel: string;
  roleDescription: string;
  activeId: string;
  recommendedItems: readonly RegisterNavigatorItem[];
  groups: readonly RegisterNavigatorGroup[];
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) =>
            `${item.id} ${item.name}`.toLowerCase().includes(normalizedQuery),
          ),
        }))
        .filter((group) => group.items.length),
    [groups, normalizedQuery],
  );

  function itemButton(item: RegisterNavigatorItem) {
    const active = item.id === activeId;
    return (
      <button
        key={item.id}
        type="button"
        aria-current={active ? "page" : undefined}
        aria-label={t("registerNav.openAria", {
          id: item.id,
          name: item.name,
        })}
        className={cn(
          "group grid min-h-14 w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm border px-3 py-2.5 text-left transition-colors",
          active
            ? "border-primary bg-primary/5"
            : "border-border bg-background hover:border-slate-300 hover:bg-slate-50",
        )}
        onClick={() => onSelect(item.id)}
      >
        <span
          className={cn(
            "font-mono text-[10px] font-semibold",
            active ? "text-primary" : "text-slate-400",
          )}
        >
          {item.id}
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-[11px] font-semibold text-slate-700">
            {item.name}
          </strong>
          <small className="mt-0.5 block text-[9px] text-slate-400">
            {item.modeLabel}
          </small>
        </span>
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0",
            active ? "text-primary" : "text-slate-300 group-hover:text-slate-500",
          )}
        />
      </button>
    );
  }

  return (
    <section
      className="mb-4 overflow-hidden rounded-md border border-border bg-white"
      data-ui-component="register-navigator"
      data-role-preset={roleLabel}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-slate-50 px-4 py-3">
        <div>
          <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-primary">
            {t("registerNav.entryEyebrow")}
          </span>
          <h3 className="mt-1 text-sm font-semibold text-slate-800">
            {t("registerNav.roleSummary", { role: roleLabel })}
          </h3>
          <p className="mt-1 max-w-2xl text-[10px] leading-5 text-slate-500">
            {roleDescription}
          </p>
        </div>
        <div className="rounded-sm border border-border bg-white px-2.5 py-2 text-[10px] text-slate-500">
          {t("registerNav.serverScopeNotice")}
        </div>
      </div>

      <Tabs defaultValue="role" className="gap-0">
        <TabsList
          variant="line"
          className="w-full justify-start gap-5 border-b border-border bg-background px-4 py-1"
        >
          <TabsTrigger value="role" className="min-h-11 flex-none px-1.5 text-xs">
            {t("registerNav.roleTab")}
          </TabsTrigger>
          <TabsTrigger value="all" className="min-h-11 flex-none px-1.5 text-xs">
            {t("registerNav.allTab")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="role" className="m-0 p-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {recommendedItems.map(itemButton)}
          </div>
        </TabsContent>

        <TabsContent value="all" className="m-0">
          <div className="border-b border-border p-3">
            <label className="relative block">
              <span className="sr-only">{t("registerNav.searchAria")}</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("registerNav.searchPlaceholder")}
                className="pl-9"
              />
            </label>
          </div>
          <div className="max-h-[420px] overflow-y-auto p-4">
            {filteredGroups.length ? (
              <div className="space-y-5">
                {filteredGroups.map((group) => (
                  <section key={group.id} aria-labelledby={`register-group-${group.id}`}>
                    <div className="mb-2">
                      <h4
                        id={`register-group-${group.id}`}
                        className="text-[11px] font-semibold text-slate-700"
                      >
                        {group.label}
                        <span className="ml-1.5 font-normal text-slate-400">
                          {t("registerNav.groupCount", {
                            count: group.items.length,
                          })}
                        </span>
                      </h4>
                      {group.description ? (
                        <p className="mt-0.5 text-[9px] leading-4 text-slate-400">
                          {group.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {group.items.map(itemButton)}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="py-10 text-center text-xs text-slate-400">
                {t("registerNav.noResults")}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}

export interface RegisterColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
}

export interface RegisterTableProps<T> {
  rows: readonly T[];
  columns: readonly RegisterColumn<T>[];
  rowKey: (row: T) => string;
  emptyMessage?: ReactNode;
  className?: string;
}

export function RegisterTable<T>({
  rows,
  columns,
  rowKey,
  emptyMessage,
  className,
}: RegisterTableProps<T>) {
  const { t } = useTranslation();
  const resolvedEmptyMessage =
    emptyMessage ?? t("ui.registerTable.empty");
  return (
    <div
      className={cn("table-scroll overflow-auto", className)}
      data-ui-component="register-table"
    >
      <Table
        containerClassName="overflow-visible"
        className="border-collapse whitespace-nowrap text-[11px]"
      >
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.id}
                className={cn(
                  "h-auto bg-slate-50 px-3.5 py-3.5 text-[10px] font-medium text-slate-400",
                  column.className,
                )}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    className={cn(
                      "px-3.5 py-3.5 text-[11px] text-slate-600",
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                {resolvedEmptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export interface AuditTimelineEntry {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
}

export function AuditTimeline({
  entries,
  className,
}: {
  entries: readonly AuditTimelineEntry[];
  className?: string;
}) {
  return (
    <div
      className={cn("timeline mt-6", className)}
      data-ui-component="audit-timeline"
    >
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="relative ml-1 border-l border-border pb-6 pl-5 last:border-l-0 last:pb-0"
        >
          <span className="time-dot absolute left-[-3.5px] top-1 size-1.5 rounded-full bg-slate-400" />
          <strong className="block text-[11px] text-slate-600">
            {entry.title}
          </strong>
          {entry.meta ? (
            <small className="mt-1.5 block text-[9px] text-slate-400">
              {entry.meta}
            </small>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export interface EvidenceViewerItem {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  ariaLabel?: string;
  selected?: boolean;
  onSelect?: () => void;
}

export function EvidenceViewer({
  items,
  emptyMessage,
  footer,
}: {
  items: readonly EvidenceViewerItem[];
  emptyMessage?: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const resolvedEmptyMessage = emptyMessage ?? t("ui.evidence.empty");
  return (
    <div data-ui-component="evidence-viewer">
      {items.length ? (
        items.map((item) => {
          const content = (
            <>
              {item.icon}
              <span className="min-w-0 flex-1">
                <strong className="block truncate">{item.title}</strong>
                {item.meta ? <small>{item.meta}</small> : null}
              </span>
              {item.onSelect ? (
                <ChevronRight aria-hidden="true" className="ml-auto size-4 shrink-0" />
              ) : null}
            </>
          );
          return item.onSelect ? (
            <button
              type="button"
              className={cn(
                "evidence-row evidence-row-button w-full items-start text-left",
                item.selected && "selected",
              )}
              aria-label={item.ariaLabel}
              aria-pressed={item.selected || undefined}
              key={item.id}
              onClick={item.onSelect}
            >
              {content}
            </button>
          ) : (
            <div className="evidence-row" key={item.id}>
              {content}
            </div>
          );
        })
      ) : (
        <div className="empty compact">{resolvedEmptyMessage}</div>
      )}
      {footer}
    </div>
  );
}

export function EvidenceDetailSheet({
  open,
  onOpenChange,
  title,
  description,
  preview,
  summary,
  provenance,
  technical,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  preview: ReactNode;
  summary: ReactNode;
  provenance: ReactNode;
  technical: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 data-[side=right]:w-[96vw] data-[side=right]:max-w-[860px] data-[side=right]:sm:max-w-[860px]"
        data-ui-component="evidence-detail-sheet"
      >
        <SheetHeader className="border-b border-border pr-14">
          <SheetTitle>{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-border bg-slate-50 p-4">{preview}</div>
          <Tabs defaultValue="summary" className="gap-0">
            <TabsList
              variant="line"
              className="sticky top-0 z-10 w-full justify-start gap-5 border-b border-border bg-background px-4 py-2"
            >
              <TabsTrigger value="summary" className="min-h-11 flex-none px-1.5 text-xs">
                {t("ui.evidence.tab.summary")}
              </TabsTrigger>
              <TabsTrigger value="provenance" className="min-h-11 flex-none px-1.5 text-xs">
                {t("ui.evidence.tab.provenance")}
              </TabsTrigger>
              <TabsTrigger value="technical" className="min-h-11 flex-none px-1.5 text-xs">
                {t("ui.evidence.tab.technical")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="summary" className="p-4">
              {summary}
            </TabsContent>
            <TabsContent value="provenance" className="p-4">
              {provenance}
            </TabsContent>
            <TabsContent value="technical" className="p-4">
              {technical}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export interface ActionGateItem {
  id: string;
  label: ReactNode;
  primary?: boolean;
  disabled?: boolean;
  availability?: "ready" | "input" | "blocked" | "forbidden" | "offline";
  availabilityLabel?: ReactNode;
  reason?: ReactNode;
  onAction: () => void;
}

export interface StatusBoundaryItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "critical";
}

const boundaryToneClasses: Record<
  NonNullable<StatusBoundaryItem["tone"]>,
  string
> = {
  neutral: "border-border bg-slate-50 text-slate-700",
  positive: "border-doul-success/25 bg-doul-success/5 text-doul-success",
  warning: "border-doul-warning/25 bg-doul-warning/5 text-doul-warning",
  critical: "border-destructive/25 bg-destructive/5 text-destructive",
};

export function StatusBoundaryGroup({
  title,
  description,
  items,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  items: readonly StatusBoundaryItem[];
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-sm border border-border bg-white p-3", className)}
      data-ui-component="status-boundary-group"
    >
      <div className="mb-3">
        <h3 className="text-[11px] font-semibold text-slate-700">{title}</h3>
        {description ? (
          <p className="mt-1 text-[9px] leading-4 text-slate-500">
            {description}
          </p>
        ) : null}
      </div>
      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "min-w-0 rounded-sm border p-3",
              boundaryToneClasses[item.tone || "neutral"],
            )}
          >
            <dt className="text-[9px] font-medium text-slate-500">
              {item.label}
            </dt>
            <dd className="mt-1 text-xs font-semibold">{item.value}</dd>
            {item.detail ? (
              <p className="mt-1 text-[9px] leading-4 text-slate-500">
                {item.detail}
              </p>
            ) : null}
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ActionGate({
  actions,
  className,
}: {
  actions: readonly ActionGateItem[];
  className?: string;
}) {
  return (
    <div
      className={cn("command-grid grid grid-cols-2 gap-3", className)}
      data-ui-component="action-gate"
    >
      {actions.map((action) => (
        <div key={action.id} className="command-option">
          {action.availabilityLabel ? (
            <div
              className={cn(
                "mb-1.5 inline-flex rounded-sm border px-1.5 py-0.5 text-[9px] font-medium",
                action.availability === "ready" &&
                  "border-doul-success/25 bg-doul-success/5 text-doul-success",
                action.availability === "input" &&
                  "border-primary/20 bg-primary/5 text-primary",
                action.availability === "blocked" &&
                  "border-doul-warning/25 bg-doul-warning/5 text-doul-warning",
                action.availability === "forbidden" &&
                  "border-destructive/25 bg-destructive/5 text-destructive",
                action.availability === "offline" &&
                  "border-slate-300 bg-slate-100 text-slate-600",
              )}
              data-command-availability={action.availability}
            >
              {action.availabilityLabel}
            </div>
          ) : null}
          <Button
            type="button"
            variant={action.primary ? "default" : "outline"}
            className={cn(
              "w-full whitespace-normal",
              action.primary ? "primary" : "secondary",
            )}
            disabled={action.disabled}
            onClick={action.onAction}
          >
            {action.label}
          </Button>
          {action.reason ? (
            <small className="block px-0.5 py-1.5 text-[9px] leading-4 text-slate-500">
              {action.reason}
            </small>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function DecisionPanel({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("panel priority", className)}
      data-ui-component="decision-panel"
    >
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action}
    </section>
  );
}

export function OwnerDecisionPanel({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("panel detail-pane", className)}
      data-ui-component="owner-decision-panel"
      {...props}
    />
  );
}

export function DetailPane({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("panel detail-pane", className)}
      data-ui-component="detail-pane"
      {...props}
    />
  );
}

export function DetailDrawer({
  trigger,
  title,
  description,
  children,
}: {
  trigger: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side="right"
        className="w-[min(92vw,560px)] sm:max-w-[560px]"
        data-ui-component="detail-drawer"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
