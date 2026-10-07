import { useEffect, useMemo, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { SupervisionClient } from "../../data/supervision-client";
import type { Workspace } from "../../data/ui-contract";
import { fetchDrawingPdfBindings, type DrawingPdfBinding } from "../../data/pdf-pin-client";
import "./drawing-compare.css";

GlobalWorkerOptions.workerSrc = workerSrc;

interface Props { client: SupervisionClient; workspace: Workspace }
type PaneState = "loading" | "ready" | "error";

function recordTitle(workspace: Workspace, objectId: string, version: number): string {
  const item = workspace.items.find((entry) => entry.record.id === objectId && entry.record.version === version);
  if (!item) return objectId;
  const metadata = item.record.metadata ?? {};
  return typeof metadata.name === "string" ? metadata.name
    : typeof item.record.title === "string" ? item.record.title : objectId;
}

function bindingLabel(workspace: Workspace, binding: DrawingPdfBinding): string {
  return `${recordTitle(workspace, binding.drawingRef.objectId, binding.drawingRef.version)} v${binding.drawingRef.version} · ${recordTitle(workspace, binding.evidenceRef.objectId, binding.evidenceRef.version)} v${binding.evidenceRef.version}`;
}

function PdfComparePane({ client, binding, label, side }: {
  client: SupervisionClient; binding: DrawingPdfBinding | undefined; label: string; side: "left" | "right";
}) {
  const [state, setState] = useState<PaneState>("loading");
  const [error, setError] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const loadingRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const renderSequence = useRef(0);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setContainerSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    setContainerSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sequence = ++loadSequence.current;
    let active = true;
    setPageCount(0);
    setPageNumber(1);
    setState("loading");
    setError("");
    documentRef.current = null;
    renderRef.current?.cancel();
    renderRef.current = null;
    const previousLoading = loadingRef.current;
    loadingRef.current = null;
    const previousUrl = objectUrlRef.current;
    objectUrlRef.current = null;
    void (async () => {
      try { await previousLoading?.destroy(); } catch { /* replacing previous PDF */ }
      if (previousUrl) URL.revokeObjectURL(previousUrl);
    })();

    if (!binding) {
      setState("error");
      setError("비교할 도면 연결을 선택하세요.");
      return () => { active = false; };
    }

    void (async () => {
      let objectUrl: string | null = null;
      try {
        const blob = await client.drawingPdfContent(binding.id);
        if (!active || sequence !== loadSequence.current) return;
        if (blob.type && !blob.type.toLowerCase().includes("pdf") && blob.type !== "application/octet-stream") {
          throw new Error("선택한 도면 연결에서 PDF를 가져오지 못했습니다.");
        }
        objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        const task = getDocument({ url: objectUrl, maxImageSize: 8_000_000 });
        loadingRef.current = task;
        const document = await task.promise;
        if (!active || sequence !== loadSequence.current) {
          await task.destroy();
          URL.revokeObjectURL(objectUrl);
          if (objectUrlRef.current === objectUrl) objectUrlRef.current = null;
          return;
        }
        documentRef.current = document;
        setPageCount(document.numPages);
        setState("ready");
      } catch (reason) {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          if (objectUrlRef.current === objectUrl) objectUrlRef.current = null;
        }
        if (active && sequence === loadSequence.current) {
          setError(reason instanceof Error && (reason.name === "InvalidPDFException" || reason.name === "FormatError")
            ? "파일이 손상되었거나 올바른 PDF가 아닙니다."
            : reason instanceof Error ? reason.message : "도면 PDF를 불러오지 못했습니다.");
          setState("error");
        }
      }
    })();
    return () => { active = false; };
  }, [client, binding?.id, binding?.drawingRef.version, binding?.evidenceRef.version]);

  useEffect(() => () => {
    ++loadSequence.current;
    ++renderSequence.current;
    renderRef.current?.cancel();
    renderRef.current = null;
    const loading = loadingRef.current;
    loadingRef.current = null;
    const objectUrl = objectUrlRef.current;
    objectUrlRef.current = null;
    documentRef.current = null;
    void (async () => {
      try { await loading?.destroy(); } catch { /* unmount cleanup */ }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    })();
  }, []);

  useEffect(() => {
    const pdfDocument = documentRef.current;
    const canvas = canvasRef.current;
    if (!pdfDocument || !canvas || state !== "ready" || !pageCount || !containerSize.width || !containerSize.height) return;
    let active = true;
    const sequence = ++renderSequence.current;
    setRendering(true);
    const previousRender = renderRef.current;
    renderRef.current = null;
    if (previousRender) {
      previousRender.cancel();
      void previousRender.promise.catch(() => undefined);
    }
    let scratch: HTMLCanvasElement | null = null;

    void (async () => {
      try {
        const pdfPage = await pdfDocument.getPage(pageNumber);
        if (!active || sequence !== renderSequence.current || documentRef.current !== pdfDocument) return;
        const effectiveRotation = ((pdfPage.rotate || 0) + rotation) % 360;
        const baseViewport = pdfPage.getViewport({ scale: 1, rotation: effectiveRotation });
        const fitScale = Math.min(
          Math.max(120, containerSize.width - 32) / baseViewport.width,
          Math.max(120, containerSize.height - 32) / baseViewport.height,
        );
        const viewport = pdfPage.getViewport({ scale: Math.min(Math.max(fit ? fitScale : zoom, 0.2), 4), rotation: effectiveRotation });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const outputScale = Math.min(dpr, Math.sqrt(4_000_000 / Math.max(1, viewport.width * viewport.height)), 2);
        const width = Math.max(1, Math.floor(viewport.width * outputScale));
        const height = Math.max(1, Math.floor(viewport.height * outputScale));
        scratch = globalThis.document.createElement("canvas");
        scratch.width = width;
        scratch.height = height;
        const task = pdfPage.render({
          canvas: scratch, viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        renderRef.current = task;
        await task.promise;
        if (!active || sequence !== renderSequence.current || documentRef.current !== pdfDocument) return;
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = viewport.width + "px";
        canvas.style.height = viewport.height + "px";
        const context = canvas.getContext("2d");
        if (!context) throw new Error("페이지 캔버스를 사용할 수 없습니다.");
        context.drawImage(scratch, 0, 0);
        setRendering(false);
        if (renderRef.current === task) renderRef.current = null;
        pdfPage.cleanup();
      } catch (reason) {
        if (active && sequence === renderSequence.current && !(reason instanceof Error && reason.name === "RenderingCancelledException")) {
          setError("PDF 페이지를 표시하지 못했습니다.");
          setState("error");
          setRendering(false);
        }
      } finally {
        if (scratch) { scratch.width = 0; scratch.height = 0; }
      }
    })();

    return () => {
      active = false;
      const task = renderRef.current;
      if (task) { renderRef.current = null; task.cancel(); }
    };
  }, [state, pageNumber, pageCount, fit, zoom, rotation, containerSize.width, containerSize.height]);

  const changePage = (value: number) => setPageNumber(Math.min(Math.max(value, 1), pageCount));
  const title = side === "left" ? "왼쪽 도면" : "오른쪽 도면";
  const pageLabel = side === "left" ? "왼쪽 페이지" : "오른쪽 페이지";
  const percentLabel = side === "left" ? "왼쪽 확대율" : "오른쪽 확대율";

  return (
    <section className="drawing-compare-pane" aria-label={title + " PDF"}>
      <header className="drawing-compare-pane-header">
        <div><h3>{title}</h3><p title={label}>{label}</p>
          {binding && <small>도면 {binding.drawingRef.objectId} v{binding.drawingRef.version} · 증빙 {binding.evidenceRef.objectId} v{binding.evidenceRef.version}</small>}
        </div>
      </header>
      <div className="drawing-compare-toolbar">
        <div className="drawing-compare-page-tools">
          <button type="button" aria-label="이전 페이지" onClick={() => changePage(pageNumber - 1)} disabled={state !== "ready" || pageNumber <= 1}>이전</button>
          <label>페이지 <input aria-label={pageLabel} type="number" min={1} max={Math.max(1, pageCount)} value={pageNumber} disabled={state !== "ready" || !pageCount} onChange={(event) => changePage(Number(event.target.value) || 1)} /><span>/ {pageCount || "—"}</span></label>
          <button type="button" aria-label="다음 페이지" onClick={() => changePage(pageNumber + 1)} disabled={state !== "ready" || pageNumber >= pageCount}>다음</button>
        </div>
        <div className="drawing-compare-view-tools">
          <button type="button" aria-label="맞춤" aria-pressed={fit} onClick={() => setFit(true)}>맞춤</button>
          <button type="button" aria-label="축소" onClick={() => { setFit(false); setZoom((value) => Math.max(0.2, Math.round((value - 0.1) * 100) / 100)); }}>−</button>
          <span aria-label={percentLabel}>{fit ? "맞춤" : Math.round(zoom * 100) + "%"}</span>
          <button type="button" aria-label="확대" onClick={() => { setFit(false); setZoom((value) => Math.min(4, Math.round((value + 0.1) * 100) / 100)); }}>+</button>
          <button type="button" aria-label="회전" onClick={() => setRotation((value) => (value + 90) % 360)}>회전 {rotation}°</button>
        </div>
      </div>
      <div className="drawing-compare-canvas-viewport" ref={viewportRef} data-testid={`drawing-compare-${side}-viewport`}>
        {state === "error" ? <p className="drawing-compare-state drawing-compare-error" role="alert">{error}</p>
          : state === "loading" ? <p className="drawing-compare-state" role="status">PDF를 여는 중…</p>
            : <div className="drawing-compare-canvas-stage">
              <canvas ref={canvasRef} aria-label={`${side === "left" ? "왼쪽" : "오른쪽"} PDF 페이지 ${pageNumber} / ${pageCount}`} />
              {rendering && <span className="drawing-compare-rendering" role="status">페이지를 표시하는 중…</span>}
            </div>}
      </div>
    </section>
  );
}

export function DrawingComparePanel({ client, workspace }: Props) {
  const [bindings, setBindings] = useState<DrawingPdfBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const requestSequence = useRef(0);

  useEffect(() => {
    let active = true;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    void fetchDrawingPdfBindings(client).then((items) => {
      if (active && sequence === requestSequence.current) {
        setBindings(items.filter((item) => item.projectId === workspace.project.id));
        setLoading(false);
      }
    }).catch((reason) => {
      if (active && sequence === requestSequence.current) {
        setError(reason instanceof Error ? reason.message : "도면 PDF 연결 목록을 불러오지 못했습니다.");
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [client, workspace.project.id, workspace.role.id]);

  const options = useMemo(() => bindings.map((binding) => ({ binding, label: bindingLabel(workspace, binding) })), [bindings, workspace]);
  useEffect(() => {
    if (leftId && !bindings.some((binding) => binding.id === leftId)) setLeftId("");
    if (rightId && !bindings.some((binding) => binding.id === rightId)) setRightId("");
  }, [bindings, leftId, rightId]);
  const left = bindings.find((binding) => binding.id === leftId);
  const right = bindings.find((binding) => binding.id === rightId);

  return (
    <section className="drawing-compare-panel" aria-label="도면 PDF 비교">
      <header className="drawing-compare-heading"><div><h2>도면 PDF 비교</h2>
        <p>도면 연결 두 건을 골라 각 페이지를 따로 확인합니다. 비교 화면은 원본과 공식 도면 상태를 변경하지 않습니다.</p></div></header>
      <div className="drawing-compare-selectors">
        <label>왼쪽 도면 연결
          <select aria-label="왼쪽 도면 연결" value={leftId} disabled={loading} onChange={(event) => setLeftId(event.target.value)}>
            <option value="">도면 연결 선택</option>
            {options.map(({ binding, label }) => <option key={binding.id} value={binding.id} disabled={binding.id === rightId}>{label}</option>)}
          </select>
        </label>
        <label>오른쪽 도면 연결
          <select aria-label="오른쪽 도면 연결" value={rightId} disabled={loading} onChange={(event) => setRightId(event.target.value)}>
            <option value="">도면 연결 선택</option>
            {options.map(({ binding, label }) => <option key={binding.id} value={binding.id} disabled={binding.id === leftId}>{label}</option>)}
          </select>
        </label>
        {loading && <span role="status">도면 연결을 불러오는 중…</span>}
        {error && <p role="alert">{error}</p>}
        {!loading && !error && options.length < 2 && <p role="status">비교하려면 PDF 도면 연결이 두 건 필요합니다.</p>}
      </div>
      <div className="drawing-compare-grid">
        <PdfComparePane client={client} binding={left} label={left ? bindingLabel(workspace, left) : "선택된 도면 없음"} side="left" />
        <PdfComparePane client={client} binding={right} label={right ? bindingLabel(workspace, right) : "선택된 도면 없음"} side="right" />
      </div>
      <p className="drawing-compare-note">두 문서는 독립적으로 움직입니다. 자동 정렬, 차이 판정, 주석 이동이나 개정 대체는 수행하지 않습니다.</p>
    </section>
  );
}
