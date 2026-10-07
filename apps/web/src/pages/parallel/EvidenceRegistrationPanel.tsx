import { useCallback, useEffect, useMemo, useState } from "react";
import type { Workspace, WorkItem } from "../../data/ui-contract";
import type { SupervisionClient } from "../../data/supervision-client";
import type { RecordDTO } from "../../data/ui-contract";

const MAX_BYTES = 20 * 1024 * 1024;
type QuarantineItem = { key: string; byteCount: number; sha256: string; contentType: string; status: string };

function sniffEvidence(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10") return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0, 6)))) return "image/gif";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

async function checksum(bytes: Uint8Array) {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", source)))
    .map((value) => value.toString(16).padStart(2, "0")).join("");
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
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [registerFileName, setRegisterFileName] = useState("");
  const [selectedOfficialId, setSelectedOfficialId] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const officialEvidence = useMemo(() => workspace.items
    .filter((item) => item.machine === "evidence")
    .map((item) => item.record), [workspace.items]);

  const loadQuarantine = useCallback(async () => {
    if (!client.session) return;
    try {
      const result = await client.request<{ items: QuarantineItem[] }>(
        client.path("/parallel/evidence-quarantine"),
      );
      setQuarantine(result.items.filter((item) => item.status === "quarantined"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [client]);

  useEffect(() => { void loadQuarantine(); }, [loadQuarantine]);

  async function uploadOfficial(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setProgress("Checking file bytes…");
    try {
      if (file.size === 0 || file.size > MAX_BYTES) throw new Error("Choose an image or PDF under 20 MiB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = sniffEvidence(bytes);
      if (!mime) throw new Error("The file bytes are not a supported image or PDF.");
      if (file.type && file.type !== mime) throw new Error("The file type label does not match its bytes.");
      const record = await client.upload(bytes, {
        name: file.name, mime, hash: await checksum(bytes),
        scope: workspace.context.scope, sourcePartyId: client.session!.actor.partyId,
      }, (offset, total) => setProgress(`Uploading ${Math.round((offset / total) * 100)}%`));
      setSelectedOfficialId(record.id);
      setProgress(`Official evidence registered · ${record.id} · SHA-256 ${record.fileHash}`);
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
    if (!item || !client.session) return;
    setBusy(true);
    setError("");
    setProgress("Verifying quarantined original…");
    try {
      const record = await client.request<RecordDTO>(
        client.path("/parallel/evidence-quarantine/register"),
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            roleAssignmentId: client.session.actor.roleAssignmentId,
            quarantineKey: item.key,
            sha256: item.sha256,
            sourcePartyId: client.session.actor.partyId,
            fileName: registerFileName.trim(),
            discipline: workspace.context.scope.discipline,
            packageId: workspace.context.scope.packageId,
            locationId: workspace.context.scope.locationId,
          }),
        },
      );
      setSelectedOfficialId(record.id);
      setProgress(`Official evidence registered · ${record.id} · SHA-256 ${record.fileHash}`);
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
      <h2 id="evidence-registration-title" className="text-lg font-semibold">Evidence registration</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Register image or PDF originals, then explicitly select an evidence ID in the work command that needs it.
      </p>

      <label className="mt-4 block text-sm font-medium" htmlFor="official-evidence-file">Register a new image or PDF</label>
      <input id="official-evidence-file" className="mt-2 block w-full text-sm" type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
        disabled={busy} onChange={(event) => void uploadOfficial(event.target.files?.[0])} />

      <div className="mt-5 border-t pt-4">
        <h3 className="font-medium">Register an existing quarantined original</h3>
        {quarantine.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <select className="min-w-64 rounded-md border bg-background px-3 py-2 text-sm"
              value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)} disabled={busy}>
              <option value="">Choose a quarantined file</option>
              {quarantine.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.key.split("/").slice(-2, -1)[0]} · {item.contentType} · {item.byteCount.toLocaleString()} bytes
                </option>
              ))}
            </select>
            <input className="rounded-md border bg-background px-3 py-2 text-sm" aria-label="Registered file name"
              placeholder="File name" value={registerFileName} onChange={(event) => setRegisterFileName(event.target.value)} disabled={busy} />
            <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
              disabled={busy || !selectedKey || !registerFileName.trim()} onClick={() => void registerQuarantine()}>
              Register official evidence
            </button>
          </div>
        ) : <p className="mt-2 text-sm text-muted-foreground">No quarantined originals are available for this account.</p>}
      </div>

      <div className="mt-5 border-t pt-4">
        <label className="block text-sm font-medium" htmlFor="existing-official-evidence">Select existing official evidence</label>
        <select id="existing-official-evidence" className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={selectedOfficialId} onChange={(event) => chooseOfficial(event.target.value)}>
          <option value="">Choose evidence for a work command</option>
          {officialEvidence.map((record) => (
            <option key={record.id} value={record.id}>
              {String(record.metadata?.name ?? record.id)} · {record.id} · {record.fileHash}
            </option>
          ))}
        </select>
        {selectedWork && <p className="mt-2 text-sm text-muted-foreground">
          Selected work: {selectedWork.machine} · {selectedWork.record.id}. Use the chosen ID in that work item's next command evidence selection.
        </p>}
        {selectedOfficialId && <p className="mt-2 break-all text-sm" role="status">
          Persisted official record selected: {selectedOfficialId}
        </p>}
      </div>
      {progress && <p className="mt-3 break-all text-sm" role="status">{progress}</p>}
      {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
    </section>
  );
}
