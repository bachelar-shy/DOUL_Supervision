import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SupervisionClient } from "../data/supervision-client";
import type { Workspace } from "../data/ui-contract";

type Language = "vi" | "ko";
interface TranslationResult {
  original: string;
  translated: string;
  sourceLanguage: Language;
  targetLanguage: Language;
  model: string;
  reviewStatus: string;
  protectedTokensMatch: boolean;
  usableForOfficialIssue: boolean;
  metrics: { totalDurationMs: number; outputTokens: number };
}
interface DisplayedTranslation {
  scope: string;
  result: TranslationResult;
}

export function TranslationPreviewPanel({ client, workspace }: { client: SupervisionClient; workspace: Workspace }) {
  const { i18n } = useTranslation();
  const korean = (i18n.resolvedLanguage ?? i18n.language).startsWith("ko");
  const scope = [workspace.project.id, workspace.role.id, client.session?.actor.roleAssignmentId ?? "none"].join(":");
  const requestVersion = useRef(0);
  const [sourceLanguage, setSourceLanguage] = useState<Language>("vi");
  const [text, setText] = useState("");
  const [translated, setTranslated] = useState<DisplayedTranslation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const targetLanguage: Language = sourceLanguage === "vi" ? "ko" : "vi";

  // A role/project switch or unmount invalidates outstanding Ollama responses.
  useEffect(() => {
    requestVersion.current += 1;
    setTranslated(null);
    setBusy(false);
    setError("");
    return () => { requestVersion.current += 1; };
  }, [client, scope]);

  function invalidatePreview() {
    requestVersion.current += 1;
    setTranslated(null);
    setBusy(false);
    setError("");
  }

  async function preview() {
    if (!text.trim()) return;
    const original = text;
    const source = sourceLanguage;
    const target = targetLanguage;
    const requestScope = scope;
    const currentRequest = ++requestVersion.current;
    setBusy(true);
    setError("");
    setTranslated(null);
    try {
      const result = await client.request<TranslationResult>(client.path("/parallel/translation/preview"), {
        method: "POST",
        body: JSON.stringify({ text: original, sourceLanguage: source, targetLanguage: target }),
      });
      if (currentRequest !== requestVersion.current) return;
      if (
        result.original !== original || result.sourceLanguage !== source ||
        result.targetLanguage !== target || result.usableForOfficialIssue !== false ||
        result.reviewStatus !== "automatic_unverified"
      ) {
        throw new Error("TRANSLATION_RESULT_MISMATCH");
      }
      setTranslated({ scope: requestScope, result });
    } catch {
      if (currentRequest === requestVersion.current) {
        setError(korean
          ? "번역 요청이 실패하거나 현재 원문과 일치하지 않습니다. 원문을 유지하고 다시 확인하세요."
          : "Không thể xác minh bản dịch hiện tại. Giữ nguyên văn bản gốc.");
      }
    } finally {
      if (currentRequest === requestVersion.current) setBusy(false);
    }
  }

  // Also guard render synchronously before the project-change effect runs.
  const current = translated?.scope === scope &&
    translated.result.original === text &&
    translated.result.sourceLanguage === sourceLanguage &&
    translated.result.targetLanguage === targetLanguage
      ? translated.result : null;

  return (
    <section className="panel" data-ui-component="translation-preview"
      data-project-id={workspace.project.id}
      aria-label={korean ? "한·베 번역 미리보기" : "Xem trước bản dịch Hàn–Việt"}>
      <h3>{korean ? "한·베 번역 미리보기 (Gemma 4)" : "Xem trước bản dịch Hàn–Việt (Gemma 4)"}</h3>
      <p className="muted">{korean
        ? "원문은 변경되지 않습니다. 자동 번역은 공식 보고·승인 전에 담당자 검수가 필요합니다."
        : "Bản gốc không bị thay đổi. Cần người phụ trách kiểm tra trước khi phát hành."}</p>
      <label>{korean ? "원문 언어" : "Ngôn ngữ gốc"}
        <select aria-label={korean ? "원문 언어" : "Ngôn ngữ gốc"}
          value={sourceLanguage} onChange={event => {
            invalidatePreview();
            setSourceLanguage(event.target.value as Language);
          }}>
          <option value="vi">Tiếng Việt</option>
          <option value="ko">한국어</option>
        </select>
      </label>
      <label>{korean ? "번역할 내용" : "Nội dung cần dịch"}
        <textarea aria-label={korean ? "번역할 내용" : "Nội dung cần dịch"}
          value={text} maxLength={3000} rows={4}
          style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}
          onChange={event => {
            invalidatePreview();
            setText(event.target.value);
          }} />
      </label>
      <button className="secondary" type="button" disabled={busy || !text.trim()} onClick={() => void preview()}>
        {busy ? (korean ? "번역 중…" : "Đang dịch…") : (korean ? "번역 미리보기" : "Xem bản dịch")}
      </button>
      {error && <p role="alert" className="error-box">{error}</p>}
      {current && (
        <div className="notice" aria-live="polite" data-translation-status={current.reviewStatus}>
          <strong>{korean ? "번역 결과 · 검수 전" : "Bản dịch · Chưa kiểm tra"}</strong>
          <p>{korean ? "원문" : "Bản gốc"}</p>
          <p data-testid="translation-original" lang={current.sourceLanguage} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{current.original}</p>
          <p>{korean ? "번역" : "Bản dịch"}</p>
          <p data-testid="translation-output" lang={current.targetLanguage} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{current.translated}</p>
          {!current.protectedTokensMatch && <p role="alert">{korean
            ? "주의: 도면번호·수치가 원문과 일치하지 않습니다. 사용하지 마십시오."
            : "Cảnh báo: Mã bản vẽ hoặc số liệu không khớp. Không sử dụng."}</p>}
          <small>{current.model} · {current.metrics.totalDurationMs}ms · {korean
            ? "공식 문서 자동 반영 없음" : "Không tự đưa vào hồ sơ chính thức"}</small>
        </div>
      )}
    </section>
  );
}
