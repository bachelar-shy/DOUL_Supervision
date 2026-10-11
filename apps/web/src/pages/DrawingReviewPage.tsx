import { lazy, Suspense, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CommandDescriptor, WorkItem, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { Panel, SectionHeader } from "../ui";
import { DrawingSourceRegistrationPanel } from "./parallel/DrawingSourceRegistrationPanel";
import { DrawingTechnicalApprovalPanel } from "./parallel/DrawingTechnicalApprovalPanel";
import { DrawingFieldManagementPanel } from "./parallel/DrawingFieldManagementPanel";
import { DrawingPdfBindingPanel } from "./parallel/DrawingPdfBindingPanel";
import { DrawingMarkupIssuePanel } from "./parallel/DrawingMarkupIssuePanel";

const PdfViewerPanel = lazy(() =>
  import("./parallel/PdfViewerPanel").then((module) => ({ default: module.PdfViewerPanel })),
);
const DrawingComparePanel = lazy(() =>
  import("./parallel/DrawingComparePanel").then((module) => ({ default: module.DrawingComparePanel })),
);

type TabId = "view" | "compare" | "manage";

export function DrawingReviewPage({
  client,
  workspace,
  onChanged,
  onSelect,
  onNavigate,
  onOpenCommand,
}: {
  client: SupervisionClient;
  workspace: Workspace;
  onChanged: () => Promise<void>;
  onSelect: (id: string | null) => void;
  onNavigate: (route: string) => void;
  onOpenCommand: (item: WorkItem, action: CommandDescriptor) => void;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState<TabId>("view");
  const [selectedMarkupId, setSelectedMarkupId] = useState<string | null>(null);
  const [markupRefreshVersion, setMarkupRefreshVersion] = useState(0);
  const canManage = ["ADM", "SUP", "DES"].includes(workspace.role.actorGroup);
  const selectMarkup = useCallback((id: string | null) => {
    setSelectedMarkupId(id);
    setMarkupRefreshVersion((previous) => previous + 1);
  }, []);
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "view", label: t("drawingReview.view") },
    { id: "compare", label: t("drawingReview.compare") },
    ...(canManage ? [{ id: "manage" as const, label: t("drawingReview.manage") }] : []),
  ];
  return (
    <div className="drawing-review-page" data-ui-page="drawings">
      <Panel>
        <SectionHeader title={t("navigation.drawings")} meta={workspace.project.name} />
        <p className="muted">{t("drawingReview.description")}</p>
        <div className="parallel-test-tabs" role="tablist" aria-label={t("navigation.drawings")}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              className={active === tab.id ? "active" : ""}
              onClick={() => setActive(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {active === "view" && (
          <>
            <Suspense fallback={<div role="status">{t("drawingReview.loading")}</div>}>
              <PdfViewerPanel client={client} workspace={workspace} onChanged={onChanged} onSelectMarkup={selectMarkup} />
            </Suspense>
            {selectedMarkupId && (
              <DrawingMarkupIssuePanel
                client={client}
                workspace={workspace}
                selectedMarkupId={selectedMarkupId}
                refreshVersion={markupRefreshVersion}
                onChanged={onChanged}
                onSelect={onSelect}
                onNavigate={onNavigate}
              />
            )}
          </>
        )}
        {active === "compare" && (
          <Suspense fallback={<div role="status">{t("drawingReview.loading")}</div>}>
            <DrawingComparePanel client={client} workspace={workspace} />
          </Suspense>
        )}
        {active === "manage" && canManage && (
          <>
            <DrawingSourceRegistrationPanel client={client} workspace={workspace} onChanged={onChanged} onNavigate={onNavigate} />
            <DrawingTechnicalApprovalPanel client={client} workspace={workspace} onOpenCommand={onOpenCommand} />
            <DrawingFieldManagementPanel client={client} workspace={workspace} onChanged={onChanged} onSelect={onSelect} onNavigate={onNavigate} />
            <DrawingPdfBindingPanel client={client} workspace={workspace} onChanged={onChanged} />
          </>
        )}
      </Panel>
    </div>
  );
}
