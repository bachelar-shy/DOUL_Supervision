import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { RecordDTO, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { ApiError } from "../data/supervision-client";
import { signDocument, type DocumentSigningInput } from "../data/document-signing-client";
import { reasonLabel, states } from "../labels";

type LabelKey =
  | "title" | "help" | "document" | "selectDocument" | "noFinalDocuments" | "status" | "hash"
  | "roles" | "signerRole" | "selectRole" | "method" | "selectMethod" | "electronic"
  | "wetOriginal" | "originalEvidence" | "selectEvidence" | "noOriginalEvidence" | "authorityMissing"
  | "unavailable" | "finalRequired" | "alreadySigned" | "submit" | "signing" | "signed" | "refreshError" | "genericError";

const copy: Record<"ko" | "vi" | "en", Record<LabelKey, string>> = {
  ko: {
    title: "법적 서명",
    help: "최종 스냅샷의 정확한 출력 해시에 대해 서명을 요청합니다. 검증은 서버의 신뢰된 서명 검증기가 수행합니다.",
    document: "최종 문서 스냅샷", selectDocument: "문서 선택", noFinalDocuments: "서명할 최종 문서가 없습니다. 먼저 최종 문서를 생성하세요.",
    status: "상태", hash: "출력 해시", roles: "서버 필수 서명 역할", signerRole: "현재 서명 역할", selectRole: "역할 선택",
    method: "서명 방식", selectMethod: "방식 선택", electronic: "승인된 전자 서명", wetOriginal: "서명된 원본 실물 확인",
    originalEvidence: "읽을 수 있는 원본 증빙 파일", selectEvidence: "원본 증빙 선택", noOriginalEvidence: "선택 가능한 원본 증빙 파일이 없습니다.",
    authorityMissing: "현재 역할에는 법적 서명을 요청할 권한이 없습니다.", unavailable: "실제 HTTP 연결에서 온라인 상태일 때 서명을 요청할 수 있습니다.",
    finalRequired: "초안은 서명할 수 없습니다. 최종 스냅샷을 선택하세요.", alreadySigned: "이 스냅샷의 필수 서명이 완료되었습니다.",
    submit: "서명 검증 요청", signing: "서명 검증을 요청하는 중…", signed: "서명 검증기가 서명 기록을 반환했습니다.",
    refreshError: "서명 기록은 저장되었지만 작업공간을 갱신하지 못했습니다.", genericError: "서명 검증을 완료할 수 없습니다. 입력과 연결을 확인한 뒤 다시 시도하세요.",
  },
  vi: {
    title: "Chữ ký pháp lý",
    help: "Gửi yêu cầu ký gắn với mã băm đầu ra chính xác của ảnh chụp cuối cùng. Bộ xác minh chữ ký tin cậy ở máy chủ thực hiện việc xác minh.",
    document: "Ảnh chụp tài liệu cuối cùng", selectDocument: "Chọn tài liệu", noFinalDocuments: "Không có tài liệu cuối cùng để ký. Hãy tạo tài liệu cuối cùng trước.",
    status: "Trạng thái", hash: "Mã băm đầu ra", roles: "Vai trò ký bắt buộc do máy chủ cung cấp", signerRole: "Vai trò ký hiện tại", selectRole: "Chọn vai trò",
    method: "Phương thức ký", selectMethod: "Chọn phương thức", electronic: "Chữ ký điện tử được phê duyệt", wetOriginal: "Đã xác minh bản giấy có chữ ký",
    originalEvidence: "Tệp minh chứng gốc có thể đọc", selectEvidence: "Chọn minh chứng gốc", noOriginalEvidence: "Không có tệp minh chứng gốc nào khả dụng.",
    authorityMissing: "Vai trò hiện tại không có quyền yêu cầu chữ ký pháp lý.", unavailable: "Chỉ có thể yêu cầu ký khi trực tuyến và kết nối HTTP thực.",
    finalRequired: "Không thể ký bản nháp. Hãy chọn ảnh chụp cuối cùng.", alreadySigned: "Các chữ ký bắt buộc cho ảnh chụp này đã hoàn tất.",
    submit: "Yêu cầu xác minh chữ ký", signing: "Đang yêu cầu xác minh chữ ký…", signed: "Bộ xác minh đã trả về bản ghi chữ ký.",
    refreshError: "Bản ghi chữ ký đã được lưu nhưng không thể làm mới không gian làm việc.", genericError: "Không thể hoàn tất xác minh chữ ký. Hãy kiểm tra thông tin và kết nối rồi thử lại.",
  },
  en: {
    title: "Legal signature",
    help: "Request a signature bound to the exact output hash of a final snapshot. The server's trusted signature verifier performs verification.",
    document: "Final document snapshot", selectDocument: "Select document", noFinalDocuments: "There are no final documents to sign. Create a final document first.",
    status: "Status", hash: "Output hash", roles: "Required signer roles from server", signerRole: "Current signer role", selectRole: "Select role",
    method: "Signing method", selectMethod: "Select method", electronic: "Approved electronic signature", wetOriginal: "Verified signed paper original",
    originalEvidence: "Readable original evidence file", selectEvidence: "Select original evidence", noOriginalEvidence: "No readable original evidence files are available.",
    authorityMissing: "The current role is not authorized to request a legal signature.", unavailable: "Signing requests require an online, real HTTP connection.",
    finalRequired: "Draft snapshots cannot be signed. Select a final snapshot.", alreadySigned: "All required signatures for this snapshot are complete.",
    submit: "Request signature verification", signing: "Requesting signature verification…", signed: "The verifier returned a signature record.",
    refreshError: "The signature record was saved, but the workspace could not be refreshed.", genericError: "Signature verification could not be completed. Check the inputs and connection, then try again.",
  },
};

type Language = "ko" | "vi" | "en";
function activeLanguage(): Language {
  const language = typeof document === "undefined" ? "en" : document.documentElement.lang.slice(0, 2);
  return language === "ko" || language === "vi" ? language : "en";
}
const signerRoleLabels: Record<string, Record<Language, string>> = {
  owner_side_supervisor: { ko: "발주자 측 감리자", vi: "Giám sát phía chủ đầu tư", en: "Owner side supervisor" },
  discipline_supervisor: { ko: "분야별 감리자", vi: "Giám sát chuyên ngành", en: "Discipline supervisor" },
  chief_supervisor: { ko: "총괄 감리자", vi: "Giám sát trưởng", en: "Chief supervisor" },
  chief_or_supervisor: { ko: "총괄 또는 분야별 감리자", vi: "Giám sát trưởng hoặc giám sát chuyên ngành", en: "Chief or discipline supervisor" },
  contractor_technical_lead: { ko: "시공사 기술책임자", vi: "Phụ trách kỹ thuật nhà thầu", en: "Contractor technical lead" },
  subcontractor_technical_lead: { ko: "하도급사 기술책임자", vi: "Phụ trách kỹ thuật nhà thầu phụ", en: "Subcontractor technical lead" },
  contractor_lead: { ko: "시공사 책임자", vi: "Đại diện nhà thầu", en: "Contractor lead" },
  investor: { ko: "투자자", vi: "Nhà đầu tư", en: "Investor" },
  assurance_reviewer: { ko: "보증 검토자", vi: "Người rà soát bảo đảm", en: "Assurance reviewer" },
  contract_reviewer: { ko: "계약 검토자", vi: "Người rà soát hợp đồng", en: "Contract reviewer" },
  document_reviewer: { ko: "문서 검토자", vi: "Người rà soát tài liệu", en: "Document reviewer" },
  environment_reviewer: { ko: "환경 검토자", vi: "Người rà soát môi trường", en: "Environment reviewer" },
  fire_reviewer: { ko: "소방 검토자", vi: "Người rà soát phòng cháy chữa cháy", en: "Fire safety reviewer" },
  lesson_reviewer: { ko: "교훈 검토자", vi: "Người rà soát bài học kinh nghiệm", en: "Lessons reviewer" },
  permit_reviewer: { ko: "인허가 검토자", vi: "Người rà soát giấy phép", en: "Permit reviewer" },
  personnel_reviewer: { ko: "인력 검토자", vi: "Người rà soát nhân sự", en: "Personnel reviewer" },
  quantity_cost_reviewer: { ko: "수량·비용 검토자", vi: "Người rà soát khối lượng và chi phí", en: "Quantity and cost reviewer" },
  other_participant: { ko: "기타 참여자", vi: "Người tham gia khác", en: "Other participant" },
  other_legal_participant: { ko: "기타 법적 참여자", vi: "Bên tham gia pháp lý khác", en: "Other legal participant" },
  handover_from: { ko: "인계자", vi: "Bên bàn giao", en: "Handover from" },
  handover_to: { ko: "인수자", vi: "Bên tiếp nhận", en: "Handover to" },
  supervision_confirm: { ko: "감리 확인자", vi: "Người xác nhận giám sát", en: "Supervision confirmer" },
};
function signerRoleLabel(code: string, language: Language): string {
  return signerRoleLabels[code]?.[language] ?? code;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function rolesFromSnapshot(snapshot: RecordDTO): string[] {
  const roles = object(snapshot.sourcePayload).requiredSignatureRoles;
  return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === "string" && Boolean(role)) : [];
}
function isSignable(snapshot: RecordDTO): boolean {
  return snapshot.status === "final" || snapshot.status === "signed";
}
function errorMessage(cause: unknown, labels: Record<LabelKey, string>): string {
  return cause instanceof ApiError ? reasonLabel(cause.detail.code) : labels.genericError;
}
function titleOf(snapshot: RecordDTO) {
  const formId = typeof snapshot.formId === "string" ? snapshot.formId : "Document";
  return `${formId} · ${snapshot.id} · v${snapshot.version}`;
}

export function DocumentSigningPanel({
  client,
  workspace,
  online,
  snapshot,
  onSigned,
}: {
  client: SupervisionClient;
  workspace: Workspace;
  online: boolean;
  snapshot: RecordDTO | null;
  onSigned?: (signature: RecordDTO) => Promise<void> | void;
}) {
  const language = activeLanguage();
  const t = copy[language];
  const role = workspace.role as Workspace["role"] & { authorityCodes?: string[] };
  const canSign = online && client.kind === "http" && role.authorityCodes?.includes("sign_legal_document") === true;
  const hasSigningAuthority = role.authorityCodes?.includes("sign_legal_document") === true;
  const documents = useMemo(() => {
    const byId = new Map<string, RecordDTO>();
    for (const item of workspace.items) {
      if (item.machine === "document" && isSignable(item.record)) byId.set(item.record.id, item.record);
    }
    if (snapshot && isSignable(snapshot)) {
      const existing = byId.get(snapshot.id);
      if (!existing || snapshot.version > existing.version) byId.set(snapshot.id, snapshot);
    }
    return [...byId.values()];
  }, [workspace.items, snapshot]);
  const [documentId, setDocumentId] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [method, setMethod] = useState<DocumentSigningInput["method"] | "">("");
  const [originalFileId, setOriginalFileId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState<string[]>([]);
  const attempt = useRef<{ fingerprint: string; key: ReturnType<typeof crypto.randomUUID> } | null>(null);
  const selected = documents.find(item => item.id === documentId) ?? null;
  const requiredRoles = selected ? rolesFromSnapshot(selected) : [];
  const renderHash = selected && typeof selected.renderHash === "string" ? selected.renderHash : "";
  const originalEvidence = workspace.items.flatMap(item => {
    const record = item.record;
    return item.machine === "evidence" && record.sourceType === "original" && typeof record.fileId === "string" && record.fileId
      ? [{ fileId: record.fileId, evidenceId: record.id, label: String(record.metadata?.name ?? record.id) }]
      : [];
  });
  const input: DocumentSigningInput | null = method && roleCode && renderHash
    ? { documentHash: renderHash, roleCode, method, ...(method === "wet_original_verified" && originalFileId ? { originalFileId } : {}) }
    : null;
  const fingerprint = selected && input ? JSON.stringify({ documentId: selected.id, input }) : "";
  const alreadyCompleted = Boolean(fingerprint && completed.includes(fingerprint));

  useEffect(() => {
    setDocumentId(current => {
      if (snapshot && isSignable(snapshot)) return snapshot.id;
      return documents.some(item => item.id === current) ? current : documents[0]?.id ?? "";
    });
  }, [snapshot?.id, snapshot?.status, documents]);
  useEffect(() => {
    setRoleCode(""); setMethod(""); setOriginalFileId(""); setError(""); setMessage("");
  }, [documentId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSign || !selected || !input || !fingerprint || !requiredRoles.includes(roleCode) || !renderHash || selected.status === "signed") return;
    if (method === "wet_original_verified" && !originalEvidence.some(file => file.fileId === originalFileId)) return;
    if (alreadyCompleted || busy) return;
    setBusy(true); setError(""); setMessage("");
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
    const request = attempt.current;
    let signature: RecordDTO;
    try {
      signature = await signDocument(client, selected.id, input, request.key);
    } catch (cause) {
      setError(errorMessage(cause, t));
      setBusy(false);
      return;
    }
    attempt.current = null;
    setCompleted(current => [...current, fingerprint]);
    setMessage(`${t.signed} ${signature.id}`);
    setBusy(false);
    try { await onSigned?.(signature); }
    catch { setError(t.refreshError); }
  }

  const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";
  return (
    <section className="grid gap-3 rounded-lg border p-4" aria-label={t.title}>
      <div><h3 className="font-semibold">{t.title}</h3><p className="text-sm text-muted-foreground">{t.help}</p></div>
      {!hasSigningAuthority && <p className="text-sm text-muted-foreground">{t.authorityMissing}</p>}
      {hasSigningAuthority && (!online || client.kind !== "http") && <p className="text-sm text-muted-foreground">{t.unavailable}</p>}
      {!documents.length && <p className="text-sm text-muted-foreground">{t.noFinalDocuments}</p>}
      {!!documents.length && <form className="grid gap-3" onSubmit={event => void submit(event)}>
        <label className="grid gap-1 text-sm">{t.document}<select className={inputClass} aria-label={t.selectDocument} required value={documentId} onChange={event => setDocumentId(event.target.value)}>
          <option value="">{t.selectDocument}</option>
          {documents.map(item => <option key={item.id} value={item.id}>{titleOf(item)}</option>)}
        </select></label>
        {selected && <>
          <div className="grid gap-1 text-sm"><span>{t.status}</span><strong>{states[selected.status || ""] || selected.status || "—"}</strong></div>
          <div className="grid gap-1 text-sm"><span>{t.hash}</span><code className="break-all">{renderHash || "—"}</code></div>
          <div className="grid gap-1 text-sm"><span>{t.roles}</span><ul className="list-disc pl-5">{requiredRoles.map(roleValue => <li key={roleValue}>{signerRoleLabel(roleValue, language)}</li>)}</ul></div>
          {selected.status === "signed" && <p className="text-sm text-muted-foreground">{t.alreadySigned}</p>}
          <label className="grid gap-1 text-sm">{t.signerRole}<select className={inputClass} aria-label={t.signerRole} required value={roleCode} onChange={event => setRoleCode(event.target.value)} disabled={selected.status === "signed"}>
            <option value="">{t.selectRole}</option>{requiredRoles.map(roleValue => <option key={roleValue} value={roleValue}>{signerRoleLabel(roleValue, language)}</option>)}
          </select></label>
          <label className="grid gap-1 text-sm">{t.method}<select className={inputClass} aria-label={t.method} required value={method} onChange={event => { setMethod(event.target.value as typeof method); setOriginalFileId(""); }} disabled={selected.status === "signed"}>
            <option value="">{t.selectMethod}</option><option value="approved_e_signature">{t.electronic}</option><option value="wet_original_verified">{t.wetOriginal}</option>
          </select></label>
          {method === "wet_original_verified" && <label className="grid gap-1 text-sm">{t.originalEvidence}<select className={inputClass} aria-label={t.originalEvidence} required value={originalFileId} onChange={event => setOriginalFileId(event.target.value)}>
            <option value="">{t.selectEvidence}</option>{originalEvidence.map(file => <option key={file.fileId} value={file.fileId}>{file.label} · {file.evidenceId} · {file.fileId}</option>)}
          </select>{!originalEvidence.length && <small className="text-muted-foreground">{t.noOriginalEvidence}</small>}</label>}
          <button type="submit" className="rounded-md border px-3 py-2 text-sm" disabled={!canSign || busy || selected.status === "signed" || alreadyCompleted || !input || !requiredRoles.includes(roleCode) || (method === "wet_original_verified" && !originalFileId)}>
            {busy ? t.signing : t.submit}
          </button>
        </>}
      </form>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

export default DocumentSigningPanel;
