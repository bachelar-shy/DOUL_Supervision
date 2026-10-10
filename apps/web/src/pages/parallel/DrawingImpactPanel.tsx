import { recordTypeLabel } from "../../labels";
import { recordVersionLabel } from "../../labels";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeLanguage } from "@doul/localization";
import { ApiError, type SupervisionClient } from "../../data/supervision-client";
import type { DomainRef, DrawingImpactHistory, DrawingImpactIncident, Workspace } from "../../data/ui-contract";
import { listDrawingImpacts, listDrawingImpactHistory } from "../../data/drawing-impact-client";
import { listDrawingPdfBindings, drawingPdfContent, type DrawingPdfBinding } from "../../data/drawing-pdf-binding-client";
import { resolveNotificationSourceTarget } from "../../data/notification-target-client";
import { ActionButton, Panel, SectionHeader } from "../../ui";
import { reasonLabel, states } from "../../labels";

const sameRef = (a: DomainRef, b: DomainRef) => a.objectType === b.objectType && a.objectId === b.objectId && a.version === b.version;
type Locale = "ko" | "vi" | "en";
const copy: Record<Locale, Record<string, string>> = {
  ko: {
    sourceChanged: "원본 개정 변경", approvalUnavailable: "승인 근거 사용 불가", fieldSourceUnavailable: "현장 사용 조건 변경", inspection: "검측", issue: "현장 지적사항", corrective: "시정조치", historical: "사건 당시 기록 · ", responsible: "담당", exactSource: "업무 원본 보기", pastWarning: "과거 업무 작성 차수입니다. 현재 제{{version}}차과 구분하여 확인하십시오.", currentSource: "현재 업무 별도 보기", sourceUnavailable: "업무 원본을 현재 업무 화면에서 열 수 없습니다.",
    title: "도면 영향 업무", meta: "읽기 전용 · 현재 권한으로 조회", refresh: "다시 조회", selectedVersion: "선택한 도면의 정확한 작성 차수를 기준으로 표시합니다. 다른 개정본으로 자동 이동하지 않습니다.", loading: "영향 업무를 불러오는 중…", closePdf: "도면 원본 닫기", openPdf: "해당 작성 차수 도면 원본 보기", pdfUnavailable: "해당 작성 차수의 PDF 원본을 현재 권한으로 열 수 없습니다.", pdfLoading: "도면 원본을 불러오는 중…", pdfError: "도면 원본을 열 수 없습니다. {{detail}}", pdfFallback: "잠시 후 다시 시도하십시오.", pdfTitle: "해당 작성 차수 도면 원본", currentTitle: "현재 미완료 영향 업무", currentLoadError: "영향 업무를 불러오지 못했습니다. {{detail}}", currentFallback: "잠시 후 다시 시도하십시오.", noCurrent: "현재 조회 가능한 미완료 영향 업무가 없습니다. 과거 알림의 업무가 완료되거나 도면 사용 조건이 복구되었을 수 있습니다.", drawing: "도면", revision: "개정", needsReason: "사용 조건 확인 필요", currentItems: "현재 조회 가능한 미완료 업무 {{count}}건", historyTitle: "발생·해소 이력", historyDescription: "사건 당시 관측한 업무 작성 차수의 기록입니다. 연결 업무의 완료 또는 재승인을 뜻하지 않습니다.", historyLoadError: "발생·해소 이력을 불러오지 못했습니다. {{detail}}", historyFallback: "잠시 후 다시 시도하십시오.", noHistory: "현재 조회 가능한 발생·해소 이력이 없습니다.", restored: "사용 조건 복구 관측", occurred: "발생", restoredAt: "복구 관측 {{time}}", restoredTimeMissing: "복구 시각 미기록", noRevision: "미표기",
  },
  vi: {
    sourceChanged: "Phiên bản nguồn đã thay đổi", approvalUnavailable: "Không thể dùng căn cứ phê duyệt", fieldSourceUnavailable: "Điều kiện sử dụng tại hiện trường đã thay đổi", inspection: "Kiểm tra", issue: "Sự cố hiện trường", corrective: "Hành động khắc phục", historical: "Bản ghi tại thời điểm sự kiện · ", responsible: "Phụ trách", exactSource: "Mở công việc gốc", pastWarning: "Đây là phiên bản công việc cũ. Hãy phân biệt với phiên bản hiện tại v{{version}}.", currentSource: "Mở riêng công việc hiện tại", sourceUnavailable: "Không thể mở công việc gốc trong không gian làm việc hiện tại.",
    title: "Công việc bị ảnh hưởng bởi bản vẽ", meta: "Chỉ đọc · theo quyền hiện tại", refresh: "Tải lại", selectedVersion: "Hiển thị theo đúng phiên bản bản vẽ đã chọn. Không tự chuyển sang bản sửa đổi khác.", loading: "Đang tải công việc bị ảnh hưởng…", closePdf: "Đóng bản vẽ gốc", openPdf: "Xem bản vẽ gốc của phiên bản này", pdfUnavailable: "Không thể mở PDF gốc của phiên bản này với quyền hiện tại.", pdfLoading: "Đang tải bản vẽ gốc…", pdfError: "Không thể mở bản vẽ gốc. {{detail}}", pdfFallback: "Vui lòng thử lại sau.", pdfTitle: "Bản vẽ gốc của phiên bản này", currentTitle: "Công việc hiện tại chưa hoàn tất bị ảnh hưởng", currentLoadError: "Không thể tải công việc bị ảnh hưởng. {{detail}}", currentFallback: "Vui lòng thử lại sau.", noCurrent: "Không có công việc chưa hoàn tất nào có thể xem hiện tại. Công việc trong thông báo cũ có thể đã hoàn tất hoặc điều kiện sử dụng bản vẽ đã được khôi phục.", drawing: "Bản vẽ", revision: "Bản sửa đổi", needsReason: "Cần kiểm tra điều kiện sử dụng", currentItems: "{{count}} công việc chưa hoàn tất có thể xem hiện tại", historyTitle: "Lịch sử phát sinh và khôi phục", historyDescription: "Bản ghi phiên bản công việc được quan sát tại thời điểm sự kiện. Điều này không có nghĩa công việc liên kết đã hoàn tất hoặc được phê duyệt lại.", historyLoadError: "Không thể tải lịch sử phát sinh và khôi phục. {{detail}}", historyFallback: "Vui lòng thử lại sau.", noHistory: "Không có lịch sử phát sinh và khôi phục nào có thể xem hiện tại.", restored: "Đã quan sát khôi phục điều kiện sử dụng", occurred: "Phát sinh", restoredAt: "Quan sát khôi phục {{time}}", restoredTimeMissing: "Chưa ghi thời điểm khôi phục", noRevision: "Không ghi rõ",
  },
  en: {
    sourceChanged: "Source revision changed", approvalUnavailable: "Approval basis unavailable", fieldSourceUnavailable: "Field use conditions changed", inspection: "Inspection", issue: "Field issue", corrective: "Corrective action", historical: "Record at event time · ", responsible: "Responsible", exactSource: "Open source work item", pastWarning: "This is a past work item version. Review it separately from current v{{version}}.", currentSource: "Open current work item separately", sourceUnavailable: "The source work item is unavailable in the current workspace.",
    title: "Drawing impact work", meta: "Read only · current permissions", refresh: "Refresh", selectedVersion: "Showing results for the exact selected drawing version. The view does not move automatically to another revision.", loading: "Loading impacted work…", closePdf: "Close source drawing", openPdf: "View this version’s source drawing", pdfUnavailable: "The PDF source for this version is unavailable with current permissions.", pdfLoading: "Loading source drawing…", pdfError: "Could not open the source drawing. {{detail}}", pdfFallback: "Try again later.", pdfTitle: "Source drawing for this version", currentTitle: "Current incomplete impacted work", currentLoadError: "Could not load impacted work. {{detail}}", currentFallback: "Try again later.", noCurrent: "No incomplete impacted work is currently available. Work in an earlier notice may be complete, or drawing use conditions may have been restored.", drawing: "Drawing", revision: "Revision", needsReason: "Use conditions need review", currentItems: "{{count}} currently available incomplete work items", historyTitle: "Occurrence and restoration history", historyDescription: "These are records of work item versions observed at the time of each event. They do not indicate that linked work was completed or reapproved.", historyLoadError: "Could not load occurrence and restoration history. {{detail}}", historyFallback: "Try again later.", noHistory: "No occurrence or restoration history is currently available.", restored: "Use conditions restoration observed", occurred: "Occurred", restoredAt: "Restoration observed {{time}}", restoredTimeMissing: "Restoration time not recorded", noRevision: "Unspecified",
  },
};
const reasonKeys: Record<string, string> = { SOURCE_CHANGED: "sourceChanged", APPROVAL_UNAVAILABLE: "approvalUnavailable", FIELD_SOURCE_UNAVAILABLE: "fieldSourceUnavailable" };
function txFor(language: Locale, key: string, values?: Record<string, string | number>) {
  let result = copy[language][key] ?? copy.en[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) result = result.replaceAll(`{{${name}}}`, String(value));
  return result;
}
const errorText = (cause: unknown, fallback: string) => cause instanceof ApiError ? reasonLabel(cause.detail.code) : fallback;

