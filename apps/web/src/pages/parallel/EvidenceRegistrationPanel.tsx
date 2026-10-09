import { useCallback, useEffect, useMemo, useState } from "react";
import type { Workspace, WorkItem } from "../../data/ui-contract";
import type { SupervisionClient } from "../../data/supervision-client";
import { ApiError } from "../../data/supervision-client";
import type { RecordDTO } from "../../data/ui-contract";
import {
  currentEvidenceActor,
  EVIDENCE_UPLOAD_LIMIT_BYTES,
  evidenceChecksum,
  sniffEvidenceMime,
  uploadOfficialEvidence,
} from "../../data/evidence-registration-data";
import { reasonLabel } from "../../labels";

type QuarantineItem = { key: string; byteCount: number; sha256: string; contentType: string; status: string };
type LabelKey =
  | "title" | "description" | "uploadNew" | "quarantineTitle" | "quarantineSelect"
  | "filename" | "filenameAria" | "registerOfficial" | "noQuarantine" | "existingOfficial" | "evidenceToUse"
  | "selectedWork" | "selectedEvidence" | "fileChecking" | "quarantineChecking" | "uploading"
  | "registered" | "registeredSha" | "fileTooLarge" | "unsupportedFile" | "mimeMismatch" | "errorGeneric"
  | "fileBytes";

const text: Record<"en" | "ko" | "vi", Record<LabelKey, string>> = {
  en: {
    title: "Register evidence",
    description: "Register an image or PDF original, then select its evidence ID in the work command that uses it.",
    uploadNew: "Register a new image or PDF",
    quarantineTitle: "Register quarantined original",
    quarantineSelect: "Select quarantined file",
    filename: "File name",
    filenameAria: "File name to register",
    registerOfficial: "Register official evidence",
    noQuarantine: "There are no quarantined originals available to this account.",
    existingOfficial: "Select existing official evidence",
    evidenceToUse: "Select evidence for the work command",
    selectedWork: "Selected work",
    selectedEvidence: "Official evidence selected",
    fileChecking: "Checking file contents…",
    quarantineChecking: "Checking quarantined original…",
    uploading: "Uploading",
    registered: "Official evidence registered",
    registeredSha: "SHA-256",
    fileTooLarge: "Choose an image or PDF file that is no larger than 20 MiB.",
    unsupportedFile: "This file is not a supported image or PDF format.",
    mimeMismatch: "The file type shown by the browser does not match its contents.",
    errorGeneric: "The evidence request could not be completed. Check the file and connection, then try again.",
    fileBytes: "bytes",
  },
  ko: {
    title: "증빙 등록",
    description: "이미지 또는 PDF 원본을 등록한 뒤, 사용할 작업 명령에서 증빙 ID를 직접 선택하세요.",
    uploadNew: "새 이미지 또는 PDF 등록",
    quarantineTitle: "격리된 원본 등록",
    quarantineSelect: "격리된 파일 선택",
    filename: "파일 이름",
    filenameAria: "등록할 파일 이름",
    registerOfficial: "공식 증빙 등록",
    noQuarantine: "현재 계정에서 등록할 수 있는 격리 원본이 없습니다.",
    existingOfficial: "기존 공식 증빙 선택",
    evidenceToUse: "작업 명령에 사용할 증빙 선택",
    selectedWork: "선택된 작업",
    selectedEvidence: "저장된 공식 증빙 선택됨",
    fileChecking: "파일 내용을 확인하고 있습니다…",
    quarantineChecking: "격리된 원본을 확인하고 있습니다…",
    uploading: "업로드",
    registered: "공식 증빙 등록 완료",
    registeredSha: "SHA-256",
    fileTooLarge: "20 MiB 이하의 이미지 또는 PDF 파일을 선택하세요.",
    unsupportedFile: "지원하는 이미지 또는 PDF 형식이 아닙니다.",
    mimeMismatch: "파일 형식 표시와 실제 내용이 일치하지 않습니다.",
    errorGeneric: "증빙 요청을 완료할 수 없습니다. 파일과 연결을 확인한 뒤 다시 시도하세요.",
    fileBytes: "바이트",
  },
  vi: {
    title: "Đăng ký minh chứng",
    description: "Đăng ký tệp ảnh hoặc PDF gốc, sau đó chọn mã minh chứng trong lệnh công việc cần dùng.",
    uploadNew: "Đăng ký ảnh hoặc PDF mới",
    quarantineTitle: "Đăng ký tệp gốc bị cách ly",
    quarantineSelect: "Chọn tệp bị cách ly",
    filename: "Tên tệp",
    filenameAria: "Tên tệp đăng ký",
    registerOfficial: "Đăng ký minh chứng chính thức",
    noQuarantine: "Tài khoản này không có tệp gốc bị cách ly nào để đăng ký.",
    existingOfficial: "Chọn minh chứng chính thức hiện có",
    evidenceToUse: "Chọn minh chứng cho lệnh công việc",
    selectedWork: "Công việc đã chọn",
    selectedEvidence: "Đã chọn minh chứng chính thức",
    fileChecking: "Đang kiểm tra nội dung tệp…",
    quarantineChecking: "Đang kiểm tra tệp gốc bị cách ly…",
    uploading: "Đang tải lên",
    registered: "Đã đăng ký minh chứng chính thức",
    registeredSha: "SHA-256",
    fileTooLarge: "Chọn tệp ảnh hoặc PDF có dung lượng không quá 20 MiB.",
    unsupportedFile: "Định dạng tệp này không được hỗ trợ. Chỉ hỗ trợ ảnh hoặc PDF.",
    mimeMismatch: "Loại tệp trình duyệt hiển thị không khớp với nội dung tệp.",
    errorGeneric: "Không thể hoàn tất yêu cầu minh chứng. Hãy kiểm tra tệp và kết nối rồi thử lại.",
    fileBytes: "byte",
  },
};

