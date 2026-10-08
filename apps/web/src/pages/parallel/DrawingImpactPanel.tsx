import { useEffect, useState } from "react";
import type { SupervisionClient } from "../../data/supervision-client";
import type { DomainRef, DrawingImpactHistory, DrawingImpactIncident, Workspace } from "../../data/ui-contract";
import { listDrawingImpacts, listDrawingImpactHistory } from "../../data/drawing-impact-client";
import { listDrawingPdfBindings, drawingPdfContent, type DrawingPdfBinding } from "../../data/drawing-pdf-binding-client";
import { resolveNotificationSourceTarget } from "../../data/notification-target-client";
import { ActionButton, Panel, SectionHeader } from "../../ui";

const sameRef = (a: DomainRef, b: DomainRef) => a.objectType === b.objectType && a.objectId === b.objectId && a.version === b.version;
const reasonLabels: Record<string, string> = { SOURCE_CHANGED: "원본 개정 변경", APPROVAL_UNAVAILABLE: "승인 근거 사용 불가", FIELD_SOURCE_UNAVAILABLE: "현장 사용 조건 변경" };
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function DrawingImpactPanel({ client, workspace, drawingRef, incidentId, onSelect, onNavigate }: {
  client: SupervisionClient; workspace: Workspace; drawingRef: DomainRef; incidentId?: string;
  onSelect?: (id: string | null) => void; onNavigate?: (route: string) => void;
}) {
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
        error: current.status === "rejected" ? errorText(current.reason) : "",
        historyError: history.status === "rejected" ? errorText(history.reason) : "",
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
      if (!ignore) setPdf({ scope: scopeKey, url: "", error: errorText(cause) });
    });
    return () => { ignore = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [client, bindingId, preview, scopeKey]);
  const visiblePdf = pdf?.scope === scopeKey ? pdf : null;
  function open(id: string, route: string) { onNavigate?.(route); onSelect?.(id); }
  function workRows(rows: DrawingImpactIncident["items"], historical = false) {
    return <ul>{rows.map(row => {
      const target = resolveNotificationSourceTarget(row.sourceRef, workspace.project.id, workspace);
      return <li key={JSON.stringify(row.sourceRef)} {...(historical ? { "data-impact-history-work": row.sourceRef.objectId } : { "data-impact-work": row.sourceRef.objectId })}>
        <strong>{row.title}</strong> · {row.sourceRef.objectType === "Inspection" ? "검측" : row.sourceRef.objectType === "Issue" ? "현장 이슈" : "시정조치"} · {row.status}
        <p>{historical ? "사건 당시 기록 · " : ""}{row.sourceRef.objectId} · v{row.sourceRef.version} · 담당 {row.responsiblePartyId}</p>
        {target.kind === "exact" && onNavigate && <ActionButton onClick={() => open(target.item.record.id, target.route)}>업무 원본 보기</ActionButton>}
        {target.kind === "past" && <p>과거 업무 버전입니다. 현재 v{target.currentItem.record.version}과 구분하여 확인하십시오.
          {onNavigate && <ActionButton onClick={() => open(target.currentItem.record.id, target.route)}>현재 업무 별도 보기</ActionButton>}
        </p>}
        {target.kind === "unavailable" && <p>업무 원본을 현재 작업공간에서 열 수 없습니다.</p>}
      </li>;
    })}</ul>;
  }
  return <Panel className="drawing-impact-panel" data-testid="drawing-impact-panel">
    <SectionHeader title="도면 영향 업무" meta="읽기 전용 · 현재 권한으로 조회" />
    <ActionButton onClick={() => { setPdf(null); setPreviewScope(""); setRefresh(value => value + 1); }}>다시 조회</ActionButton>
    <p data-testid="impact-drawing-ref">{drawingRef.objectType} · {drawingRef.objectId} · v{drawingRef.version}</p>
    <p>선택한 도면의 정확한 버전을 기준으로 표시합니다. 다른 개정본으로 자동 이동하지 않습니다.</p>
    {!ready && <p role="status">영향 업무를 불러오는 중…</p>}
    {ready && <>
      {bindingId ? <ActionButton onClick={() => { setPdf(null); setPreviewScope(preview ? "" : scopeKey); }}>{preview ? "도면 원본 닫기" : "해당 버전 도면 원본 보기"}</ActionButton>
        : <p>해당 버전의 PDF 원본을 현재 권한으로 열 수 없습니다.</p>}
      {preview && bindingId && !visiblePdf && <p role="status">도면 원본을 불러오는 중…</p>}
      {preview && visiblePdf?.error && <p role="alert">도면 원본을 열 수 없습니다. {visiblePdf.error}</p>}
      {preview && visiblePdf?.url && <iframe title="해당 버전 도면 원본" src={visiblePdf.url} style={{ width: "100%", height: "32rem", border: 0 }} />}
      <section data-testid="drawing-impact-current">
        <h3>현재 미완료 영향 업무</h3>
        {ready.error ? <p role="alert">영향 업무를 불러오지 못했습니다. {ready.error}</p> : <>
          {!incidents.length && <p>현재 조회 가능한 미완료 영향 업무가 없습니다. 과거 알림의 업무가 완료되거나 도면 사용 조건이 복구되었을 수 있습니다.</p>}
          {incidents.map(incident => <section key={incident.incidentId} data-impact-incident={incident.incidentId}>
            <h4>{incident.title || "도면"} · 개정 {incident.revision || "미표기"}</h4>
            <p>{reasonLabels[incident.reason] || incident.reason} · {incident.occurredAt}</p>
            <p>현재 조회 가능한 미완료 업무 {incident.items.length}건</p>
            {workRows(incident.items)}
          </section>)}
        </>}
      </section>
      <section data-testid="drawing-impact-history">
        <h3>발생·해소 이력</h3>
        <p>사건 당시 관측한 업무 버전의 기록입니다. 연결 업무의 완료 또는 재승인을 뜻하지 않습니다.</p>
        {ready.historyError ? <p role="alert">발생·해소 이력을 불러오지 못했습니다. {ready.historyError}</p> : <>
          {!history.length && <p>현재 조회 가능한 발생·해소 이력이 없습니다.</p>}
          {history.map(event => <section key={event.incidentId} data-impact-history-incident={event.incidentId}>
            <h4>{event.title || "도면"} · 개정 {event.revision || "미표기"}</h4>
            <p>{event.state === "active" ? "사용 조건 확인 필요" : "사용 조건 복구 관측"}</p>
            <p>{reasonLabels[event.reason] || event.reason} · 발생 {event.occurredAt}</p>
            {event.state === "restored" && <p>{event.resolvedAt ? "복구 관측 " + event.resolvedAt : "복구 시각 미기록"}</p>}
            {workRows(event.items, true)}
          </section>)}
        </>}
      </section>
    </>}
  </Panel>;
}
