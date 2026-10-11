import { TranslationPreviewPanel } from "./TranslationPreviewPanel";
import { recordVersionLabel } from "../labels";
import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { documentRenderCopy, documentOutputLanguageLabels, formFieldLabel } from "@doul/localization";
import type { RecordDTO, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { ApiError } from "../data/supervision-client";
import { reasonLabel } from "../labels";
import { DocumentWorkspaceTemplate } from "../ui/templates";
import { PageBoundary } from "./PageBoundary";
import { Icon } from "./shared";
import { recordTitle, recordRef } from "./record-utils";
import { DocumentSigningPanel } from "./DocumentSigningPanel";
import { DocumentTableEditor, buildDocumentData, type DocumentTableValues } from "./DocumentTableEditor";
import { documentAuthoringForms, eligibleDocumentSources, sourceSelectionForForm } from "./document-authoring-source";
import "./document-authoring.css";
import { documentAuthoringCopy, documentFormNames } from "./document-authoring-copy";

function documentLocale(language: string) {
  return language.startsWith("ko") ? "ko" : language.startsWith("vi") ? "vi" : "en";
}
export function DocumentPage({
  client,
  workspace,
  online,
  refresh,
}: {
  client: SupervisionClient;
  workspace: Workspace;
  online: boolean;
  refresh: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState("FM-20");
  const [source, setSource] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [tableValues, setTableValues] = useState<DocumentTableValues>({});
  const [exporting, setExporting] = useState<"docx" | "pdf" | null>(null);
  const [exportError, setExportError] = useState("");
  const [documentLanguage, setDocumentLanguage] = useState<"ko" | "vi" | "en">("ko");
  const [renderMode, setRenderMode] = useState<"draft" | "final">("draft");
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [snapshot, setSnapshot] = useState<RecordDTO | null>(null);
  const renderAttempt = useRef<{ fingerprint: string; key: ReturnType<typeof crypto.randomUUID> } | null>(null);
  const schema = workspace.formSchemas[form];
  const copy = documentRenderCopy[documentLocale(i18n.resolvedLanguage ?? i18n.language)];
  const sources = eligibleDocumentSources(workspace, form);
  const language = documentLocale(i18n.resolvedLanguage ?? i18n.language);
  const availableForms = documentAuthoringForms.filter((id) => Boolean(workspace.formSchemas[id]));
  const uxCopy = documentAuthoringCopy[language];
  const sourceDescription = uxCopy.noSource;
  async function preview(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
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
    try {
      const sourceRefs = [recordRef(item)];
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
      setSnapshot(doc);
      setHtml(await client.documentHtml(doc.id));
      await refresh();
      renderAttempt.current = null;
    } catch (e) {
      setErr(e instanceof ApiError ? reasonLabel(e.detail.code) : copy.genericError);
    } finally {
      setBusy(false);
    }
  }
  async function download(format: "pdf" | "docx") {
    if (!snapshot || client.kind !== "http") return;
    setExporting(format);
    setExportError("");
    try {
      const blob = await client.documentExport(snapshot.id, format);
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
      setExportError(unavailable ? uxCopy.exportUnavailable : uxCopy.exportFailed);
    } finally {
      setExporting(null);
    }
  }
  return (
    <PageBoundary name="documents">
      <DocumentWorkspaceTemplate>
      <form className="panel editor-pane" onSubmit={(event) => void preview(event)}>
        <h2>{t("document.editor.title")}</h2>
        <label>
          {t("document.form.label")}
          <select
            aria-label={t("document.form.aria")}
            value={form}
            onChange={(e) => {
              setForm(e.target.value);
              setSource("");
              setHtml("");
              setValues({});
              setTableValues({});
              setSnapshot(null);
              setErr("");
              setExportError("");
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
            onChange={(e) => setSource(e.target.value)}
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
            onChange={(event) => setDocumentLanguage(event.target.value as typeof documentLanguage)}
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
            onChange={(event) => setRenderMode(event.target.value as typeof renderMode)}
          >
            <option value="draft">{copy.draft}</option>
            <option value="final">{copy.final}</option>
          </select>
        </label>
        <div className="notice">
          {renderMode === "draft" ? t("document.notice.draft") : copy.finalStatus}
        </div>
        {/* Keep document authoring and preview as exactly two layout panes. */}
        <TranslationPreviewPanel client={client} workspace={workspace} />
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
                    onChange={(e) => setValues({ ...values, [f]: e.target.value })}
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
                    setValues({ ...values, [f]: e.target.value })
                  }
                />}
              </label>
            ))}
          </div>
        </details>
        {schema.tables.length > 0 && <DocumentTableEditor schema={schema} values={tableValues} onChange={setTableValues} />}
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
          <button type="button" className="secondary" disabled={!snapshot || !!exporting || client.kind !== "http"}
            onClick={() => void download("docx")}>
            {exporting === "docx" ? uxCopy.downloading : "DOCX " + uxCopy.download}
          </button>
          <button type="button" className="secondary" disabled={!snapshot || !!exporting || client.kind !== "http"}
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
