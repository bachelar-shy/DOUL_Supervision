import type { HTMLAttributes, ReactNode } from "react";

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
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

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
  ariaLabel = "주 메뉴",
  className,
}: NavigationListProps) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn("doul-navigation", className)}
      data-ui-component="navigation"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={activeId === item.id ? "active" : ""}
          aria-current={activeId === item.id ? "page" : undefined}
          disabled={item.disabled}
          onClick={() => onNavigate(item.id)}
        >
          {item.icon}
          <span>{item.label}</span>
          {item.badge !== undefined && item.badge !== null ? (
            <i
              aria-label={
                typeof item.badge === "number" ? `${item.badge}건` : undefined
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
  moreOpen = false,
  moreActive = false,
  moreIcon,
  moreLabel = "더보기",
  ariaLabel = "모바일 메뉴",
}: MobileNavigationProps) {
  return (
    <nav
      className="bottom-nav"
      aria-label={ariaLabel}
      data-ui-component="mobile-navigation"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
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
        onClick={onMore}
      >
        {moreIcon}
        <span>{moreLabel}</span>
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
  queryPlaceholder = "검색",
  queryLabel = "목록 검색",
  children,
  actions,
  className,
  ...props
}: FilterBarProps) {
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
          <span className="sr-only">{queryLabel}</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query ?? ""}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={queryPlaceholder}
            className="pl-9"
          />
        </label>
      ) : null}
      {children}
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
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
  emptyMessage = "조회할 항목이 없습니다.",
  className,
}: RegisterTableProps<T>) {
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
                {emptyMessage}
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
}

export function EvidenceViewer({
  items,
  emptyMessage = "서버에 등록된 증빙이 없습니다.",
  footer,
}: {
  items: readonly EvidenceViewerItem[];
  emptyMessage?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div data-ui-component="evidence-viewer">
      {items.length ? (
        items.map((item) => (
          <div className="evidence-row" key={item.id}>
            {item.icon}
            <div>
              <strong>{item.title}</strong>
              {item.meta ? <small>{item.meta}</small> : null}
            </div>
          </div>
        ))
      ) : (
        <div className="empty compact">{emptyMessage}</div>
      )}
      {footer}
    </div>
  );
}

export interface ActionGateItem {
  id: string;
  label: ReactNode;
  primary?: boolean;
  disabled?: boolean;
  reason?: ReactNode;
  onAction: () => void;
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
