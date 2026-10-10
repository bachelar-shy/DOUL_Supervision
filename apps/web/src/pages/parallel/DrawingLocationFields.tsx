import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SupervisionClient } from "../../data/supervision-client";
import type { DomainRef } from "../../data/ui-contract";
import { listDrawingRevisions, type DrawingRevisionOption } from "../../data/drawing-pdf-binding-client";
import { reasonLabel } from "../../labels";
import { ApiError } from "../../data/supervision-client";

type Anchor = { drawingRef: DomainRef; page: number; x: number; y: number; coordinateSystem: string };
const copy = {
  ko: { drawing: "표시할 도면", page: "도면 쪽", x: "가로 표시 위치", y: "세로 표시 위치", add: "도면 표시 위치 추가", remove: "표시 위치 삭제", choose: "도면 선택", retained: "기존 연결 도면", failed: "도면 목록을 불러오지 못했습니다.", version: "작성 차수" },
  vi: { drawing: "Bản vẽ", page: "Trang bản vẽ", x: "Vị trí ngang", y: "Vị trí dọc", add: "Thêm vị trí bản vẽ", remove: "Xóa vị trí", choose: "Chọn bản vẽ", retained: "Bản vẽ đã liên kết", failed: "Không thể tải bản vẽ.", version: "Phiên bản" },
  en: { drawing: "Drawing", page: "Drawing page", x: "Horizontal position", y: "Vertical position", add: "Add drawing position", remove: "Remove position", choose: "Select drawing", retained: "Linked drawing", failed: "Could not load drawings.", version: "Version" },
};

export function DrawingLocationFields({ client, projectId, value, onChange, disabled }: { client: SupervisionClient; projectId: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  const { i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage || i18n.language).slice(0, 2);
  const t = copy[locale === "vi" || locale === "en" ? locale : "ko"];
  const [drawings, setDrawings] = useState<DrawingRevisionOption[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true; setDrawings([]); setError("");
    listDrawingRevisions(client, projectId).then(rows => { if (active) setDrawings(rows); }).catch(cause => { if (active) setError(cause instanceof ApiError ? reasonLabel(cause.detail.code) : t.failed); });
    return () => { active = false; };
  }, [client, projectId, t.failed]);
  const anchors: Anchor[] = JSON.parse(value);
  const update = (index: number, patch: Partial<Anchor>) => onChange(JSON.stringify(anchors.map((anchor, i) => i === index ? { ...anchor, ...patch } : anchor)));
  return <div className="space-y-3">
    {error && <p role="alert">{error}</p>}
    {anchors.map((anchor, index) => <fieldset key={index} disabled={disabled} className="grid gap-2 rounded border p-2 sm:grid-cols-2">
      <legend>{index + 1}</legend>
      <label>{t.drawing}<select value={JSON.stringify(anchor.drawingRef)} onChange={event => update(index, { drawingRef: JSON.parse(event.target.value) as DomainRef })}>
        {!drawings.some(d => JSON.stringify(d.domainRef) === JSON.stringify(anchor.drawingRef)) && <option value={JSON.stringify(anchor.drawingRef)}>{t.retained} · {t.version} {anchor.drawingRef.version}</option>}
        {drawings.map(d => <option key={JSON.stringify(d.domainRef)} value={JSON.stringify(d.domainRef)}>{d.title || t.drawing} · {d.revision} · {t.version} {d.domainRef.version}</option>)}
      </select></label>
      {(["page", "x", "y"] as const).map(key => <label key={key}>{t[key]}<input type="number" min={key === "page" ? 1 : undefined} step={key === "page" ? 1 : "any"} required value={anchor[key] ?? ""} onChange={event => update(index, { [key]: event.target.value === "" ? NaN : Number(event.target.value) })} /></label>)}
      <button type="button" onClick={() => onChange(JSON.stringify(anchors.filter((_, i) => i !== index)))}>{t.remove}</button>
    </fieldset>)}
    {!disabled && <button type="button" disabled={!drawings.length} onClick={() => onChange(JSON.stringify([...anchors, { drawingRef: drawings[0].domainRef, page: 1, x: 0, y: 0, coordinateSystem: "pdf_points" }]))}>{t.add}</button>}
  </div>;
}
