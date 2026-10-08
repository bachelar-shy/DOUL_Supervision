import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formFieldLabel } from "@doul/localization";
import type { FormSchema, RecordDTO, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { DocumentWorkspaceTemplate } from "../ui/templates";
import { PageBoundary } from "./PageBoundary";
import { Icon } from "./shared";
import { recordTitle, recordRef } from "./record-utils";

function putPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const keys = path.split(".");
  let node = target;
  for (const k of keys.slice(0, -1)) {
    if (!node[k] || typeof node[k] !== "object") node[k] = {};
    node = node[k] as Record<string, unknown>;
  }
  node[keys.at(-1)!] = value;
}
function formData(schema: FormSchema, values: Record<string, string>) {
  const data: Record<string, unknown> = {};
  for (const [f, r] of Object.entries(schema.scalar_fields)) {
    const v = values[f] || "";
    if (v) putPath(data, f, r.type === "boolean" ? v === "true" : v);
  }
  for (const t of schema.tables)
    putPath(
      data,
      t.path,
      ["review_table", "check_table"].includes(t.type)
        ? Object.fromEntries(t.columns.map((c) => [c, ""]))
        : [],
    );
  return data;
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
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [snapshot, setSnapshot] = useState<RecordDTO | null>(null);
  const schema = workspace.formSchemas[form];
  const sources = workspace.items.filter((x) =>
    ["report", "issue", "inspection"].includes(x.machine),
  );
  async function preview() {
    setBusy(true);
    setErr("");
    try {
      const item =
        sources.find((x) => x.record.id === source) ||
        sources.find((x) =>
          form === "FM-09"
            ? x.machine === "inspection"
            : form === "FM-12"
              ? x.machine === "issue"
              : x.machine === "report",
        );
      if (!item) throw new Error(t("document.error.noSource"));
      const doc = await client.render(
        form,
        [recordRef(item)],
        formData(schema, values),
      );
      setSnapshot(doc);
      setHtml(await client.documentHtml(doc.id));
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <PageBoundary name="documents">
      <DocumentWorkspaceTemplate>
      <section className="panel editor-pane">
        <h2>{t("document.editor.title")}</h2>
        <label>
          {t("document.form.label")}
          <select
            aria-label={t("document.form.aria")}
            value={form}
            onChange={(e) => {
              setForm(e.target.value);
              setHtml("");
              setValues({});
            }}
          >
            {(["FM-20", "FM-19", "FM-21", "FM-12", "FM-09"] as const).map((id) => (
              <option key={id} value={id}>
                {id} · {t("document.form." + id)}
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
            <option value="">{t("document.source.auto")}</option>
            {sources.map((x) => (
              <option value={x.record.id} key={x.record.id}>
                {recordTitle(x.record)} · v{x.record.version}
              </option>
            ))}
          </select>
        </label>
        <div className="notice">
          {t("document.notice.draft")}
        </div>
        <details open>
          <summary>{t("document.section.draftFields")}</summary>
          <div className="document-fields">
            {Object.entries(schema.scalar_fields).map(([f, r]) => (
              <label key={f}>
                {formFieldLabel(f, i18n.resolvedLanguage ?? i18n.language)}
                {r.required ? " *" : ""}
                <input
                  name={f}
                  value={values[f] || ""}
                  placeholder={
                    r.type === "date-time"
                      ? "2026-10-05T09:00:00+07:00"
                      : r.type === "boolean"
                        ? "true / false"
                        : t("document.placeholder.manual")
                  }
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
        </details>
        <button
          className="primary wide"
          onClick={() => void preview()}
          disabled={busy || !online}
        >
          {busy ? t("document.action.generating") : t("document.action.createHtml")}
        </button>
        <div className="two-buttons">
          <button className="secondary" disabled>
            {t("document.action.docxPending")}
          </button>
          <button className="secondary" disabled>
            {t("document.action.pdfPending")}
          </button>
        </div>
        {err && (
          <div role="alert" className="error-box">
            {err}
          </div>
        )}
      </section>
      <section className="preview-pane">
        <div className="preview-header">
          <b>{t("document.preview.title")}</b>
          <span>{t("document.preview.draftOnly")}</span>
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
      </section>
      </DocumentWorkspaceTemplate>
    </PageBoundary>
  );
}
