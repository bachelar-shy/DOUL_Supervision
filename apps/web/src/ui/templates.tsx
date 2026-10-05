import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Panel } from "./index";

export interface DashboardTemplateProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function DashboardTemplate({
  children,
  className,
  ...props
}: DashboardTemplateProps) {
  return (
    <div
      className={cn("template", "template-dashboard", className)}
      data-ui-template="dashboard"
      {...props}
    >
      {children}
    </div>
  );
}

export interface WorkbenchTemplateProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  hasDetail?: boolean;
}

export function WorkbenchTemplate({
  children,
  hasDetail = false,
  className,
  ...props
}: WorkbenchTemplateProps) {
  return (
    <div
      className={cn(
        "template",
        "template-workbench",
        "workbench",
        hasDetail && "has-detail",
        className,
      )}
      data-ui-template="workbench"
      {...props}
    >
      {children}
    </div>
  );
}

export function OwnerReportTemplate({
  children,
  hasDetail = false,
  className,
  ...props
}: WorkbenchTemplateProps) {
  return (
    <div
      className={cn(
        "template",
        "template-owner-report",
        "workbench",
        hasDetail && "has-detail",
        className,
      )}
      data-ui-template="owner-report"
      {...props}
    >
      {children}
    </div>
  );
}

export interface RegisterTemplateProps {
  header?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function RegisterTemplate({
  header,
  notice,
  children,
  className,
}: RegisterTemplateProps) {
  return (
    <Panel
      className={cn("template", "template-register", className)}
      data-ui-template="register"
    >
      {header}
      {notice}
      <div className="register-content">{children}</div>
    </Panel>
  );
}

export interface CaptureTemplateProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CaptureTemplate({
  children,
  className,
  ...props
}: CaptureTemplateProps) {
  return (
    <div
      className={cn("template", "template-capture", "work-grid", className)}
      data-ui-template="capture"
      {...props}
    >
      {children}
    </div>
  );
}

export interface DocumentWorkspaceTemplateProps
  extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function DocumentWorkspaceTemplate({
  children,
  className,
  ...props
}: DocumentWorkspaceTemplateProps) {
  return (
    <div
      className={cn(
        "template",
        "template-document",
        "document-workbench",
        className,
      )}
      data-ui-template="document"
      {...props}
    >
      {children}
    </div>
  );
}
