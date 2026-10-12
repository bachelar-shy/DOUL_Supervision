import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Workspace } from "../data/ui-contract";
import { ApiError, type SupervisionClient } from "../data/supervision-client";
import { reasonLabel } from "../labels";
import { CaptureTemplate } from "../ui/templates";
import { EvidenceViewer } from "../ui/catalog";
import { PageBoundary } from "./PageBoundary";
import { FloorPlan, Icon } from "./shared";
import { recordTitle } from "./record-utils";
import { EvidenceDetailPreview } from "./EvidenceDetailPreview";
import { evidenceMediaLabel, evidenceSourceLabel } from "./evidence-utils";
import { MediaAnalysisPanel } from "./MediaAnalysisPanel";
import { FieldRecordPanel } from "./FieldRecordPanel";

const MAX_BATCH_FILES = 20;
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;

interface LocalCapture {
  id: string;
  projectId: string;
  partyId: string;
  /** Role assignment at capture time, optional only for legacy stored data. */
  roleId?: string;
  name: string;
  mime: string;
  bytes: ArrayBuffer;
  hash: string;
  capturedAt: string;
}

async function captures(
  action: "list" | "put" | "delete",
  value?: LocalCapture | string,
): Promise<LocalCapture[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("doul-captures", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("originals", { keyPath: "id" });
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(
        "originals",
        action === "list" ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("originals");
      if (action === "put") store.put(value);
      if (action === "delete") store.delete(value as string);
      const all = store.getAll();
      tx.oncomplete = () => {
        resolve(all.result as LocalCapture[]);
        db.close();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

export function CapturePage({
  client,
  workspace,
  online,
  refresh,
  notify,
}: {
  client: SupervisionClient;
  workspace: Workspace;
  online: boolean;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<LocalCapture[]>([]);
  const scopeRole = client.session?.actor.roleAssignmentId || workspace.role.id;
  const autoKey = ["doul-capture-autosync-v1", workspace.project.id,
    client.session?.actor.partyId || "", scopeRole].join(":");
  const [autoPreference, setAutoPreference] = useState({ key: "", enabled: false });
  const autoEnabled = autoPreference.key === autoKey && autoPreference.enabled;
  const autoAttempted = useRef("");
  useEffect(() => {
    try {
      setAutoPreference({ key: autoKey, enabled: window.localStorage.getItem(autoKey) === "true" });
    } catch { setAutoPreference({ key: autoKey, enabled: false }); }
    autoAttempted.current = "";
  }, [autoKey]);
  function setAutoSync(enabled: boolean) {
    setAutoPreference({ key: autoKey, enabled });
    try { window.localStorage.setItem(autoKey, enabled ? "true" : "false"); }
    catch { setError("자동전송 설정을 저장할 수 없습니다. 현재 화면에서만 유지됩니다."); }
    if (enabled) autoAttempted.current = "";
  }
  const [progress, setProgress] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const uploadingRef = useRef(false);
  const [error, setError] = useState("");
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [recordFormOpen, setRecordFormOpen] = useState(false);
  const fileIntakeRef = useRef<HTMLInputElement>(null);

  const evidenceItems = workspace.items.filter((item) => item.machine === "evidence");
  const selectedEvidence =
    evidenceItems.find((item) => item.record.id === selectedEvidenceId)?.record ?? null;

  const load = useCallback(async () => {
    setPending(
      (await captures("list")).filter(
        (x) =>
          x.projectId === workspace.project.id &&
          x.partyId === client.session!.actor.partyId &&
          (!x.roleId || x.roleId === scopeRole),
      ),
    );
  }, [client, workspace.project.id, scopeRole]);

  useEffect(() => {
    let active = true;
    captures("list")
      .then((rows) => {
        if (active)
          setPending(
            rows.filter(
              (x) =>
                x.projectId === workspace.project.id &&
                x.partyId === client.session!.actor.partyId &&
                (!x.roleId || x.roleId === scopeRole),
            ),
          );
      })
      .catch((e) => {
        if (active) setError(e instanceof ApiError ? reasonLabel(e.detail.code) : reasonLabel());
      });
    return () => {
      active = false;
    };
  }, [client, workspace.project.id, scopeRole]);

  async function intakeFiles(files: File[]) {
    if (!files.length || batchBusy) return;
    if (files.length > MAX_BATCH_FILES) {
      setError(t("capture.batch.limit", { count: MAX_BATCH_FILES }));
      return;
    }
    setBatchBusy(true);
    setError("");
    let saved = 0;
    let duplicates = 0;
    let tooLarge = 0;
    try {
      const all = await captures("list");
      const knownHashes = new Set(all
        .filter(row => row.projectId === workspace.project.id && row.partyId === client.session!.actor.partyId)
        .map(row => row.hash));
      for (const file of files) {
        if (file.size > MAX_CAPTURE_BYTES) {
          tooLarge += 1;
          continue;
        }
        const bytes = await file.arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
          .map(value => value.toString(16).padStart(2, "0")).join("");
        if (knownHashes.has(hash)) {
          duplicates += 1;
          continue;
        }
        await captures("put", {
          id: crypto.randomUUID(),
          projectId: workspace.project.id,
          partyId: client.session!.actor.partyId,
          roleId: scopeRole,
          name: file.name,
          mime: file.type,
          bytes,
          hash,
          capturedAt: new Date().toISOString(),
        });
        knownHashes.add(hash);
        saved += 1;
      }
      await load();
      if (saved) notify(t("capture.batch.saved", { count: saved }));
      if (duplicates || tooLarge) setError(t("capture.batch.skipped", { duplicates, tooLarge }));
    } catch (e) {
      await load().catch(() => undefined);
      setError(e instanceof ApiError ? reasonLabel(e.detail.code) : t("capture.batch.storageError"));
    } finally {
      setBatchBusy(false);
    }
  }

  async function uploadCapture(p: LocalCapture, onProgress: (offset: number, total: number) => void) {
    if (p.projectId !== workspace.project.id || p.partyId !== client.session?.actor.partyId ||
        (p.roleId && p.roleId !== client.session?.actor.roleAssignmentId)) {
      throw new Error("CAPTURE_SCOPE_CHANGED");
    }
    await client.upload(new Uint8Array(p.bytes), {
      name: p.name,
      mime: p.mime,
      hash: p.hash,
      captureId: p.id,
      scope: workspace.context.scope,
      sourcePartyId: client.session!.actor.partyId,
      capturedAt: p.capturedAt,
    }, onProgress);
    // Never delete an offline original until the server confirms this upload.
    await captures("delete", p.id);
  }

  async function send(p: LocalCapture) {
    if (uploadingRef.current || !online) return;
    uploadingRef.current = true;
    setError("");
    setProgress(t("capture.progress.start"));
    try {
      await uploadCapture(p, (offset, total) => setProgress(Math.round((offset / total) * 100) + "%"));
      await load();
      await refresh();
      notify(t("capture.toast.registered"));
    } catch (e) {
      setError(e instanceof ApiError ? reasonLabel(e.detail.code) : reasonLabel());
    } finally {
      uploadingRef.current = false;
      setProgress("");
    }
  }

  async function sendAll(onlyCurrentRole = false) {
    const queue = onlyCurrentRole ? pending.filter(p => p.roleId === scopeRole) : pending;
    if (uploadingRef.current || !online || !queue.length) return;
    uploadingRef.current = true;
    setError("");
    let completed = 0;
    setProgress(t("capture.batch.sending", { current: 1, total: queue.length }));
    try {
      // Process sequentially to avoid saturated mobile links. Failed and
      // unattempted originals remain in IndexedDB for explicit retry.
      for (const p of queue) {
        setProgress(t("capture.batch.sending", { current: completed + 1, total: queue.length }));
        await uploadCapture(p, (offset, total) =>
          setProgress(t("capture.batch.progress", { current: completed + 1, total: queue.length, percent: Math.round((offset / total) * 100) })));
        completed += 1;
      }
      notify(t("capture.batch.sent", { count: completed }));
    } catch (e) {
      setError(t("capture.batch.partial", { completed, total: queue.length }) + " " +
        (e instanceof ApiError ? reasonLabel(e.detail.code) : reasonLabel()));
    } finally {
      await load().catch(() => undefined);
      if (completed) await refresh().catch(() => undefined);
      uploadingRef.current = false;
      setProgress("");
    }
  }

  // A single bounded attempt on each reconnection. On failure, originals
  // stay in IndexedDB and the user may manually retry. Legacy entries whose
  // role cannot be verified are never submitted automatically.
  useEffect(() => {
    if (!online) { autoAttempted.current = ""; return; }
    if (!autoEnabled || client.kind !== "http" || uploadingRef.current) return;
    const eligible = pending.some(p => p.roleId === scopeRole);
    if (!eligible || autoAttempted.current === autoKey) return;
    autoAttempted.current = autoKey;
    void sendAll(true);
  }, [online, autoEnabled, autoKey, pending, scopeRole, client.kind]);

  return (
    <PageBoundary name="capture">
      <CaptureTemplate>
        <div className="col-span-full flex flex-wrap items-center justify-between gap-3" data-ui-component="field-record-create-actions">
          <h2 className="text-xl font-semibold">{t("capture.quick.title")}</h2>
          <button type="button" className="secondary" style={{ minHeight: 44 }}
            onClick={() => fileIntakeRef.current?.click()}>{t("capture.quick.addFiles")}</button>
        </div>
        <div className="col-span-full">
          <FieldRecordPanel key={workspace.project.id + ":" + workspace.role.id}
            client={client} workspace={workspace} online={online}
            expanded={recordFormOpen} onToggle={setRecordFormOpen} />
        </div>
        <section className="panel">
          <div className="section-heading">
            <h2>{t("capture.intake.title")}</h2>
            <span>{t("capture.intake.original")}</span>
          </div>
          <div className="capture-drop">
            <Icon name="camera" />
            <h2>{t("capture.intake.headline")}</h2>
            <p>
              {t("capture.intake.help")}
            </p>
            <label className="primary upload-label">
              {t("capture.intake.chooseFile")}
              <input
                aria-label={t("capture.intake.fileAria")}
                ref={fileIntakeRef}
                type="file"
                multiple
                disabled={batchBusy || !!progress}
                accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) void intakeFiles(files);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="secondary upload-label">
              {t("capture.intake.camera")}
              <input
                aria-label={t("capture.intake.cameraAria")}
                type="file"
                accept="image/*"
                capture="environment"
                disabled={batchBusy || !!progress}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void intakeFiles([f]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          <div className="section-heading">
            <h3>{t("capture.pending.heading", { count: pending.length })}</h3>
            <button className="secondary" type="button"
              disabled={!online || batchBusy || !!progress || !pending.length || client.kind === "mock"}
              onClick={() => void sendAll()}>
              {t("capture.batch.sendAll")}
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm" style={{ marginBottom: 8 }}>
            <input type="checkbox" aria-label="연결 복구 시 미전송 자료 자동 전송"
              checked={autoEnabled} onChange={event => setAutoSync(event.target.checked)} />
            연결 복구 시 같은 프로젝트·담당자·역할의 미전송 자료를 1회 자동 전송
          </label>
          <p style={{ fontSize: 11, color: "#64748b" }}>
            기존 방식으로 보관된 자료는 직접 전송해야 합니다. 서버 확인 전까지 원본을 보존합니다.
          </p>
          {batchBusy && <p role="status">{t("capture.batch.preparing")}</p>}
          {pending.map((p) => (
            <div className="pending-row" key={p.id}>
              <div>
                <strong>{p.name}</strong>
                <small>
                  {(p.bytes.byteLength / 1024).toFixed(0)} KB · SHA256{" "}
                  {p.hash.slice(0, 12)}…
                </small>
              </div>
              <button
                className="secondary"
                disabled={!online || batchBusy || !!progress || client.kind === "mock"}
                onClick={() => void send(p)}
              >
                {t("capture.pending.send")}
              </button>
            </div>
          ))}
          {progress && <p role="status">{progress}</p>}
          {error && (
            <div role="alert" className="error-box">
              {error}
            </div>
          )}
        </section>

        <div className="right-stack">
          <section className="panel">
            <h2>{t("capture.context.title")}</h2>
            <div className="meta-grid">
              <div>
                <small>{t("capture.context.buildingFloor")}</small>
                <b>{t("capture.context.sampleBuildingFloor")}</b>
              </div>
              <div>
                <small>{t("capture.context.method")}</small>
                <b>{t("capture.context.manual")}</b>
              </div>
            </div>
            <FloorPlan />
            <div className="notice">
              {t("capture.context.notice")}
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <h2>{t("capture.evidence.title")}</h2>
              <span>{t("common.count", { count: evidenceItems.length })}</span>
            </div>
            <EvidenceViewer
              items={evidenceItems.map((item) => ({
                id: item.record.id,
                title: recordTitle(item.record),
                meta: (
                  <>
                    {evidenceMediaLabel(item.record.mediaType)} ·{" "}
                    {evidenceSourceLabel(item.record.sourceType)} ·{" "}
                    {item.record.fileHash?.slice(0, 12) || t("capture.evidence.noHash")}…
                  </>
                ),
                icon: <Icon name="document" />,
                ariaLabel: t("capture.evidence.open", { name: recordTitle(item.record) }),
                selected: item.record.id === selectedEvidenceId,
                onSelect: () => setSelectedEvidenceId(item.record.id),
              }))}
            />
          </section>
        </div>
        <div className="col-span-full">
          <MediaAnalysisPanel key={`${workspace.project.id}:${client.session?.actor.roleAssignmentId ?? workspace.role.id}:${workspace.role.actorGroup}`} client={client} workspace={workspace} online={online} onChanged={refresh} />
        </div>
      </CaptureTemplate>

      {selectedEvidence ? (
        <EvidenceDetailPreview
          client={client}
          workspace={workspace}
          evidence={selectedEvidence}
          allEvidence={evidenceItems.map((item) => item.record)}
          onClose={() => setSelectedEvidenceId(null)}
        />
      ) : null}
    </PageBoundary>
  );
}
