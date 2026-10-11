import { recordVersionLabel } from "../labels";
import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { documentRenderCopy, documentOutputLanguageLabels, formFieldLabel } from "@doul/localization";
import type { FormSchema, RecordDTO, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { ApiError } from "../data/supervision-client";
import { reasonLabel } from "../labels";
import { DocumentWorkspaceTemplate } from "../ui/templates";
import { PageBoundary } from "./PageBoundary";
import { Icon } from "./shared";
import { recordTitle, recordRef } from "./record-utils";
import { DocumentSigningPanel } from "./DocumentSigningPanel";
import { DocumentTableEditor, serializeDocumentTables, type DocumentTableValues } from "./DocumentTableEditor";
import { documentAuthoringForms, eligibleDocumentSources, sourceSelectionForForm } from "./document-authoring-source";

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
function formData(schema: FormSchema, values: Record<string, string>, tables: DocumentTableValues) {
  const data: Record<string, unknown> = {};
  for (const [f, r] of Object.entries(schema.scalar_fields)) {
    let v = values[f] || "";
    if (!v) continue;
    if (r.type === "date-time") v = new Date(v).toISOString();
    putPath(data, f, r.type === "boolean" ? v === "true" : v);
  }
  const sourceTables = serializeDocumentTables(schema, tables);
  for (const table of schema.tables) putPath(data, table.path, sourceTables[table.path]);
  return data;
}

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
  const additionalFormNames: Record<string, Record<string, string>> = {
    "FM-02": { ko: "시공계획 검토서", vi: "Phiếu kiểm tra biện pháp thi công", en: "Construction method review" },
    "FM-13": { ko: "시정조치서", vi: "Phiếu khắc phục", en: "Corrective action form" },
    "FM-15": { ko: "기술질의서", vi: "Phiếu yêu cầu thông tin kỹ thuật", en: "Technical inquiry form" },
  };
  const sourceDescription = language === "ko"
    ? "이 양식의 원본 기록이 없습니다. 해당 업무에서 기록을 먼저 작성하거나 접근 권한을 확인하십시오."
    : language === "vi"
      ? "Chưa có hồ sơ nguồn phù hợp. Hãy tạo hồ sơ liên quan hoặc kiểm tra quyền truy cập."
      : "No eligible source record. Create the related record first or check your access.";
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
      const data = formData(schema, values, tableValues);
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
      setExportError(language === "ko"
        ? unavailable ? "PDF/DOCX 출력 엔진이 설치되지 않았습니다. 관리자에게 운영 환경 설정을 요청하십시오." : "문서를 다운로드하지 못했습니다. 접근 권한과 연결 상태를 확인하십시오."
        : language === "vi"
          ? unavailable ? "Chưa cài đặt bộ xuất PDF/DOCX. Vui lòng liên hệ quản trị viên." : "Không tải được tài liệu. Kiểm tra quyền truy cập và kết nối."
          : unavailable ? "The PDF/DOCX export runtime is not installed. Ask an administrator to configure it." : "Document download failed. Check your access and connection.");
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
                {id} · {additionalFormNames[id]?.[language] ?? t("document.form." + id)}
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
          {sources.length > 1 && !source && <span className="muted">{language === "ko" ? "원본 기록을 직접 선택하십시오. 자동 선택하지 않습니다." : language === "vi" ? "Chọn hồ sơ nguồn; không chọn tự động." : "Select a source record explicitly."}</span>}
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
            {exporting === "docx" ? (language === "ko" ? "다운로드 중…" : "Downloading…") : "DOCX " + (language === "ko" ? "다운로드" : "Download")}
          </button>
          <button type="button" className="secondary" disabled={!snapshot || !!exporting || client.kind !== "http"}
            onClick={() => void download("pdf")}>
            {exporting === "pdf" ? (language === "ko" ? "다운로드 중…" : "Downloading…") : "PDF " + (language === "ko" ? "다운로드" : "Download")}
          </button>
        </div>
        {snapshot && <p className="muted" style={{ fontSize: 12 }}>
          {language === "ko" ? "다운로드 파일은 보존된 문서의 출력 사본이며 원본 서명·법정 인증이 이전되지는 않습니다." :
            language === "vi" ? "Bản tải về là bản sao của hồ sơ đã lưu; chữ ký và hiệu lực pháp lý không tự chuyển sang bản này." :
              "The downloaded file is a derivative. Legal signatures are not transferred."}
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
