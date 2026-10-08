import { useCallback, useEffect, useMemo, useState } from "react";
import type { Workspace, WorkItem } from "../../data/ui-contract";
import type { SupervisionClient } from "../../data/supervision-client";
import type { RecordDTO } from "../../data/ui-contract";
import {
  currentEvidenceActor,
  EVIDENCE_UPLOAD_LIMIT_BYTES,
  evidenceChecksum,
  sniffEvidenceMime,
  uploadOfficialEvidence,
} from "../../data/evidence-registration-data";

type QuarantineItem = { key: string; byteCount: number; sha256: string; contentType: string; status: string };

export function EvidenceRegistrationPanel({
  client, workspace, selectedWork, onChanged, onEvidenceSelected,
}: {
  client: SupervisionClient;
  workspace: Workspace;
  selectedWork?: WorkItem | null;
  onChanged?: () => Promise<void> | void;
  onEvidenceSelected?: (evidenceId: string) => void;
}) {
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
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [client]);

  useEffect(() => { setQuarantine([]); setSelectedKey(""); setQuarantineActorKey(""); setSelectedOfficialId(""); void loadQuarantine(); }, [loadQuarantine, actorKey]);

  async function uploadOfficial(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setProgress("파일 내용을 확인하고 있습니다…");
    try {
      if (file.size === 0 || file.size > EVIDENCE_UPLOAD_LIMIT_BYTES) throw new Error("20 MiB 이하의 이미지 또는 PDF 파일을 선택하세요.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = sniffEvidenceMime(bytes);
      if (!mime) throw new Error("지원하는 이미지 또는 PDF 형식이 아닙니다.");
      if (file.type && file.type !== mime) throw new Error("파일 형식 표시와 실제 내용이 일치하지 않습니다.");
      const record = await uploadOfficialEvidence(client, bytes, {
        name: file.name, mime, hash: await evidenceChecksum(bytes), scope: workspace.context.scope,
      }, (offset, total) => setProgress(`업로드 ${Math.round((offset / total) * 100)}%`));
      setSelectedOfficialId(record.id);
      setProgress(`공식 증빙 등록 완료 · ${record.id} · SHA-256 ${record.fileHash}`);
      onEvidenceSelected?.(record.id);
      await onChanged?.();
      await loadQuarantine();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
    setProgress("격리된 원본을 확인하고 있습니다…");
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
      setProgress(`공식 증빙 등록 완료 · ${record.id} · SHA-256 ${record.fileHash}`);
      onEvidenceSelected?.(record.id);
      await onChanged?.();
      await loadQuarantine();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
      <h2 id="evidence-registration-title" className="text-lg font-semibold">증빙 등록</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        이미지 또는 PDF 원본을 등록한 뒤, 사용할 작업 명령에서 증빙 ID를 직접 선택하세요.
      </p>

      <label className="mt-4 block text-sm font-medium" htmlFor="official-evidence-file">새 이미지 또는 PDF 등록</label>
      <input id="official-evidence-file" className="mt-2 block w-full text-sm" type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
        disabled={busy} onChange={(event) => void uploadOfficial(event.target.files?.[0])} />

      <div className="mt-5 border-t pt-4">
        <h3 className="font-medium">격리된 원본 등록</h3>
        {quarantine.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <select className="min-w-64 rounded-md border bg-background px-3 py-2 text-sm"
              value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)} disabled={busy || quarantineActorKey !== actorKey}>
              <option value="">격리된 파일 선택</option>
              {quarantine.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.key.split("/").slice(-2, -1)[0]} · {item.contentType} · {item.byteCount.toLocaleString()}바이트
                </option>
              ))}
            </select>
            <input className="rounded-md border bg-background px-3 py-2 text-sm" aria-label="등록할 파일 이름"
              placeholder="파일 이름" value={registerFileName} onChange={(event) => setRegisterFileName(event.target.value)} disabled={busy} />
            <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
              disabled={busy || quarantineActorKey !== actorKey || !selectedKey || !quarantine.some((item) => item.key === selectedKey) || !registerFileName.trim()} onClick={() => void registerQuarantine()}>
              공식 증빙 등록
            </button>
          </div>
        ) : <p className="mt-2 text-sm text-muted-foreground">현재 계정에서 등록할 수 있는 격리 원본이 없습니다.</p>}
      </div>

      <div className="mt-5 border-t pt-4">
        <label className="block text-sm font-medium" htmlFor="existing-official-evidence">기존 공식 증빙 선택</label>
        <select id="existing-official-evidence" className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={selectedOfficialId} onChange={(event) => chooseOfficial(event.target.value)}>
          <option value="">작업 명령에 사용할 증빙 선택</option>
          {officialEvidence.map((record) => (
            <option key={record.id} value={record.id}>
              {String(record.metadata?.name ?? record.id)} · {record.id} · {record.fileHash}
            </option>
          ))}
        </select>
        {selectedWork && <p className="mt-2 text-sm text-muted-foreground">
          선택된 작업: {selectedWork.machine} · {selectedWork.record.id}. 다음 작업 명령에서 선택한 증빙 ID를 지정하세요.
        </p>}
        {selectedOfficialId && <p className="mt-2 break-all text-sm" role="status">
          저장된 공식 증빙 선택됨: {selectedOfficialId}
        </p>}
      </div>
      {progress && <p className="mt-3 break-all text-sm" role="status">{progress}</p>}
      {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
    </section>
  );
}
