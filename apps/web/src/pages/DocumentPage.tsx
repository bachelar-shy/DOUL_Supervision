import { recordVersionLabel } from "../labels";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { documentRenderCopy, documentOutputLanguageLabels, formFieldLabel } from "@doul/localization";
import type { RecordDTO, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { ApiError } from "../data/supervision-client";
import { reasonLabel } from "../labels";
import { DocumentWorkspaceTemplate } from "../ui/templates";
import { PageBoundary } from "./PageBoundary";
import { Icon } from "./shared";
import { recordTitle } from "./record-utils";
import { DocumentSigningPanel } from "./DocumentSigningPanel";
import { DocumentTableEditor, buildDocumentData, type DocumentTableValues } from "./DocumentTableEditor";
import { documentAuthoringForms, eligibleDocumentSources, sourceSelectionForForm } from "./document-authoring-source";
import "./document-authoring.css";
import { documentAuthoringCopy, documentFormNames } from "./document-authoring-copy";
import { useSessionFormDraft } from "../data/session-form-draft";

const emptyDocumentDraft = {
  form: "FM-20",
  source: "",
  values: {} as Record<string, string>,
  tableValues: {} as DocumentTableValues,
  documentLanguage: "ko" as "ko" | "vi" | "en",
  renderMode: "draft" as "draft" | "final",
};

function documentLocale(language: string) {
  return language.startsWith("ko") ? "ko" : language.startsWith("vi") ? "vi" : "en";
}
interface DocumentPageProps {
  client: SupervisionClient;
  workspace: Workspace;
  online: boolean;
  refresh: () => Promise<void>;
}

export function DocumentPage(props: DocumentPageProps) {
  const identity = JSON.stringify([props.workspace.project.id, props.workspace.role.id, props.client.session?.actor.partyId]);
  return <DocumentEditor key={identity} {...props} />;
}

function DocumentEditor({ client, workspace, online, refresh }: DocumentPageProps) {
  const { t, i18n } = useTranslation();
  const { value: draft, change: changeDraft, discard: discardDraft, restored, persistenceFailed } = useSessionFormDraft(
    "document",
    { projectId: workspace.project.id, partyId: client.session?.actor.partyId ?? "anonymous", roleId: workspace.role.id },
    emptyDocumentDraft,
  );
  const { form, source, values, tableValues, documentLanguage, renderMode } = draft;
  const [exporting, setExporting] = useState<"docx" | "pdf" | null>(null);
  const [exportError, setExportError] = useState("");
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [snapshot, setSnapshot] = useState<RecordDTO | null>(null);
  const renderAttempt = useRef<{ fingerprint: string; key: ReturnType<typeof crypto.randomUUID> } | null>(null);
  const mounted = useRef(false);
  const currentDraft = useRef(draft);
  const editRevision = useRef(0);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    currentDraft.current = draft;
  }, [draft]);
  const schema = workspace.formSchemas[form];
  const copy = documentRenderCopy[documentLocale(i18n.resolvedLanguage ?? i18n.language)];
  const sources = eligibleDocumentSources(workspace, form);
  const language = documentLocale(i18n.resolvedLanguage ?? i18n.language);
  const availableForms = documentAuthoringForms.filter((id) => Boolean(workspace.formSchemas[id]));
  const uxCopy = documentAuthoringCopy[language];
  const sourceDescription = uxCopy.noSource;
  function editDraft(patch: Partial<typeof draft>) {
    editRevision.current += 1;
    currentDraft.current = { ...currentDraft.current, ...patch };
    changeDraft(patch);
    setSnapshot(null);
    setHtml("");
    setErr("");
    setExportError("");
  }
  async function preview(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busy) return;
    const item = sourceSelectionForForm(sources, source);
    if (!item) {
      setErr(sourceDescription);
      return;
    }
    if (renderMode === "final") {
      const missing = Object.entries(schema.scalar_fields).some(([field, rule]) => rule.required && !values[field]);
      if (missing) {
        setErr(copy.noFinalData);
        return;
      }
    }
    setBusy(true);
    setErr("");
    setSnapshot(null);
    setHtml("");
    setExportError("");
    const submittedSession = client.session;
    const submittedDraft = JSON.stringify(draft);
    const submittedRevision = editRevision.current;
    const active = () => mounted.current && client.session === submittedSession;
    const unchanged = () => editRevision.current === submittedRevision && JSON.stringify(currentDraft.current) === submittedDraft;
    try {
      const sourceRefs = [item.ref];
      const data = buildDocumentData(schema, values, tableValues);
      const final = renderMode === "final";
      const fingerprint = JSON.stringify({ form, sourceRefs, data, final, documentLanguage });
      if (renderAttempt.current?.fingerprint !== fingerprint) {
        renderAttempt.current = { fingerprint, key: crypto.randomUUID() };
      }
      const attempt = renderAttempt.current;
      const doc = await client.render(
        form,
        sourceRefs,
        data,
        final,
        documentLanguage,
        attempt.key,
      );
      if (!active()) return;
      const renderedHtml = await client.documentHtml(doc.id);
      if (!active()) return;
      await refresh();
      if (!active()) return;
      if (renderAttempt.current === attempt) renderAttempt.current = null;
      // Final generation clears only the input that was actually submitted. A
      // later edit, a remounted editor or another role must keep its own draft.
      if (unchanged()) {
        setSnapshot(doc);
        setHtml(renderedHtml);
        if (final) discardDraft();
      }
    } catch (e) {
      if (active() && unchanged()) setErr(e instanceof ApiError ? reasonLabel(e.detail.code) : copy.genericError);
    } finally {
      if (active()) setBusy(false);
    }
  }
  async function download(format: "pdf" | "docx") {
    if (!snapshot || client.kind !== "http") return;
    setExporting(format);
    setExportError("");
    const exportSession = client.session;
    const exportRevision = editRevision.current;
    const active = () => mounted.current && client.session === exportSession && editRevision.current === exportRevision;
    try {
      const blob = await client.documentExport(snapshot.id, format);
      if (!active()) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = snapshot.formId + "-" + snapshot.id + "." + format;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const unavailable = code === "DOCUMENT_EXPORT_NOT_CONFIGURED";
      if (active()) setExportError(unavailable ? uxCopy.exportUnavailable : uxCopy.exportFailed);
    } finally {
      if (mounted.current && client.session === exportSession) setExporting(null);
    }
  }
  return (
    <PageBoundary name="documents">
      <DocumentWorkspaceTemplate>
      <form className="panel editor-pane" onSubmit={(event) => void preview(event)}>
        <h2>{t("document.editor.title")}</h2>
        <div className="document-session-draft-notice">
          {persistenceFailed
            ? <p role="alert">{uxCopy.sessionSaveFailed}</p>
            : <p role="status">{restored ? uxCopy.sessionRestored : uxCopy.sessionSaved}</p>}
          <button type="button" className="secondary" disabled={busy} onClick={() => {
            editRevision.current += 1;
            discardDraft();
            setSnapshot(null);
            setHtml("");
            setErr("");
            setExportError("");
          }}>{uxCopy.sessionDiscard}</button>
        </div>
        <label>
          {t("document.form.label")}
          <select
            aria-label={t("document.form.aria")}
            value={form}
            onChange={(e) => {
              editDraft({ form: e.target.value, source: "", values: {}, tableValues: {} });
            }}
          >
            {availableForms.map((id) => (
              <option key={id} value={id}>
                {id} · {documentFormNames[id]?.[language] ?? t("document.form." + id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("document.source.label")}
          <select
            value={source}
            onChange={(e) => editDraft({ source: e.target.value })}
            aria-label={t("document.source.aria")}
          >
            <option value="">{sources.length === 1 ? t("document.source.auto") : t("document.source.label")}</option>
            {sources.map((x) => (
              <option value={x.record.id} key={x.record.id}>
                {recordTitle(x.record)} · {recordVersionLabel(x.record.version)}
              </option>
            ))}
          </select>
          {!sources.length && <span className="muted" role="status">{sourceDescription}</span>}
          {sources.length > 1 && !source && <span className="muted">{uxCopy.chooseSource}</span>}
        </label>
        <label>
          {copy.language}
          <select
            aria-label={copy.language}
            value={documentLanguage}
            onChange={(event) => editDraft({ documentLanguage: event.target.value as typeof documentLanguage })}
          >
            <option value="ko">{documentOutputLanguageLabels.ko}</option>
            <option value="vi">{documentOutputLanguageLabels.vi}</option>
            <option value="en">{documentOutputLanguageLabels.en}</option>
          </select>
        </label>
        <label>
          {copy.mode}
          <select
            aria-label={copy.mode}
            value={renderMode}
            onChange={(event) => editDraft({ renderMode: event.target.value as typeof renderMode })}
          >
            <option value="draft">{copy.draft}</option>
            <option value="final">{copy.final}</option>
          </select>
        </label>
        <div className="notice">
          {renderMode === "draft" ? t("document.notice.draft") : copy.finalStatus}
        </div>
        <details open>
          <summary>{t("document.section.draftFields")}</summary>
          <div className="document-fields">
            {Object.entries(schema.scalar_fields).map(([f, r]) => (
              <label key={f}>
                {formFieldLabel(f, i18n.resolvedLanguage ?? i18n.language)}
                {r.required ? " *" : ""}
                {r.type === "boolean" ? (
                  <select
                    name={f}
                    required={renderMode === "final" && r.required}
                    value={values[f] || ""}
                    onChange={(e) => editDraft({ values: { ...values, [f]: e.target.value } })}
                  >
                    <option value="">{t("document.placeholder.manual")}</option>
                    <option value="true">{copy.yes}</option>
                    <option value="false">{copy.no}</option>
                  </select>
                ) : <input
                  name={f}
                  type={r.type === "date-time" ? "datetime-local" : "text"}
                  value={values[f] || ""}
                  required={renderMode === "final" && r.required}
                  placeholder={
                    t("document.placeholder.manual")
                  }
                  onChange={(e) =>
                    editDraft({ values: { ...values, [f]: e.target.value } })
                  }
                />}
              </label>
            ))}
          </div>
        </details>
        {schema.tables.length > 0 && <DocumentTableEditor schema={schema} values={tableValues} onChange={(next) => editDraft({ tableValues: next })} />}
        <button
          type="submit"
          className="primary wide"
          disabled={busy || !online}
        >
          {busy
            ? t("document.action.generating")
            : renderMode === "draft"
              ? t("document.action.createHtml")
              : copy.finalButton}
        </button>
        <div className="two-buttons">
          <button type="button" className="secondary" disabled={!snapshot || busy || !!exporting || client.kind !== "http"}
            onClick={() => void download("docx")}>
            {exporting === "docx" ? uxCopy.downloading : "DOCX " + uxCopy.download}
          </button>
          <button type="button" className="secondary" disabled={!snapshot || busy || !!exporting || client.kind !== "http"}
            onClick={() => void download("pdf")}>
            {exporting === "pdf" ? uxCopy.downloading : "PDF " + uxCopy.download}
          </button>
        </div>
        {snapshot && <p className="muted" style={{ fontSize: 12 }}>
          {uxCopy.signatureNote}
        </p>}
        {(err || exportError) && (
          <div role="alert" className="error-box">
            {err || exportError}
          </div>
        )}
      </form>
      <section className="preview-pane">
        <div className="preview-header">
          <b>{t("document.preview.title")}</b>
          <span>{snapshot?.status === "final" || snapshot?.status === "signed" ? copy.finalStatus : copy.draftStatus}</span>
        </div>
        {html ? (
          <iframe title={t("document.preview.aria")} sandbox="" srcDoc={html} />
        ) : (
          <div className="paper-empty">
            <Icon name="document" />
            <h2>{t("document.preview.emptyTitle")}</h2>
            <p>{t("document.preview.emptyHelp")}</p>
          </div>
        )}
        {snapshot && (
          <small className="snapshot-note">
            {t("document.preview.snapshot", {
              id: snapshot.id.slice(0, 8),
              hash: String(snapshot.renderHash).slice(0, 20),
            })}
          </small>
        )}
        <DocumentSigningPanel client={client} workspace={workspace} online={online} snapshot={snapshot} onSigned={() => refresh()} />
      </section>
      </DocumentWorkspaceTemplate>
    </PageBoundary>
  );
}
