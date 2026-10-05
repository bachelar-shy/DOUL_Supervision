import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "secondary";

export interface ActionButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function ActionButton({
  variant = "secondary",
  className,
  type = "button",
  ...props
}: ActionButtonProps) {
  return (
    <button
      type={type}
      className={cx(variant, className)}
      {...props}
    />
  );
}

export function Panel({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return <section className={cx("panel", className)} {...props} />;
}

export interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="heading-actions">{actions}</div> : null}
    </div>
  );
}

export interface SectionHeaderProps {
  title: ReactNode;
  meta?: ReactNode;
}

export function SectionHeader({ title, meta }: SectionHeaderProps) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {meta ? <span>{meta}</span> : null}
    </div>
  );
}

const dangerStates = new Set(["failed", "hold", "rework_required"]);
const positiveStates = new Set(["passed", "closed"]);

export interface StatusBadgeProps {
  status?: string;
  children?: ReactNode;
  className?: string;
}

export function StatusBadge({
  status,
  children,
  className,
}: StatusBadgeProps) {
  return (
    <span
      className={cx(
        "badge",
        dangerStates.has(status || "") && "danger",
        positiveStates.has(status || "") && "positive",
        className,
      )}
    >
      {children ?? status ?? "원본 보존"}
    </span>
  );
}

export interface KpiCardProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  meta?: ReactNode;
}

export function KpiCard({
  label,
  value,
  unit = "건",
  meta,
  className,
  type = "button",
  ...props
}: KpiCardProps) {
  return (
    <button
      type={type}
      className={cx("kpi", className)}
      {...props}
    >
      <span>{label}</span>
      <b>
        {value}
        {unit ? <small>{unit}</small> : null}
      </b>
      {meta ? <em>{meta}</em> : null}
    </button>
  );
}

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: EmptyStateProps) {
  return (
    <div className={cx("empty", compact && "compact")}>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}
