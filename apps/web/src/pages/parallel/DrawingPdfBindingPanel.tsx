import { recordVersionLabel } from "../../labels";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeLanguage } from "@doul/localization";
import type { DomainRef, RecordDTO, Workspace } from "../../data/ui-contract";
import type { SupervisionClient } from "../../data/supervision-client";
import { ApiError } from "../../data/supervision-client";
import { reasonLabel } from "../../labels";
import {
  createDrawingPdfBinding,
  listDrawingPdfBindings,
  listDrawingRevisions,
  type DrawingPdfBinding,
  type DrawingRevisionOption,
} from "../../data/drawing-pdf-binding-client";

type Locale = "ko" | "vi" | "en";
interface Message { key: string; values?: Record<string, string> }
interface Props {
  client: SupervisionClient;
  workspace: Workspace;
  onChanged?: () => void | Promise<void>;
}

const copy: Record<Locale, Record<string, string>> = {
  ko: {
    title: "도면 PDF 연결",
    description: "예시 관리자 기능입니다. 선택한 도면 작성 차수와 등록된 PDF 원본을 도면 연결 목록에 연결하며 공식 승인 상태는 변경하지 않습니다.",
    adminOnly: "시범 현장 관리자 계정에서만 연결할 수 있습니다.",
    drawingVersion: "도면 작성 차수",
    selectDrawing: "연결할 도면 작성 차수 선택",
    revision: "개정",
    pdfOriginal: "PDF 원본",
    selectPdf: "연결할 PDF 증빙 선택",
    alreadyBound: "이 도면 작성 차수는 이미 PDF와 연결됨",
    bindSelected: "선택한 작성 차수 연결",
    linkedEvidence: "연결된 증빙:",
    registerPdfFirst: "먼저 PDF 도면 보기에서 공식 PDF 원본을 등록하세요.",
    bindingList: "저장된 도면 PDF 연결",
    checking: "도면과 PDF 원본을 확인하고 있습니다…",
    saved: "PDF 도면 연결을 저장했습니다 · {{id}} · 파일 무결성 확인값 {{hash}}",
    loadFailed: "도면 PDF 연결 정보를 불러오지 못했습니다.",
    saveFailed: "도면 PDF 연결을 저장하지 못했습니다.",
    drawing: "도면",
    pdf: "PDF",
    version: "작성 차수 ",
  },
  vi: {
    title: "Liên kết PDF bản vẽ",
    description: "Chức năng quản trị minh họa. Liên kết phiên bản bản vẽ đã chọn với bản PDF gốc trong chỉ mục kỹ thuật; không thay đổi trạng thái phê duyệt chính thức.",
    adminOnly: "Chỉ tài khoản quản trị viên của dự án thử nghiệm mới có thể tạo liên kết.",
    drawingVersion: "Phiên bản bản vẽ",
    selectDrawing: "Chọn phiên bản bản vẽ cần liên kết",
    revision: "Bản sửa đổi",
    pdfOriginal: "PDF gốc",
    selectPdf: "Chọn chứng cứ PDF cần liên kết",
    alreadyBound: "Phiên bản bản vẽ này đã được liên kết với PDF",
    bindSelected: "Liên kết phiên bản đã chọn",
    linkedEvidence: "Chứng cứ đã liên kết:",
    registerPdfFirst: "Trước tiên, hãy đăng ký PDF gốc trong phần xem bản vẽ PDF.",
    bindingList: "Các liên kết PDF bản vẽ đã lưu",
    checking: "Đang kiểm tra bản vẽ và PDF gốc…",
    saved: "Đã lưu liên kết PDF bản vẽ · {{id}} · SHA-256 {{hash}}",
    loadFailed: "Không thể tải thông tin liên kết PDF bản vẽ.",
    saveFailed: "Không thể lưu liên kết PDF bản vẽ.",
    drawing: "Bản vẽ",
    pdf: "PDF",
    version: "v",
  },
  en: {
    title: "Drawing PDF binding",
    description: "Example administrator feature. Links the selected drawing version to a registered original PDF in the technical index without changing official approval status.",
    adminOnly: "Only the demo project administrator account can create a binding.",
    drawingVersion: "Drawing version",
    selectDrawing: "Select a drawing version to bind",
    revision: "Revision",
    pdfOriginal: "Original PDF",
    selectPdf: "Select PDF evidence to bind",
    alreadyBound: "This drawing version is already linked to a PDF",
    bindSelected: "Bind selected version",
    linkedEvidence: "Linked evidence:",
    registerPdfFirst: "Register the original PDF in the PDF drawing viewer first.",
    bindingList: "Saved drawing PDF bindings",
    checking: "Checking the drawing and original PDF…",
    saved: "Saved the drawing PDF binding · {{id}} · SHA-256 {{hash}}",
    loadFailed: "Could not load drawing PDF binding information.",
    saveFailed: "Could not save the drawing PDF binding.",
    drawing: "Drawing",
    pdf: "PDF",
    version: "v",
  },
};

function exactRef(kind: string, record: RecordDTO): DomainRef {
  return { objectType: kind, objectId: record.id, version: record.version };
}

