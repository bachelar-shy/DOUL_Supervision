import { recordVersionLabel } from "../../labels";
import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { actionAuthoringTranslations, normalizeLanguage } from "@doul/localization";
import type { RecordDTO, Workspace } from "../../data/ui-contract";
import { ApiError, type SupervisionClient } from "../../data/supervision-client";
import { creationCapabilityLabel, reasonLabel } from "../../labels";
import { ActionButton } from "../../ui";

type LabelKey = keyof typeof actionAuthoringTranslations.en;

function localDateTimeToIso(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export interface ActionAuthoringPanelProps {
  client: SupervisionClient;
  workspace: Workspace;
  online: boolean;
  onCreated(record: RecordDTO): Promise<void>;
  initialIssueId?: string;
}

/** Creates an Action draft through the SupervisionClient facade. */
export function ActionAuthoringPanel({ client, workspace, online, onCreated, initialIssueId }: ActionAuthoringPanelProps) {
  const { i18n } = useTranslation();
  const locale = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);
  const language = locale;
  const t = (key: LabelKey) => actionAuthoringTranslations[language][key];
  const capability = workspace.context.creationCapabilities?.action;
  const canCreate = client.kind === "http" && online && capability?.canCreate === true && capability.status === "available";
  const disabledReason = !online ? t("offline") : client.kind === "mock" ? t("preview")
    : !canCreate ? capability ? creationCapabilityLabel(capability) : t("unavailable") : "";
  const scope = workspace.context.scope;
  const issues = (workspace.context.referenceCatalog?.issues ?? []).filter(({ ref, record }) =>
    ref.objectType === "Issue" && record.projectId === workspace.context.projectId);
  const contractors = workspace.participants.filter((participant) => participant.actorGroup === "CON");

  const [title, setTitle] = useState("");
  const [issueId, setIssueId] = useState(initialIssueId ?? "");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ body: string; objectId: string; key: string } | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate || busy || created) return;
    const issue = issues.find((item) => item.ref.objectId === issueId);
    const assignee = contractors.find((person) => person.partyId === assigneeId);
    const dueAtIso = localDateTimeToIso(dueAt);
    if (!title.trim() || !issue || !assignee || !dueAtIso) {
      setError(t("required"));
      return;
    }

    const payload = {
      ...scope,
      title: title.trim(),
      relatedIssueId: issue.ref.objectId,
      responsiblePartyId: assignee.partyId,
      responsibleOrganizationId: scope.responsibleOrganizationId,
      dueAt: dueAtIso,
    };
    const body = JSON.stringify(payload);
    if (attempt.current?.body !== body) {
      attempt.current = { body, objectId: crypto.randomUUID(), key: crypto.randomUUID() };
    }

    setBusy(true);
    setError("");
    try {
      const result = await client.create("action", payload, attempt.current.objectId, attempt.current.key);
      await onCreated(result.record);
      attempt.current = null;
      setCreated(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? reasonLabel(cause.detail.code) : t("unavailable"));
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel grid gap-4 p-4" data-ui-component="action-authoring-panel">
    <header className="grid gap-1">
      <h2 className="text-lg font-semibold">{t("heading")}</h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
    </header>
    <section className="grid gap-2 rounded-sm border border-border p-3" aria-label={t("scope")}>
      <h3 className="text-sm font-semibold">{t("scope")}</h3>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="font-medium">{t("project")}</dt><dd>{workspace.project.name} · {workspace.context.projectId}</dd></div>
        <div><dt className="font-medium">{t("package")}</dt><dd>{scope.packageId || "—"}</dd></div>
        <div><dt className="font-medium">{t("location")}</dt><dd>{scope.locationId || "—"}</dd></div>
        <div><dt className="font-medium">{t("discipline")}</dt><dd>{scope.discipline || "—"}</dd></div>
        <div><dt className="font-medium">{t("organization")}</dt><dd>{scope.responsibleOrganizationId || "—"}</dd></div>
      </dl>
    </section>
    <p className="rounded-sm border border-border bg-muted/40 p-3 text-sm" role="note">{t("draftOnly")}</p>
    {disabledReason && <p className="rounded-sm border border-border bg-muted/40 p-3 text-sm" role="status">{disabledReason}</p>}
    {!issues.length && <p className="text-sm text-muted-foreground">{t("noIssues")}</p>}
    <form className="grid gap-4" onSubmit={(event) => void save(event)}>
      <label className="grid gap-1 text-sm font-medium">{t("title")}
        <input className="min-h-11 rounded-sm border border-input bg-background px-3" value={title} maxLength={300} required disabled={!canCreate || busy || created} onChange={(event) => { setTitle(event.target.value); setCreated(false); setError(""); }} />
      </label>
      <label className="grid gap-1 text-sm font-medium">{t("relatedIssue")}
        <select aria-label={t("relatedIssue")} className="min-h-11 rounded-sm border border-input bg-background px-3" value={issueId} required disabled={!canCreate || busy || created || !issues.length} onChange={(event) => { setIssueId(event.target.value); setCreated(false); setError(""); }}>
          <option value="">{t("selectIssue")}</option>
          {issues.map(({ ref, record }) => <option key={ref.objectId} value={ref.objectId}>{record.title || ref.objectId} · {ref.objectId} · {recordVersionLabel(ref.version)}</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">{t("assignee")}
          <select aria-label={t("assignee")} className="min-h-11 rounded-sm border border-input bg-background px-3" value={assigneeId} required disabled={!canCreate || busy || created} onChange={(event) => { setAssigneeId(event.target.value); setCreated(false); setError(""); }}>
            <option value="">{t("unassigned")}</option>
            {contractors.map((person) => <option key={person.partyId} value={person.partyId}>{person.name} · {person.partyId}</option>)}
          </select>
          {!contractors.length && <span className="text-xs text-muted-foreground">{t("noContractors")}</span>}
        </label>
        <label className="grid gap-1 text-sm font-medium">{t("dueAt")}
          <input type="datetime-local" className="min-h-11 rounded-sm border border-input bg-background px-3" value={dueAt} required disabled={!canCreate || busy || created} onChange={(event) => { setDueAt(event.target.value); setCreated(false); setError(""); }} />
        </label>
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {created && <div className="flex items-center justify-between gap-3"><p className="text-sm" role="status">{t("created")}</p><ActionButton type="button" onClick={() => { setTitle(""); setIssueId(""); setAssigneeId(""); setDueAt(""); setError(""); setCreated(false); attempt.current = null; }}>{t("newAction")}</ActionButton></div>}
      <div className="flex justify-end"><ActionButton type="submit" disabled={!canCreate || busy || created || !issues.length || !contractors.length}>
        {busy ? t("saving") : t("create")}
      </ActionButton></div>
    </form>
  </section>;
}