class EvidencePanelError extends Error {
  readonly label: "fileTooLarge" | "unsupportedFile" | "mimeMismatch";
  constructor(label: "fileTooLarge" | "unsupportedFile" | "mimeMismatch") {
    super(label);
    this.label = label;
  }
}

function localizedError(cause: unknown, labels: Record<LabelKey, string>): string {
  if (cause instanceof EvidencePanelError) return labels[cause.label];
  if (cause instanceof ApiError) return reasonLabel(cause.detail.code);
  return labels.errorGeneric;
}

export function EvidenceRegistrationPanel({
  client, workspace, selectedWork, onChanged, onEvidenceSelected,
}: {
  client: SupervisionClient;
  workspace: Workspace;
  selectedWork?: WorkItem | null;
  onChanged?: () => Promise<void> | void;
  onEvidenceSelected?: (evidenceId: string) => void;
}) {
  const localeTag = typeof document === "undefined" ? "en" : document.documentElement.lang || "en";
  const locale = localeTag.slice(0, 2);
  const labels = text[locale === "ko" || locale === "vi" ? locale : "en"];
  const numberLocale = locale === "ko" || locale === "vi" ? locale : "en";
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [registerFileName, setRegisterFileName] = useState("");
  const [selectedOfficialId, setSelectedOfficialId] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [quarantineActorKey, setQuarantineActorKey] = useState("");
  const actor = client.session?.actor ?? null;
  const actorKey = actor ? `${actor.partyId}:${actor.roleAssignmentId}` : "";
  const officialEvidence = useMemo(() => workspace.items
    .filter((item) => item.machine === "evidence")
    .map((item) => item.record), [workspace.items]);

  const loadQuarantine = useCallback(async () => {
    if (!client.session) { setQuarantine([]); setSelectedKey(""); return; }
    const requestActorKey = `${client.session.actor.partyId}:${client.session.actor.roleAssignmentId}`;
    try {
      const result = await client.request<{ items: QuarantineItem[] }>(
        client.path("/parallel/evidence-quarantine"),
      );
      if (!client.session || `${client.session.actor.partyId}:${client.session.actor.roleAssignmentId}` !== requestActorKey) return;
      const available = result.items.filter((item) => item.status === "quarantined");
      setQuarantine(available);
      setQuarantineActorKey(requestActorKey);
      setSelectedKey((current) => available.some((item) => item.key === current) ? current : "");
    } catch (cause) {
      setError(localizedError(cause, labels));
    }
  }, [client, labels]);

  useEffect(() => {
    setQuarantine([]); setSelectedKey(""); setQuarantineActorKey(""); setSelectedOfficialId("");
    void loadQuarantine();
  }, [loadQuarantine, actorKey]);

  function registrationStatus(record: RecordDTO) {
    return `${labels.registered} · ${record.id} · ${labels.registeredSha} ${record.fileHash}`;
  }

  async function uploadOfficial(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setProgress(labels.fileChecking);
    try {
      if (file.size === 0 || file.size > EVIDENCE_UPLOAD_LIMIT_BYTES) throw new EvidencePanelError("fileTooLarge");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = sniffEvidenceMime(bytes);
      if (!mime) throw new EvidencePanelError("unsupportedFile");
      if (file.type && file.type !== mime) throw new EvidencePanelError("mimeMismatch");
      const record = await uploadOfficialEvidence(client, bytes, {
        name: file.name, mime, hash: await evidenceChecksum(bytes), scope: workspace.context.scope,
      }, (offset, total) => setProgress(`${labels.uploading} ${Math.round((offset / total) * 100)}%`));
      setSelectedOfficialId(record.id);
      setProgress(registrationStatus(record));
      onEvidenceSelected?.(record.id);
      await onChanged?.();
      await loadQuarantine();
    } catch (cause) {
      setError(localizedError(cause, labels));
      setProgress("");
    } finally {
      setBusy(false);
    }
  }

  async function registerQuarantine() {
    const item = quarantine.find((entry) => entry.key === selectedKey);
    if (!item || !client.session || !quarantine.some((entry) => entry.key === selectedKey)) return;
    const currentActor = currentEvidenceActor(client);
    setBusy(true);
    setError("");
    setProgress(labels.quarantineChecking);
    try {
      const record = await client.request<RecordDTO>(
        client.path("/parallel/evidence-quarantine/register"),
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            roleAssignmentId: currentActor.roleAssignmentId,
            quarantineKey: item.key,
            sha256: item.sha256,
            sourcePartyId: currentActor.partyId,
            fileName: registerFileName.trim(),
            discipline: workspace.context.scope.discipline,
            packageId: workspace.context.scope.packageId,
            locationId: workspace.context.scope.locationId,
          }),
        },
      );
      setSelectedOfficialId(record.id);
      setProgress(registrationStatus(record));
      onEvidenceSelected?.(record.id);
      await onChanged?.();
      await loadQuarantine();
    } catch (cause) {
      setError(localizedError(cause, labels));
      setProgress("");
    } finally {
      setBusy(false);
    }
  }

  function chooseOfficial(id: string) {
    setSelectedOfficialId(id);
    if (id) onEvidenceSelected?.(id);
  }

  return (
    <section className="rounded-lg border bg-card p-4" aria-labelledby="evidence-registration-title">
      <h2 id="evidence-registration-title" className="text-lg font-semibold">{labels.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{labels.description}</p>

      <label className="mt-4 block text-sm font-medium" htmlFor="official-evidence-file">{labels.uploadNew}</label>
      <input id="official-evidence-file" className="mt-2 block w-full text-sm" type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
        disabled={busy} onChange={(event) => void uploadOfficial(event.target.files?.[0])} />

      <div className="mt-5 border-t pt-4">
        <h3 className="font-medium">{labels.quarantineTitle}</h3>
        {quarantine.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <select className="min-w-64 rounded-md border bg-background px-3 py-2 text-sm"
              aria-label={labels.quarantineSelect}
              value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)} disabled={busy || quarantineActorKey !== actorKey}>
              <option value="">{labels.quarantineSelect}</option>
              {quarantine.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.key.split("/").slice(-2, -1)[0]} · {item.contentType} · {new Intl.NumberFormat(numberLocale).format(item.byteCount)} {labels.fileBytes}
                </option>
              ))}
            </select>
            <input className="rounded-md border bg-background px-3 py-2 text-sm" aria-label={labels.filenameAria}
              placeholder={labels.filename} value={registerFileName} onChange={(event) => setRegisterFileName(event.target.value)} disabled={busy} />
            <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
              disabled={busy || quarantineActorKey !== actorKey || !selectedKey || !quarantine.some((item) => item.key === selectedKey) || !registerFileName.trim()} onClick={() => void registerQuarantine()}>
              {labels.registerOfficial}
            </button>
          </div>
        ) : <p className="mt-2 text-sm text-muted-foreground">{labels.noQuarantine}</p>}
      </div>

      <div className="mt-5 border-t pt-4">
        <label className="block text-sm font-medium" htmlFor="existing-official-evidence">{labels.existingOfficial}</label>
        <select id="existing-official-evidence" className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
          aria-label={labels.evidenceToUse}
          value={selectedOfficialId} onChange={(event) => chooseOfficial(event.target.value)}>
          <option value="">{labels.evidenceToUse}</option>
          {officialEvidence.map((record) => (
            <option key={record.id} value={record.id}>
              {String(record.metadata?.name ?? record.id)} · {record.id} · {record.fileHash}
            </option>
          ))}
        </select>
        {selectedWork && <p className="mt-2 text-sm text-muted-foreground">
          {labels.selectedWork}: {selectedWork.machine} · {selectedWork.record.id}. {labels.evidenceToUse}.
        </p>}
        {selectedOfficialId && <p className="mt-2 break-all text-sm" role="status">
          {labels.selectedEvidence}: {selectedOfficialId}
        </p>}
      </div>
      {progress && <p className="mt-3 break-all text-sm" role="status">{progress}</p>}
      {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
    </section>
  );
}
