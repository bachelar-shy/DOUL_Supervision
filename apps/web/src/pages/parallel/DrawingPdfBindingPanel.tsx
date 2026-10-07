import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DomainRef, RecordDTO, Workspace } from "../../data/ui-contract";
import type { SupervisionClient } from "../../data/supervision-client";
import {
  createDrawingPdfBinding,
  listDrawingPdfBindings,
  listDrawingRevisions,
  type DrawingPdfBinding,
  type DrawingRevisionOption,
} from "../../data/drawing-pdf-binding-client";

interface Props {
  client: SupervisionClient;
  workspace: Workspace;
  onChanged?: () => void | Promise<void>;
}

function exactRef(kind: string, record: RecordDTO): DomainRef {
  return { objectType: kind, objectId: record.id, version: record.version };
}

function refKey(ref: DomainRef) {
  return `${ref.objectType}:${ref.objectId}:${ref.version}`;
}

export function DrawingPdfBindingPanel({ client, workspace, onChanged }: Props) {
  const [drawings, setDrawings] = useState<DrawingRevisionOption[]>([]);
  const [bindings, setBindings] = useState<DrawingPdfBinding[]>([]);
  const [drawingKey, setDrawingKey] = useState("");
  const [evidenceKey, setEvidenceKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadedScope, setLoadedScope] = useState("");
  const requestSequence = useRef(0);
  const bindSequence = useRef(0);
  const mounted = useRef(false);
  const session = client.session;
  const scopeKey = `${session?.projectId ?? ""}:${session?.actor.partyId ?? ""}:${session?.actor.roleAssignmentId ?? ""}:${workspace.project.id}:${workspace.role.id}:${workspace.role.actorGroup}:${workspace.role.roleCode}:${workspace.demo}`;
  const activeScope = useRef(scopeKey);
  if (activeScope.current !== scopeKey) {
    activeScope.current = scopeKey;
    requestSequence.current += 1;
    bindSequence.current += 1;
  }
  const isDemoAdmin = workspace.demo && workspace.role.actorGroup === "ADM" && workspace.role.roleCode === "project_admin";
  const pdfEvidence = useMemo(() => workspace.items
    .filter((item) => item.machine === "evidence")
    .map((item) => item.record)
    .filter((record) => record.sourceType === "original" && record.mediaType === "document"
      && (record.metadata?.mimeType === "application/pdf" || String(record.metadata?.name ?? "").toLowerCase().endsWith(".pdf"))),
  [workspace.items]);

  const refresh = useCallback(async () => {
    const scope = scopeKey;
    if (!session) {
      if (mounted.current && activeScope.current === scope) {
        setDrawings([]);
        setBindings([]);
        setLoadedScope(scope);
      }
      return;
    }
    const sequence = ++requestSequence.current;
    const isCurrent = () => mounted.current && activeScope.current === scope && requestSequence.current === sequence;
    try {
      const [drawingRows, bindingRows] = await Promise.all([
        listDrawingRevisions(client, session.projectId),
        listDrawingPdfBindings(client, session.projectId),
      ]);
      if (!isCurrent()) return;
      setDrawings(drawingRows);
      setBindings(bindingRows);
      setLoadedScope(scope);
      const validDrawingKeys = new Set(drawingRows.map((item) => refKey(item.domainRef)));
      setDrawingKey((current) => validDrawingKeys.has(current) ? current : "");
      const availablePdfKeys = new Set(pdfEvidence.map((item) => refKey(exactRef("Evidence", item))));
      setEvidenceKey((current) => availablePdfKeys.has(current) ? current : "");
      setError("");
    } catch (cause) {
      if (isCurrent()) {
        setDrawings([]);
        setBindings([]);
        setDrawingKey("");
        setEvidenceKey("");
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoadedScope(scope);
      }
    }
  }, [client, session?.projectId, pdfEvidence, scopeKey]);

  useEffect(() => {
    mounted.current = true;
    setDrawings([]);
    setBindings([]);
    setDrawingKey("");
    setEvidenceKey("");
    setLoadedScope("");
    setMessage("");
    setError("");
    setBusy(false);
    if (!session) setLoadedScope(scopeKey);
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
      bindSequence.current += 1;
    };
  }, [scopeKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  const scopeReady = loadedScope === scopeKey;
  const currentDrawings = scopeReady ? drawings : [];
  const currentBindings = scopeReady ? bindings : [];
  const selectedDrawing = currentDrawings.find((item) => refKey(item.domainRef) === drawingKey);
  const selectedEvidence = pdfEvidence.find((item) => refKey(exactRef("Evidence", item)) === evidenceKey);
  const alreadyBound = currentBindings.find((binding) => selectedDrawing && refKey(binding.drawingRef) === refKey(selectedDrawing.domainRef));

  async function bind() {
    if (!selectedDrawing || !selectedEvidence || !isDemoAdmin || busy) return;
    const scope = scopeKey;
    const sequence = ++bindSequence.current;
    const isCurrent = () => mounted.current && activeScope.current === scope && bindSequence.current === sequence;
    setBusy(true);
    setError("");
    setMessage("도면과 PDF 원본을 확인하고 있습니다…");
    try {
      const binding = await createDrawingPdfBinding(client, workspace.context.projectId,
        selectedDrawing.domainRef, exactRef("Evidence", selectedEvidence));
      if (!isCurrent()) return;
      setMessage(`PDF 도면 연결을 저장했습니다 · ${binding.id} · SHA-256 ${binding.fileHash}`);
      await refresh();
      if (isCurrent()) await onChanged?.();
    } catch (cause) {
      if (isCurrent()) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setMessage("");
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  return <section className="rounded-lg border bg-card p-4" aria-labelledby="drawing-pdf-binding-title">
    <h2 id="drawing-pdf-binding-title" className="text-lg font-semibold">도면 PDF 연결</h2>
    <p className="mt-1 text-sm text-muted-foreground">
      예시 관리자 기능입니다. 선택한 도면 버전과 등록된 PDF 원본을 기술 인덱스에 연결하며 공식 승인 상태는 변경하지 않습니다.
    </p>
    {!isDemoAdmin ? <p className="mt-3 text-sm text-muted-foreground">시범 프로젝트 관리자 계정에서만 연결할 수 있습니다.</p> : <>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium">도면 버전
          <select className="mt-1 block w-full rounded-md border bg-background px-3 py-2" value={drawingKey}
            disabled={busy || !scopeReady} onChange={(event) => setDrawingKey(event.target.value)}>
            <option value="">연결할 도면 버전 선택</option>
            {currentDrawings.map((drawing) => <option key={refKey(drawing.domainRef)} value={refKey(drawing.domainRef)}>
              {drawing.title ?? drawing.domainRef.objectId} · Rev {drawing.revision ?? "—"} · v{drawing.domainRef.version}
            </option>)}
          </select>
        </label>
        <label className="text-sm font-medium">PDF 원본
          <select className="mt-1 block w-full rounded-md border bg-background px-3 py-2" value={evidenceKey}
            disabled={busy || !scopeReady} onChange={(event) => setEvidenceKey(event.target.value)}>
            <option value="">연결할 PDF 증빙 선택</option>
            {pdfEvidence.map((record) => <option key={record.id} value={refKey(exactRef("Evidence", record))}>
              {String(record.metadata?.name ?? record.id)} · {record.id} · v{record.version}
            </option>)}
          </select>
        </label>
      </div>
      <button type="button" className="mt-3 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
        disabled={!scopeReady || busy || !selectedDrawing || !selectedEvidence || Boolean(alreadyBound)} onClick={() => void bind()}>
        {alreadyBound ? "이 도면 버전은 이미 PDF와 연결됨" : "선택한 버전 연결"}
      </button>
      {alreadyBound && <p className="mt-2 break-all text-sm text-muted-foreground">
        연결된 증빙: {alreadyBound.evidenceRef.objectId} · SHA-256 {alreadyBound.fileHash}
      </p>}
      {!pdfEvidence.length && <p className="mt-2 text-sm text-muted-foreground">먼저 PDF 도면 보기에서 공식 PDF 원본을 등록하세요.</p>}
    </>}
    {scopeReady && message && <p className="mt-3 break-all text-sm" role="status">{message}</p>}
    {scopeReady && error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
    {scopeReady && <ul className="mt-4 space-y-2 text-sm" aria-label="저장된 도면 PDF 연결">
      {currentBindings.map((binding) => <li key={binding.id} className="break-all rounded border p-2">
        도면 {binding.drawingRef.objectId} · v{binding.drawingRef.version} → PDF {binding.evidenceRef.objectId} · SHA-256 {binding.fileHash}
      </li>)}
    </ul>}
  </section>;
}
