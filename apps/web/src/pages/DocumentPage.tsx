import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { formFieldLabel } from "@doul/localization";
import type { FormSchema, RecordDTO, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { ApiError } from "../data/supervision-client";
import { reasonLabel } from "../labels";
import { DocumentWorkspaceTemplate } from "../ui/templates";
import { PageBoundary } from "./PageBoundary";
import { Icon } from "./shared";
import { recordTitle, recordRef } from "./record-utils";
import { DocumentSigningPanel } from "./DocumentSigningPanel";

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
    let v = values[f] || "";
    if (!v) continue;
    if (r.type === "date-time") v = new Date(v).toISOString();
    putPath(data, f, r.type === "boolean" ? v === "true" : v);
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

const documentCopy = {
  ko: {
    language: "문서 출력 언어", mode: "렌더링 종류", draft: "초안 렌더", final: "최종 스냅샷 렌더",
    finalButton: "최종 HTML 스냅샷 생성", draftStatus: "초안 · 법정 발행본 아님", yes: "예", no: "아니요",
    finalStatus: "최종 스냅샷 · 서명은 별도 절차", noFinalData: "최종 렌더에 필요한 항목을 모두 입력하세요.",
    genericError: "문서 렌더를 완료할 수 없습니다. 입력과 연결을 확인한 뒤 다시 시도하세요.",
  },
  vi: {
    language: "Ngôn ngữ tài liệu", mode: "Loại kết xuất", draft: "Kết xuất bản nháp", final: "Kết xuất ảnh chụp cuối cùng",
    finalButton: "Tạo ảnh chụp HTML cuối cùng", draftStatus: "Bản nháp · Chưa phải hồ sơ pháp lý được phát hành", yes: "Có", no: "Không",
    finalStatus: "Ảnh chụp cuối cùng · Cần quy trình ký riêng", noFinalData: "Hãy điền tất cả các trường cần thiết để kết xuất bản cuối cùng.",
    genericError: "Không thể hoàn tất kết xuất tài liệu. Hãy kiểm tra thông tin và liên kết rồi thử lại.",
  },
  en: {
    language: "Document output language", mode: "Render type", draft: "Render draft", final: "Render final snapshot",
    finalButton: "Generate final HTML snapshot", draftStatus: "Draft · Not a legally issued record", yes: "Yes", no: "No",
    finalStatus: "Final snapshot · Signing is a separate step", noFinalData: "Complete every required field before rendering a final snapshot.",
    genericError: "The document could not be rendered. Check the inputs and source, then try again.",
  },
} as const;

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
  const [documentLanguage, setDocumentLanguage] = useState<"ko" | "vi" | "en">("ko");
  const [renderMode, setRenderMode] = useState<"draft" | "final">("draft");
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [snapshot, setSnapshot] = useState<RecordDTO | null>(null);
  const renderAttempt = useRef<{ fingerprint: string; key: ReturnType<typeof crypto.randomUUID> } | null>(null);
  const schema = workspace.formSchemas[form];
  const copy = documentCopy[documentLocale(i18n.resolvedLanguage ?? i18n.language)];
  const sources = workspace.items.filter((x) =>
    ["report", "issue", "inspection"].includes(x.machine),
  );
  async function preview(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const item =
      sources.find((x) => x.record.id === source) ||
      sources.find((x) =>
        form === "FM-09"
          ? x.machine === "inspection"
          : form === "FM-12"
            ? x.machine === "issue"
            : x.machine === "report",
      );
    if (!item) {
      setErr(t("document.error.noSource"));
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
      const data = formData(schema, values);
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
              setHtml("");
              setValues({});
              setSnapshot(null);
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
        <label>
          {copy.language}
          <select
            aria-label={copy.language}
            value={documentLanguage}
            onChange={(event) => setDocumentLanguage(event.target.value as typeof documentLanguage)}
          >
            <option value="ko">한국어 · Korean</option>
            <option value="vi">Tiếng Việt · Vietnamese</option>
            <option value="en">English</option>
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
          <button type="button" className="secondary" disabled>
            {t("document.action.docxPending")}
          </button>
          <button type="button" className="secondary" disabled>
            {t("document.action.pdfPending")}
          </button>
        </div>
        {err && (
          <div role="alert" className="error-box">
            {err}
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
