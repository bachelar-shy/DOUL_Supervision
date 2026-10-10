import { useState } from "react";
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
  usableForOfficialIssue: false;
  metrics: { totalDurationMs: number; outputTokens: number };
}

export function TranslationPreviewPanel({ client, workspace }: { client: SupervisionClient; workspace: Workspace }) {
  const { i18n } = useTranslation();
  const korean = (i18n.resolvedLanguage ?? i18n.language).startsWith("ko");
  const [sourceLanguage, setSourceLanguage] = useState<Language>("vi");
  const [text, setText] = useState("");
  const [translated, setTranslated] = useState<TranslationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const targetLanguage: Language = sourceLanguage === "vi" ? "ko" : "vi";
  async function preview() {
    setBusy(true);
    setError("");
    setTranslated(null);
    try {
      const result = await client.request<TranslationResult>(client.path("/parallel/translation/preview"), {
        method: "POST",
        body: JSON.stringify({ text, sourceLanguage, targetLanguage }),
      });
      setTranslated(result);
    } catch {
      setError(korean ? "로컬 번역 서비스를 사용할 수 없습니다. 원문을 유지하고 확인하세요." : "Không thể kết nối dịch máy nội bộ. Giữ nguyên văn bản gốc.");
    } finally {
      setBusy(false);
    }
  }
  return <section className="panel" data-ui-component="translation-preview" aria-label={korean ? "한·베 번역 미리보기" : "Xem trước bản dịch Hàn–Việt"}>
    <h3>{korean ? "한·베 번역 미리보기 (Gemma 4)" : "Xem trước bản dịch Hàn–Việt (Gemma 4)"}</h3>
    <p className="muted">{korean ? "원문은 변경되지 않습니다. 자동 번역은 공식 보고·승인 전에 담당자 검수가 필요합니다." : "Bản gốc không bị thay đổi. Cần người phụ trách kiểm tra trước khi phát hành."}</p>
    <label>{korean ? "원문 언어" : "Ngôn ngữ gốc"}<select aria-label={korean ? "원문 언어" : "Ngôn ngữ gốc"} value={sourceLanguage} onChange={e => { setSourceLanguage(e.target.value as Language); setTranslated(null); }}>
      <option value="vi">Tiếng Việt</option><option value="ko">한국어</option>
    </select></label>
    <label>{korean ? "번역할 내용" : "Nội dung cần dịch"}<textarea aria-label={korean ? "번역할 내용" : "Nội dung cần dịch"} value={text} maxLength={3000} rows={4} onChange={e => { setText(e.target.value); setTranslated(null); }} /></label>
    <button className="secondary" type="button" disabled={busy || !text.trim()} onClick={() => void preview()}>{busy ? (korean ? "번역 중…" : "Đang dịch…") : (korean ? "번역 미리보기" : "Xem bản dịch")}</button>
    {error && <p role="alert" className="error-box">{error}</p>}
    {translated && <div className="notice" aria-live="polite">
      <strong>{korean ? "번역 결과 · 검수 전" : "Bản dịch · Chưa kiểm tra"}</strong>
      <p lang={translated.targetLanguage} style={{ whiteSpace: "pre-wrap" }}>{translated.translated}</p>
      {!translated.protectedTokensMatch && <p role="alert">{korean ? "주의: 도면번호·수치가 원문과 일치하지 않습니다. 사용하지 마십시오." : "Cảnh báo: Mã bản vẽ hoặc số liệu không khớp. Không sử dụng."}</p>}
      <small>{translated.model} · {translated.metrics.totalDurationMs}ms · {korean ? "공식 문서 자동 반영 없음" : "Không tự đưa vào hồ sơ chính thức"}</small>
    </div>}
  </section>;
}
