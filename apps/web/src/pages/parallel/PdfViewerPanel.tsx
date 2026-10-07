import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./pdf-viewer.css";
import type { SupervisionClient } from "../../data/supervision-client";
import type { RecordDTO, Workspace } from "../../data/ui-contract";
import { listPdfEvidenceSources, loadPdfEvidence, uploadPdfEvidence } from "../../data/pdf-viewer-client";

GlobalWorkerOptions.workerSrc = workerSrc;

interface Props { client: SupervisionClient; workspace: Workspace; onChanged?: () => void }
type Status = { kind: "idle" | "loading" | "ready" | "error"; message?: string };

export function PdfViewerPanel({ client, workspace, onChanged }: Props) {
  const sources = useMemo(() => listPdfEvidenceSources(workspace), [workspace]);
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [uploading, setUploading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<number[]>([]);
  const [searching, setSearching] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const loadSequence = useRef(0);
  const searchSequence = useRef(0);
  const previewFiles = useRef(new Map<string, File>());
  const activeDocumentUrl = useRef<string | null>(null);
  const renderedDocumentSequence = useRef(0);
  const [searchError, setSearchError] = useState("");


  const cancelRender = useCallback(async () => {
    const task = renderRef.current;
    renderRef.current = null;
    if (task) {
      task.cancel();
      try { await task.promise; } catch { /* cancellation is expected */ }
    }
  }, []);

  useEffect(() => {
    let active = true;
    const sequence = ++loadSequence.current;
    renderedDocumentSequence.current = sequence;
    setSearchError("");
    if (!selectedId) {
      setStatus({ kind: "idle" });
      setPage(1);
      setPageCount(0);
      void (async () => {
        await cancelRender();
        try { await loadingRef.current?.destroy(); } catch { /* previous document shutdown */ }
        loadingRef.current = null;
        docRef.current = null;
        if (activeDocumentUrl.current) URL.revokeObjectURL(activeDocumentUrl.current);
        activeDocumentUrl.current = null;
      })();
      return () => { active = false; };
    }
    setStatus({ kind: "loading", message: "PDF를 불러오는 중…" });
    setPage(1); setPageCount(0); setMatches([]);
    void (async () => {
      try {
        await cancelRender();
        try { await loadingRef.current?.destroy(); } catch { /* previous document shutdown */ }
        loadingRef.current = null;
        docRef.current = null;
        if (activeDocumentUrl.current) URL.revokeObjectURL(activeDocumentUrl.current);
        activeDocumentUrl.current = null;
        const file = previewFiles.current.get(selectedId);
        const blob = file ?? await loadPdfEvidence(client, selectedId);
        if (!active || sequence !== loadSequence.current) return;
        const url = URL.createObjectURL(blob);
        activeDocumentUrl.current = url;
        const task = getDocument({ url, maxImageSize: 8_000_000 });
        loadingRef.current = task;
        const doc = await task.promise;
        if (!active || sequence !== loadSequence.current) {
          await task.destroy();
          URL.revokeObjectURL(url);
          if (activeDocumentUrl.current === url) activeDocumentUrl.current = null;
          return;
        }
        docRef.current = doc;
        setPageCount(doc.numPages);
        setStatus({ kind: "ready" });
      } catch (reason) {
        if (active && sequence === loadSequence.current) {
          const error = reason as Error;
          const message = error?.name === "PasswordException" ? "암호로 보호된 PDF는 현재 열 수 없습니다." : error?.name === "InvalidPDFException" || error?.name === "FormatError" ? "파일이 손상되었거나 올바른 PDF가 아닙니다." : error?.message || "PDF를 열지 못했습니다.";
          setStatus({ kind: "error", message });
        }
      }
    })();
    return () => { active = false; };
  }, [client, selectedId, cancelRender]);

  useEffect(() => () => {
    ++loadSequence.current;
    ++searchSequence.current;
    void (async () => {
      await cancelRender();
      try { await loadingRef.current?.destroy(); } catch { /* unmount cleanup */ }
      loadingRef.current = null;
      docRef.current = null;
      if (activeDocumentUrl.current) URL.revokeObjectURL(activeDocumentUrl.current);
      activeDocumentUrl.current = null;
      previewFiles.current.clear();
    })();
  }, [cancelRender]);

  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || status.kind !== "ready") return;
    let active = true;
    void (async () => {
      await cancelRender();
      const sequence = renderedDocumentSequence.current;
      if (!active || sequence !== loadSequence.current || docRef.current !== doc) return;
      try {
        const pdfPage = await doc.getPage(page);
        if (!active || sequence !== loadSequence.current || docRef.current !== doc) return;
        const viewport = pdfPage.getViewport({ scale: zoom, rotation });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cap = Math.sqrt(8_000_000 / (viewport.width * viewport.height * dpr * dpr));
        const outputScale = Math.min(dpr, cap, 2);
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const task = pdfPage.render({ canvas, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
        renderRef.current = task;
        await task.promise;
        if (active && sequence === loadSequence.current && docRef.current === doc) pdfPage.cleanup();
        if (renderRef.current === task) renderRef.current = null;
      } catch (reason) {
        if (active && !(reason instanceof Error && reason.name === "RenderingCancelledException")) setStatus({ kind: "error", message: "페이지를 그리지 못했습니다." });
      }
    })();
    return () => { active = false; };
  }, [page, zoom, rotation, status.kind, cancelRender, pageCount]);

  useEffect(() => {
    const doc = docRef.current;
    const term = query.trim().toLocaleLowerCase();
    const sequence = ++searchSequence.current;
    setMatches([]);
    setSearchError("");
    if (!doc || term.length < 2) { setSearching(false); return; }
    let active = true;
    setSearching(true);
    void (async () => {
      const found: number[] = [];
      const limit = Math.min(doc.numPages, 80);
      try {
        for (let number = 1; number <= limit && found.length < 100; number += 1) {
          if (!active || sequence !== searchSequence.current) return;
          const pdfPage = await doc.getPage(number);
          const content = await pdfPage.getTextContent();
          if (content.items.some((item) => "str" in item && item.str.toLocaleLowerCase().includes(term))) found.push(number);
        }
        if (active && sequence === searchSequence.current) setMatches(found);
      } catch {
        if (active && sequence === searchSequence.current) setSearchError("문서 텍스트를 검색할 수 없습니다.");
      } finally { if (active && sequence === searchSequence.current) setSearching(false); }
    })();
    return () => { active = false; };
  }, [query, selectedId, pageCount]);

  async function chooseFile(file?: File) {
    if (!file) return;
    setUploading(true); setStatus({ kind: "loading", message: "업로드 중…" });
    try {
      const record = await uploadPdfEvidence(client, workspace, file);
      const id = record.id;
      previewFiles.current.clear();
      previewFiles.current.set(id, file);
      setSelectedId(id);
      onChanged?.();
    } catch (reason) {
      setStatus({ kind: "error", message: reason instanceof Error ? reason.message : "PDF 업로드를 완료하지 못했습니다." });
    } finally { setUploading(false); }
  }

  const registerSource = (source: { id: string; name: string; mime: string; record: RecordDTO; drawing: boolean }) => (
    <option key={source.id} value={source.id}>{source.drawing ? "도면 연결 · " : "증빙 · "}{source.name}</option>
  );

  return <section aria-label="PDF 도면 뷰어" className="pdf-viewer-panel">
    <header className="pdf-viewer-header">
      <div><h2>도면 PDF</h2><p>원본 증빙을 읽기 전용으로 확인합니다.</p></div>
      <label className="pdf-upload-button">PDF 업로드<input data-testid="pdf-upload" type="file" accept="application/pdf,.pdf" disabled={uploading} onChange={(event) => { void chooseFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
    </header>
    <div className="pdf-toolbar">
      <label className="pdf-source-label">원본 선택<select aria-label="PDF 원본 선택" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
        <option value="">PDF 원본 선택…</option>{sources.map(registerSource)}
        {selectedId && !sources.some((source) => source.id === selectedId) && <option value={selectedId}>업로드한 PDF · {selectedId}</option>}
      </select></label>
      <label className="pdf-search-label">문서 검색<input type="search" aria-label="문서 검색" placeholder="텍스트 검색 (2자 이상)" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <span className="pdf-match-count" aria-live="polite">{searchError || (searching ? "검색 중…" : query.length >= 2 ? `${matches.length}개 페이지` : "")}</span>
    </div>
    {status.kind === "error" && <p className="pdf-state pdf-error" role="alert">{status.message}</p>}
    {status.kind === "loading" && <p className="pdf-state" role="status">{status.message}</p>}
    {status.kind === "idle" && !selectedId && <p className="pdf-state">등록된 PDF를 선택하거나 새 PDF를 업로드하세요.</p>}
    {status.kind === "ready" && <>
      <div className="pdf-page-controls">
        <button type="button" aria-label="이전 페이지" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>
        <label>페이지 <input aria-label="페이지 번호" type="number" min={1} max={pageCount} value={page} onChange={(event) => { const next = Number(event.target.value); if (next >= 1 && next <= pageCount) setPage(next); }} /> / {pageCount}</label>
        <button type="button" aria-label="다음 페이지" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button>
        <button type="button" aria-label="축소" onClick={() => setZoom((value) => Math.max(.5, +(value - .1).toFixed(1)))}>−</button><span>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="확대" onClick={() => setZoom((value) => Math.min(2.5, +(value + .1).toFixed(1)))}>＋</button>
        <button type="button" aria-label="회전" onClick={() => setRotation((value) => (value + 90) % 360)}>회전</button>
        {matches.map((match) => <button type="button" key={match} onClick={() => setPage(match)}>검색 결과 {match}</button>)}
      </div>
      <div className="pdf-canvas-viewport"><canvas ref={canvasRef} aria-label={`PDF 페이지 ${page} / ${pageCount}`} /></div>
      <footer className="pdf-readonly-note">읽기 전용 미리보기 · 업로드한 원본은 변경하지 않습니다.</footer>
    </>}
  </section>;
}
