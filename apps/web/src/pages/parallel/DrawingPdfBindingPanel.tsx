import { useCallback, useEffect, useMemo, useState } from "react";
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
  const session = client.session;
  const isDemoAdmin = workspace.demo && workspace.role.actorGroup === "ADM" && workspace.role.roleCode === "project_admin";
  const pdfEvidence = useMemo(() => workspace.items
    .filter((item) => item.machine === "evidence")
    .map((item) => item.record)
    .filter((record) => record.sourceType === "original" && record.mediaType === "document"
      && (record.metadata?.mimeType === "application/pdf" || String(record.metadata?.name ?? "").toLowerCase().endsWith(".pdf"))),
  [workspace.items]);

  const refresh = useCallback(async () => {
    if (!session) {
      setDrawings([]);
      setBindings([]);
      setDrawingKey("");
      setEvidenceKey("");
      return;
    }
    try {
      const [drawingRows, bindingRows] = await Promise.all([
        listDrawingRevisions(client, session.projectId),
        listDrawingPdfBindings(client, session.projectId),
      ]);
      setDrawings(drawingRows);
      setBindings(bindingRows);
      setDrawingKey((current) => drawingRows.some((item) => refKey(item.domainRef) === current) ? current : "");
      const availablePdfKeys = new Set(pdfEvidence.map((item) => refKey(exactRef("Evidence", item))));
      setEvidenceKey((current) => availablePdfKeys.has(current) ? current : "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [client, session?.projectId, pdfEvidence]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectedDrawing = drawings.find((item) => refKey(item.domainRef) === drawingKey);
  const selectedEvidence = pdfEvidence.find((item) => refKey(exactRef("Evidence", item)) === evidenceKey);
  const alreadyBound = bindings.find((binding) => selectedDrawing && refKey(binding.drawingRef) === refKey(selectedDrawing.domainRef));

  async function bind() {
    if (!selectedDrawing || !selectedEvidence || !isDemoAdmin || busy) return;
    setBusy(true);
    setError("");
    setMessage("도면과 PDF 원본을 확인하고 있습니다…");
    try {
      const binding = await createDrawingPdfBinding(client, workspace.context.projectId,
        selectedDrawing.domainRef, exactRef("Evidence", selectedEvidence));
      setMessage(`PDF 도면 연결을 저장했습니다 · ${binding.id} · SHA-256 ${binding.fileHash}`);
      await refresh();
      await onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setMessage("");
    } finally {
      setBusy(false);
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
            disabled={busy} onChange={(event) => setDrawingKey(event.target.value)}>
            <option value="">연결할 도면 버전 선택</option>
            {drawings.map((drawing) => <option key={refKey(drawing.domainRef)} value={refKey(drawing.domainRef)}>
              {drawing.title ?? drawing.domainRef.objectId} · Rev {drawing.revision ?? "—"} · v{drawing.domainRef.version}
            </option>)}
          </select>
        </label>
        <label className="text-sm font-medium">PDF 원본
          <select className="mt-1 block w-full rounded-md border bg-background px-3 py-2" value={evidenceKey}
            disabled={busy} onChange={(event) => setEvidenceKey(event.target.value)}>
            <option value="">연결할 PDF 증빙 선택</option>
            {pdfEvidence.map((record) => <option key={record.id} value={refKey(exactRef("Evidence", record))}>
              {String(record.metadata?.name ?? record.id)} · {record.id} · v{record.version}
            </option>)}
          </select>
        </label>
      </div>
      <button type="button" className="mt-3 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
        disabled={busy || !selectedDrawing || !selectedEvidence || Boolean(alreadyBound)} onClick={() => void bind()}>
        {alreadyBound ? "이 도면 버전은 이미 PDF와 연결됨" : "선택한 버전 연결"}
      </button>
      {alreadyBound && <p className="mt-2 break-all text-sm text-muted-foreground">
        연결된 증빙: {alreadyBound.evidenceRef.objectId} · SHA-256 {alreadyBound.fileHash}
      </p>}
      {!pdfEvidence.length && <p className="mt-2 text-sm text-muted-foreground">먼저 PDF 도면 보기에서 공식 PDF 원본을 등록하세요.</p>}
    </>}
    {message && <p className="mt-3 break-all text-sm" role="status">{message}</p>}
    {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
    <ul className="mt-4 space-y-2 text-sm" aria-label="저장된 도면 PDF 연결">
      {bindings.map((binding) => <li key={binding.id} className="break-all rounded border p-2">
        도면 {binding.drawingRef.objectId} · v{binding.drawingRef.version} → PDF {binding.evidenceRef.objectId} · SHA-256 {binding.fileHash}
      </li>)}
    </ul>
  </section>;
}