function refKey(ref: DomainRef) {
  return `${ref.objectType}:${ref.objectId}:${ref.version}`;
}

function errorMessage(cause: unknown, fallback: "loadFailed" | "saveFailed"): Message {
  if (cause instanceof ApiError) return { key: "reason", values: { code: cause.detail.code } };
  return { key: fallback };
}

export function DrawingPdfBindingPanel({ client, workspace, onChanged }: Props) {
  const { i18n } = useTranslation();
  const language: Locale = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);
  const tx = (key: string, values?: Record<string, string>) => {
    let result = copy[language][key] ?? copy.en[key] ?? key;
    for (const [name, value] of Object.entries(values ?? {})) {
      result = result.replaceAll(`{{${name}}}`, value);
    }
    return result;
  };
  const [drawings, setDrawings] = useState<DrawingRevisionOption[]>([]);
  const [bindings, setBindings] = useState<DrawingPdfBinding[]>([]);
  const [drawingKey, setDrawingKey] = useState("");
  const [evidenceKey, setEvidenceKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [error, setError] = useState<Message | null>(null);
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
      setError(null);
    } catch (cause) {
      if (isCurrent()) {
        setDrawings([]);
        setBindings([]);
        setDrawingKey("");
        setEvidenceKey("");
        setError(errorMessage(cause, "loadFailed"));
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
    setMessage(null);
    setError(null);
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
    setError(null);
    setMessage({ key: "checking" });
    try {
      const binding = await createDrawingPdfBinding(client, workspace.context.projectId,
        selectedDrawing.domainRef, exactRef("Evidence", selectedEvidence));
      if (!isCurrent()) return;
      setMessage({ key: "saved", values: { id: binding.id, hash: binding.fileHash } });
      await refresh();
      if (isCurrent()) await onChanged?.();
    } catch (cause) {
      if (isCurrent()) {
        setError(errorMessage(cause, "saveFailed"));
        setMessage(null);
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  function renderError(value: Message) {
    return value.key === "reason" ? reasonLabel(value.values?.code) : tx(value.key, value.values);
  }

  return <section className="rounded-lg border bg-card p-4" aria-labelledby="drawing-pdf-binding-title">
    <h2 id="drawing-pdf-binding-title" className="text-lg font-semibold">{tx("title")}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{tx("description")}</p>
    {!isDemoAdmin ? <p className="mt-3 text-sm text-muted-foreground">{tx("adminOnly")}</p> : <>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium">{tx("drawingVersion")}
          <select className="mt-1 block w-full rounded-md border bg-background px-3 py-2" value={drawingKey}
            disabled={busy || !scopeReady} onChange={(event) => setDrawingKey(event.target.value)}>
            <option value="">{tx("selectDrawing")}</option>
            {currentDrawings.map((drawing) => <option key={refKey(drawing.domainRef)} value={refKey(drawing.domainRef)}>
              {drawing.title ?? drawing.domainRef.objectId} · {tx("revision")} {drawing.revision ?? "—"} · {recordVersionLabel(drawing.domainRef.version)}
            </option>)}
          </select>
        </label>
        <label className="text-sm font-medium">{tx("pdfOriginal")}
          <select className="mt-1 block w-full rounded-md border bg-background px-3 py-2" value={evidenceKey}
            disabled={busy || !scopeReady} onChange={(event) => setEvidenceKey(event.target.value)}>
            <option value="">{tx("selectPdf")}</option>
            {pdfEvidence.map((record) => <option key={record.id} value={refKey(exactRef("Evidence", record))}>
              {String(record.metadata?.name ?? record.id)} · {record.id} · {recordVersionLabel(record.version)}
            </option>)}
          </select>
        </label>
      </div>
      <button type="button" className="mt-3 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
        disabled={!scopeReady || busy || !selectedDrawing || !selectedEvidence || Boolean(alreadyBound)} onClick={() => void bind()}>
        {alreadyBound ? tx("alreadyBound") : tx("bindSelected")}
      </button>
      {alreadyBound && <p className="mt-2 break-all text-sm text-muted-foreground">
        {tx("linkedEvidence")} {alreadyBound.evidenceRef.objectId} · SHA-256 {alreadyBound.fileHash}
      </p>}
      {!pdfEvidence.length && <p className="mt-2 text-sm text-muted-foreground">{tx("registerPdfFirst")}</p>}
    </>}
    {scopeReady && message && <p className="mt-3 break-all text-sm" role="status">{tx(message.key, message.values)}</p>}
    {scopeReady && error && <p className="mt-3 text-sm text-destructive" role="alert">{renderError(error)}</p>}
    {scopeReady && <ul className="mt-4 space-y-2 text-sm" aria-label={tx("bindingList")}>
      {currentBindings.map((binding) => <li key={binding.id} className="break-all rounded border p-2">
        {tx("drawing")} {binding.drawingRef.objectId} · {recordVersionLabel(binding.drawingRef.version)} → {tx("pdf")} {binding.evidenceRef.objectId} · SHA-256 {binding.fileHash}
      </li>)}
    </ul>}
  </section>;
}
