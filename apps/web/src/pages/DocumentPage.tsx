import { useState } from "react";
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
      if (!item) throw new Error("문서 원본을 선택하십시오.");
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
        <h2>데이터 연결 문서</h2>
        <label>
          DOUL 양식
          <select
            aria-label="문서 양식"
            value={form}
            onChange={(e) => {
              setForm(e.target.value);
              setHtml("");
              setValues({});
            }}
          >
            {[
              ["FM-20", "발주처 즉시보고"],
              ["FM-19", "주간보고"],
              ["FM-21", "의사결정 요청서"],
              ["FM-12", "부적합 보고서"],
              ["FM-09", "검수기록"],
            ].map(([id, t]) => (
              <option key={id} value={id}>
                {id} · {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          원본 기록
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="문서 원본 선택"
          >
            <option value="">양식에 맞는 원본 자동 선택</option>
            {sources.map((x) => (
              <option value={x.record.id} key={x.record.id}>
                {recordTitle(x.record)} · v{x.record.version}
              </option>
            ))}
          </select>
        </label>
        <div className="notice">
          미리보기는 초안입니다. 발행본은 원본 버전·템플릿·출력 해시를
          보존합니다.
        </div>
        <details open>
          <summary>초안 작성 항목</summary>
          <div className="document-fields">
            {Object.entries(schema.scalar_fields).map(([f, r]) => (
              <label key={f}>
                {f}
                {r.required ? " *" : ""}
                <input
                  value={values[f] || ""}
                  placeholder={
                    r.type === "date-time"
                      ? "2026-10-05T09:00:00+07:00"
                      : r.type === "boolean"
                        ? "true / false"
                        : "원본 연결 또는 직접 입력"
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
          {busy ? "원본 버전으로 생성 중…" : "초안 HTML 생성"}
        </button>
        <div className="two-buttons">
          <button className="secondary" disabled>
            DOCX 연동 전
          </button>
          <button className="secondary" disabled>
            PDF 연동 전
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
          <b>A4 미리보기</b>
          <span>초안 · 법정 발행본 아님</span>
        </div>
        {html ? (
          <iframe title="문서 초안 미리보기" sandbox="" srcDoc={html} />
        ) : (
          <div className="paper-empty">
            <Icon name="document" />
            <h2>문서를 원본 데이터에 연결합니다.</h2>
            <p>왼쪽에서 양식과 기록을 선택해 초안을 만드십시오.</p>
          </div>
        )}
        {snapshot && (
          <small className="snapshot-note">
            스냅샷 {snapshot.id.slice(0, 8)} · 출력 해시{" "}
            {String(snapshot.renderHash).slice(0, 20)}…
          </small>
        )}
      </section>
      </DocumentWorkspaceTemplate>
    </PageBoundary>
  );
}