export function DrawingImpactPanel({ client, workspace, drawingRef, incidentId, onSelect, onNavigate }: {
  client: SupervisionClient; workspace: Workspace; drawingRef: DomainRef; incidentId?: string;
  onSelect?: (id: string | null) => void; onNavigate?: (route: string) => void;
}) {
  const { i18n } = useTranslation();
  const language: Locale = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);
  const tx = (key: string, values?: Record<string, string | number>) => txFor(language, key, values);
  const [refresh, setRefresh] = useState(0);
  const scopeKey = JSON.stringify([workspace.project.id, workspace.role.id, client.session?.actor.roleAssignmentId, drawingRef, incidentId, refresh]);
  const [snapshot, setSnapshot] = useState<{ scope: string; rows: DrawingImpactIncident[]; history: DrawingImpactHistory[]; bindings: DrawingPdfBinding[]; error: string; historyError: string } | null>(null);
  const [previewScope, setPreviewScope] = useState("");
  const preview = previewScope === scopeKey;
  const [pdf, setPdf] = useState<{ scope: string; url: string; error: string } | null>(null);
  useEffect(() => {
    let ignore = false;
    void (async () => {
      const [current, history, bindings] = await Promise.allSettled([
        listDrawingImpacts(client, workspace.project.id),
        listDrawingImpactHistory(client, workspace.project.id),
        listDrawingPdfBindings(client, workspace.project.id),
      ]);
      if (!ignore) setSnapshot({
        scope: scopeKey,
        rows: current.status === "fulfilled" ? current.value : [],
        history: history.status === "fulfilled" ? history.value : [],
        bindings: bindings.status === "fulfilled" ? bindings.value : [],
        error: current.status === "rejected" ? errorText(current.reason, tx("currentFallback")) : "",
        historyError: history.status === "rejected" ? errorText(history.reason, tx("historyFallback")) : "",
      });
    })();
    return () => { ignore = true; };
  }, [client, workspace.project.id, workspace.role.id, scopeKey]);
  const ready = snapshot?.scope === scopeKey ? snapshot : null;
  const matchesSelection = (row: DrawingImpactIncident) => sameRef(row.drawingRef, drawingRef) && (!incidentId || row.incidentId === incidentId);
  const incidents = ready?.rows.filter(matchesSelection) ?? [];
  const history = ready?.history.filter(matchesSelection) ?? [];
  const exactBindings = ready?.bindings.filter(row => row.projectId === workspace.project.id && sameRef(row.drawingRef, drawingRef)) ?? [];
  const bindingId = exactBindings.length === 1 ? exactBindings[0].id : "";
  useEffect(() => {
    let ignore = false;
    let objectUrl = "";
    if (preview && bindingId) void drawingPdfContent(client, bindingId).then(blob => {
      if (ignore) return;
      objectUrl = URL.createObjectURL(blob);
      setPdf({ scope: scopeKey, url: objectUrl, error: "" });
    }).catch(cause => {
      if (!ignore) setPdf({ scope: scopeKey, url: "", error: errorText(cause, tx("pdfFallback")) });
    });
    return () => { ignore = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [client, bindingId, preview, scopeKey]);
  const visiblePdf = pdf?.scope === scopeKey ? pdf : null;
  function open(id: string, route: string) { onNavigate?.(route); onSelect?.(id); }
  function workRows(rows: DrawingImpactIncident["items"], historical = false) {
    return <ul>{rows.map(row => {
      const target = resolveNotificationSourceTarget(row.sourceRef, workspace.project.id, workspace);
      return <li key={JSON.stringify(row.sourceRef)} {...(historical ? { "data-impact-history-work": row.sourceRef.objectId } : { "data-impact-work": row.sourceRef.objectId })}>
        <strong>{row.title}</strong> · {row.sourceRef.objectType === "Inspection" ? tx("inspection") : row.sourceRef.objectType === "Issue" ? tx("issue") : tx("corrective")} · {states[row.status] || row.status}
        <p>{historical ? tx("historical") : ""}{row.sourceRef.objectId} · {recordVersionLabel(row.sourceRef.version)} · {tx("responsible")} {row.responsiblePartyId}</p>
        {target.kind === "exact" && onNavigate && <ActionButton onClick={() => open(target.item.record.id, target.route)}>{tx("exactSource")}</ActionButton>}
        {target.kind === "past" && <p>{tx("pastWarning", { version: target.currentItem.record.version })}
          {onNavigate && <ActionButton onClick={() => open(target.currentItem.record.id, target.route)}>{tx("currentSource")}</ActionButton>}
        </p>}
        {target.kind === "unavailable" && <p>{tx("sourceUnavailable")}</p>}
      </li>;
    })}</ul>;
  }
  return <Panel className="drawing-impact-panel" data-testid="drawing-impact-panel">
    <SectionHeader title={tx("title")} meta={tx("meta")} />
    <ActionButton onClick={() => { setPdf(null); setPreviewScope(""); setRefresh(value => value + 1); }}>{tx("refresh")}</ActionButton>
    <p data-testid="impact-drawing-ref">{recordTypeLabel(drawingRef.objectType)} · {drawingRef.objectId} · {recordVersionLabel(drawingRef.version)}</p>
    <p>{tx("selectedVersion")}</p>
    {!ready && <p role="status">{tx("loading")}</p>}
    {ready && <>
      {bindingId ? <ActionButton onClick={() => { setPdf(null); setPreviewScope(preview ? "" : scopeKey); }}>{preview ? tx("closePdf") : tx("openPdf")}</ActionButton>
        : <p>{tx("pdfUnavailable")}</p>}
      {preview && bindingId && !visiblePdf && <p role="status">{tx("pdfLoading")}</p>}
      {preview && visiblePdf?.error && <p role="alert">{tx("pdfError", { detail: visiblePdf.error })}</p>}
      {preview && visiblePdf?.url && <iframe title={tx("pdfTitle")} src={visiblePdf.url} style={{ width: "100%", height: "32rem", border: 0 }} />}
      <section data-testid="drawing-impact-current">
        <h3>{tx("currentTitle")}</h3>
        {ready.error ? <p role="alert">{tx("currentLoadError", { detail: ready.error })}</p> : <>
          {!incidents.length && <p>{tx("noCurrent")}</p>}
          {incidents.map(incident => <section key={incident.incidentId} data-impact-incident={incident.incidentId}>
            <h4>{incident.title || tx("drawing")} · {tx("revision")} {incident.revision || tx("noRevision")}</h4>
            <p>{reasonKeys[incident.reason] ? tx(reasonKeys[incident.reason]) : incident.reason} · {incident.occurredAt}</p>
            <p>{tx("currentItems", { count: incident.items.length })}</p>
            {workRows(incident.items)}
          </section>)}
        </>}
      </section>
      <section data-testid="drawing-impact-history">
        <h3>{tx("historyTitle")}</h3>
        <p>{tx("historyDescription")}</p>
        {ready.historyError ? <p role="alert">{tx("historyLoadError", { detail: ready.historyError })}</p> : <>
          {!history.length && <p>{tx("noHistory")}</p>}
          {history.map(event => <section key={event.incidentId} data-impact-history-incident={event.incidentId}>
            <h4>{event.title || tx("drawing")} · {tx("revision")} {event.revision || tx("noRevision")}</h4>
            <p>{event.state === "active" ? tx("needsReason") : tx("restored")}</p>
            <p>{reasonKeys[event.reason] ? tx(reasonKeys[event.reason]) : event.reason} · {tx("occurred")} {event.occurredAt}</p>
            {event.state === "restored" && <p>{event.resolvedAt ? tx("restoredAt", { time: event.resolvedAt }) : tx("restoredTimeMissing")}</p>}
            {workRows(event.items, true)}
          </section>)}
        </>}
      </section>
    </>}
  </Panel>;
}
