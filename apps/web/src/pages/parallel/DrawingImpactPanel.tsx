import { useEffect, useState } from "react";
import type { SupervisionClient } from "../../data/supervision-client";
import type { DomainRef, DrawingImpactIncident, Workspace } from "../../data/ui-contract";
import { listDrawingImpacts } from "../../data/drawing-impact-client";
import { listDrawingPdfBindings, drawingPdfContent, type DrawingPdfBinding } from "../../data/drawing-pdf-binding-client";
import { resolveNotificationSourceTarget } from "../../data/notification-target-client";
import { ActionButton, Panel, SectionHeader } from "../../ui";

const sameRef = (a: DomainRef, b: DomainRef) => a.objectType === b.objectType && a.objectId === b.objectId && a.version === b.version;
const reasonLabels: Record<string, string> = { SOURCE_CHANGED: "원본 개정 변경", APPROVAL_UNAVAILABLE: "승인 근거 사용 불가", FIELD_SOURCE_UNAVAILABLE: "현장 사용 조건 변경" };

export function DrawingImpactPanel({ client, workspace, drawingRef, incidentId, onSelect, onNavigate }: {
  client: SupervisionClient; workspace: Workspace; drawingRef: DomainRef; incidentId?: string;
  onSelect?: (id: string | null) => void; onNavigate?: (route: string) => void;
}) {
  const scopeKey = JSON.stringify([workspace.project.id, workspace.role.id, client.session?.actor.roleAssignmentId, drawingRef, incidentId]);
  const [snapshot, setSnapshot] = useState<{ scope: string; rows: DrawingImpactIncident[]; bindings: DrawingPdfBinding[]; error: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const [pdf, setPdf] = useState<{ scope: string; url: string; error: string } | null>(null);
  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const rows = await listDrawingImpacts(client, workspace.project.id);
        let bindings: DrawingPdfBinding[] = [];
        try { bindings = await listDrawingPdfBindings(client, workspace.project.id); } catch { /* Exact source remains explicitly unavailable. */ }
        if (!ignore) setSnapshot({ scope: scopeKey, rows, bindings, error: "" });
      } catch (cause) {
        if (!ignore) setSnapshot({ scope: scopeKey, rows: [], bindings: [], error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { ignore = true; };
  }, [client, workspace.project.id, workspace.role.id, scopeKey]);
  const ready = snapshot?.scope === scopeKey ? snapshot : null;
  const incidents = ready?.rows.filter(row => sameRef(row.drawingRef, drawingRef) && (!incidentId || row.incidentId === incidentId)) ?? [];
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
      if (!ignore) setPdf({ scope: scopeKey, url: "", error: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => { ignore = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [client, bindingId, preview, scopeKey]);
  const visiblePdf = pdf?.scope === scopeKey ? pdf : null;
  function open(id: string, route: string) { onNavigate?.(route); onSelect?.(id); }
  return <Panel className="drawing-impact-panel" data-testid="drawing-impact-panel">
    <SectionHeader title="도면 영향 업무" meta="읽기 전용 · 현재 권한으로 조회" />
    <p data-testid="impact-drawing-ref">{drawingRef.objectType} · {drawingRef.objectId} · v{drawingRef.version}</p>
    <p>선택한 도면의 정확한 버전을 기준으로 표시합니다. 다른 개정본으로 자동 이동하지 않습니다.</p>
    {!ready && <p role="status">영향 업무를 불러오는 중…</p>}
    {ready?.error && <p role="alert">영향 업무를 불러오지 못했습니다. {ready.error}</p>}
    {ready && !ready.error && <>
      {bindingId ? <ActionButton onClick={() => setPreview(value => !value)}>{preview ? "도면 원본 닫기" : "해당 버전 도면 원본 보기"}</ActionButton>
        : <p>해당 버전의 PDF 원본을 현재 권한으로 열 수 없습니다.</p>}
      {preview && bindingId && !visiblePdf && <p role="status">도면 원본을 불러오는 중…</p>}
      {preview && visiblePdf?.error && <p role="alert">도면 원본을 열 수 없습니다. {visiblePdf.error}</p>}
      {preview && visiblePdf?.url && <iframe title="해당 버전 도면 원본" src={visiblePdf.url} style={{ width: "100%", height: "32rem", border: 0 }} />}
      {!incidents.length && <p>현재 조회 가능한 미완료 영향 업무가 없습니다. 과거 알림의 업무가 완료되거나 도면 사용 조건이 복구되었을 수 있습니다.</p>}
      {incidents.map(incident => <section key={incident.incidentId} data-impact-incident={incident.incidentId}>
        <h3>{incident.title || "도면"} · 개정 {incident.revision || "미표기"}</h3>
        <p>{reasonLabels[incident.reason] || incident.reason} · {incident.occurredAt}</p>
        <p>현재 조회 가능한 미완료 업무 {incident.items.length}건</p>
        <ul>{incident.items.map(row => {
          const target = resolveNotificationSourceTarget(row.sourceRef, workspace.project.id, workspace);
          return <li key={JSON.stringify(row.sourceRef)} data-impact-work={row.sourceRef.objectId}>
            <strong>{row.title}</strong> · {row.sourceRef.objectType === "Inspection" ? "검측" : row.sourceRef.objectType === "Issue" ? "현장 이슈" : "시정조치"} · {row.status}
            <p>{row.sourceRef.objectId} · v{row.sourceRef.version} · 담당 {row.responsiblePartyId}</p>
            {target.kind === "exact" && onNavigate && <ActionButton onClick={() => open(target.item.record.id, target.route)}>업무 원본 보기</ActionButton>}
            {target.kind === "past" && <p>과거 업무 버전입니다. 현재 v{target.currentItem.record.version}과 구분하여 확인하십시오.
              {onNavigate && <ActionButton onClick={() => open(target.currentItem.record.id, target.route)}>현재 업무 별도 보기</ActionButton>}
            </p>}
            {target.kind === "unavailable" && <p>업무 원본을 현재 작업공간에서 열 수 없습니다.</p>}
          </li>;
        })}</ul>
      </section>)}
    </>}
  </Panel>;
}
