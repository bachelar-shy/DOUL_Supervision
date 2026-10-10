import { RecordDetails } from "./RecordDetails";
import { useEffect, useState, type ReactNode } from "react";

import { ApiError, type SupervisionClient } from "../data/supervision-client";
import { reasonLabel } from "../labels";
import type { RecordDTO, Workspace } from "../data/ui-contract";
import { EvidenceDetailSheet } from "../ui/catalog";
import { evidenceMediaLabel, evidenceSourceLabel } from "./evidence-utils";
import { Icon } from "./shared";
import { recordTitle } from "./record-utils";
import { formatDateTime, formatNumber } from "../i18n/format";
import i18n from "../i18n/config";

function tr(
  key: string,
  values: Record<string, string | number | boolean> = {},
) {
  return i18n.t(key, values);
}

interface EvidencePreviewState {
  loading: boolean;
  mime?: string;
  url?: string;
  text?: string;
  error?: string;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numericValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatDate(value: unknown) {
  const source = textValue(value);
  if (!source) return tr("evidence.value.noInfoCheck");
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return source;
  return formatDateTime(date);
}

function formatBytes(value: unknown) {
  const bytes = numericValue(value);
  if (bytes === null) return tr("evidence.value.noInfoCheck");
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortId(value: unknown) {
  const id = textValue(value);
  return id ? id.slice(0, 12) : tr("evidence.value.noInfo");
}

function EvidenceField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-sm border border-border bg-slate-50 p-3">
      <small className="block text-[9px] text-slate-400">{label}</small>
      <div
        className={
          mono
            ? "mt-1 break-all font-mono text-[10px] leading-5 text-slate-700"
            : "mt-1 text-[11px] leading-5 text-slate-700"
        }
      >
        {value}
      </div>
    </div>
  );
}

function EvidenceMediaPreview({
  record,
  preview,
}: {
  record: RecordDTO;
  preview: EvidencePreviewState;
}) {
  const fileName = textValue(record.metadata?.name) || recordTitle(record);

  if (preview.loading) {
    return (
      <div
        className="flex min-h-56 items-center justify-center rounded-sm border border-border bg-white text-xs text-slate-500"
        role="status"
      >
        {tr("evidence.preview.loading")}
      </div>
    );
  }
  if (preview.error) {
    return (
      <div
        className="flex min-h-56 items-center justify-center rounded-sm border border-border bg-white px-5 text-center text-xs text-red-700"
        role="alert"
      >
        {preview.error}
      </div>
    );
  }

  const mime = preview.mime || textValue(record.metadata?.mimeType) || "";
  if (mime.startsWith("image/") && preview.url) {
    return (
      <div className="flex min-h-56 items-center justify-center overflow-hidden rounded-sm border border-border bg-white">
        <img
          src={preview.url}
          alt={fileName}
          className="max-h-[52vh] w-full object-contain"
        />
      </div>
    );
  }
  if (mime.startsWith("video/") && preview.url) {
    return (
      <video
        src={preview.url}
        controls
        preload="metadata"
        className="max-h-[52vh] w-full rounded-sm border border-border bg-black"
      >
        {tr("evidence.preview.videoUnsupported")}
      </video>
    );
  }
  if (mime.startsWith("audio/") && preview.url) {
    return (
      <div className="rounded-sm border border-border bg-white p-5">
        <audio src={preview.url} controls preload="metadata" className="w-full">
          {tr("evidence.preview.audioUnsupported")}
        </audio>
      </div>
    );
  }
  if (mime === "application/pdf" && preview.url) {
    return (
      <iframe
        src={preview.url}
        title={tr("evidence.preview.pdfTitle", { name: fileName })}
        className="h-[52vh] w-full rounded-sm border border-border bg-white"
      />
    );
  }
  if (preview.text !== undefined) {
    return (
      <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-white p-4 text-[11px] leading-5 text-slate-700">
        {preview.text || tr("evidence.preview.emptyText")}
      </pre>
    );
  }
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-sm border border-border bg-white px-5 text-center">
      <Icon name="document" />
      <strong className="mt-3 text-xs text-slate-700">
        {tr("evidence.preview.unsupported")}
      </strong>
      <small className="mt-2 text-[10px] text-slate-400">
        {tr("evidence.preview.unsupportedHelp")}
      </small>
    </div>
  );
}

export function EvidenceDetailPreview({
  client,
  workspace,
  evidence,
  allEvidence,
  onClose,
}: {
  client: SupervisionClient;
  workspace: Workspace;
  evidence: RecordDTO;
  allEvidence: readonly RecordDTO[];
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<EvidencePreviewState>({ loading: true });

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;

    client
      .evidenceContent(evidence.id)
      .then(async (blob) => {
        const mime = blob.type || textValue(evidence.metadata?.mimeType) || "";
        if (mime.startsWith("text/")) {
          const text = await blob.text();
          if (active) setPreview({ loading: false, mime, text });
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        if (active) {
          setPreview({ loading: false, mime, url: objectUrl });
        } else {
          URL.revokeObjectURL(objectUrl);
          objectUrl = undefined;
        }
      })
      .catch((reason) => {
        if (active) {
          setPreview({
            loading: false,
            error:
              reason instanceof ApiError
                ? reasonLabel(reason.detail.code)
                : tr("evidence.preview.loadFailed"),
          });
        }
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, evidence]);

  const metadata = evidence.metadata ?? {};
  const originalEvidenceId = textValue(evidence.originalEvidenceId);
  const originalEvidence = originalEvidenceId
    ? allEvidence.find((item) => item.id === originalEvidenceId) ?? null
    : null;
  const sourceRange =
    evidence.sourceRange &&
    typeof evidence.sourceRange === "object" &&
    !Array.isArray(evidence.sourceRange)
      ? (evidence.sourceRange as Record<string, unknown>)
      : null;

  return (
    <EvidenceDetailSheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={recordTitle(evidence)}
      description={
        <>
          {evidenceMediaLabel(evidence.mediaType)} ·{" "}
          {evidenceSourceLabel(evidence.sourceType)} · {shortId(evidence.id)}
        </>
      }
      preview={<EvidenceMediaPreview record={evidence} preview={preview} />}
      summary={
        <div className="space-y-4">
          {metadata.demoClassification === "SYNTHETIC_NOT_SITE_EVIDENCE" && (
            <div className="notice" role="note" data-testid="synthetic-evidence-notice">
              <strong>{tr("evidence.demo.syntheticTitle")}</strong>
              <p>{tr("evidence.demo.syntheticDescription")}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <EvidenceField label={tr("evidence.demo.case")} value={textValue(metadata.demoCaseId) || tr("evidence.value.noInfoCheck")} />
                <EvidenceField label={tr("evidence.demo.stage")} value={textValue(metadata.demoStage) || tr("evidence.value.noInfoCheck")} />
                <EvidenceField label={tr("evidence.demo.zone")} value={textValue(metadata.demoZone) || tr("evidence.value.noInfoCheck")} />
              </div>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <EvidenceField
              label={tr("evidence.summary.sourceType")}
              value={evidenceSourceLabel(evidence.sourceType)}
            />
            <EvidenceField
              label={tr("evidence.summary.mediaType")}
              value={evidenceMediaLabel(evidence.mediaType)}
            />
            <EvidenceField label={tr("evidence.summary.capturedAt")} value={formatDate(evidence.capturedAt)} />
            <EvidenceField
              label={tr("evidence.summary.uploadedAt")}
              value={formatDate(evidence.uploadedAt)}
            />
            <EvidenceField label={tr("evidence.summary.fileSize")} value={formatBytes(metadata.byteCount)} />
            <EvidenceField
              label={tr("evidence.summary.locationDiscipline")}
              value={
                <>
                  {textValue(evidence.locationId) || tr("evidence.value.noInfoCheck")} /{" "}
                  {textValue(evidence.discipline) || tr("evidence.value.noInfoCheck")}
                </>
              }
            />
          </div>
          <div className="notice">
            <strong>{tr("evidence.boundary.title")}</strong>
            <p>
              {tr("evidence.boundary.description")}
            </p>
          </div>
        </div>
      }
      provenance={
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <EvidenceField label={tr("evidence.provenance.id")} value={evidence.id} mono />
            <EvidenceField
              label={tr("evidence.provenance.submitter")}
              value={
                workspace.participants.find(
                  (party) => party.partyId === evidence.submittedBy,
                )?.name ||
                textValue(evidence.submittedBy) ||
                tr("evidence.value.noInfoCheck")
              }
            />
            <EvidenceField
              label={tr("evidence.provenance.sourceParty")}
              value={
                workspace.participants.find(
                  (party) => party.partyId === evidence.sourcePartyId,
                )?.name ||
                textValue(evidence.sourcePartyId) ||
                tr("evidence.value.noInfoCheck")
              }
            />
            <EvidenceField
              label={tr("evidence.provenance.responsibleOrganization")}
              value={
                textValue(evidence.responsibleOrganizationId) ||
                tr("evidence.value.noInfoCheck")
              }
              mono
            />
            <EvidenceField
              label={tr("evidence.provenance.package")}
              value={textValue(evidence.packageId) || tr("evidence.value.noInfoCheck")}
              mono
            />
            <EvidenceField
              label={tr("evidence.provenance.location")}
              value={textValue(evidence.locationId) || tr("evidence.value.noInfoCheck")}
              mono
            />
          </div>

          {evidence.sourceType === "derived" ? (
            <div className="rounded-sm border border-border bg-slate-50 p-4">
              <span className="eyebrow">{tr("evidence.derived.title")}</span>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <EvidenceField
                  label={tr("evidence.derived.original")}
                  value={
                    originalEvidence
                      ? `${recordTitle(originalEvidence)} · ${originalEvidence.id}`
                      : originalEvidenceId || tr("evidence.value.noInfoCheck")
                  }
                  mono
                />
                <EvidenceField
                  label={tr("evidence.derived.run")}
                  value={
                    textValue(evidence.derivationRunId) ||
                    tr("evidence.value.noInfoCheck")
                  }
                  mono
                />
                <EvidenceField
                  label={tr("evidence.derived.sourceRange")}
                  value={
                    sourceRange
                      ? `${numericValue(sourceRange.startMs) ?? "?"}–${numericValue(sourceRange.endMs) ?? "?"} ms`
                      : tr("evidence.value.noInfoCheck")
                  }
                />
                <EvidenceField
                  label={tr("evidence.derived.framePts")}
                  value={
                    sourceRange
                      ? `#${numericValue(sourceRange.frameIndex) ?? "?"} / ${numericValue(sourceRange.ptsMs) ?? "?"} ms`
                      : tr("evidence.value.noInfoCheck")
                  }
                />
              </div>
            </div>
          ) : (
            <div className="notice">
              <strong>{tr("evidence.original.title")}</strong>
              <p>
                {tr("evidence.original.description")}
              </p>
            </div>
          )}
        </div>
      }
      technical={
        <div className="space-y-4">
          <div className="grid gap-2">
            <EvidenceField
              label={tr("evidence.technical.hash")}
              value={textValue(evidence.fileHash) || tr("evidence.value.noInfoCheck")}
              mono
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <EvidenceField
                label={tr("evidence.technical.fileId")}
                value={textValue(evidence.fileId) || tr("evidence.value.noInfoCheck")}
                mono
              />
              <EvidenceField
                label="MIME"
                value={
                  textValue(metadata.mimeType) ||
                  preview.mime ||
                  tr("evidence.value.noInfoCheck")
                }
                mono
              />
              <EvidenceField
                label={tr("evidence.technical.duration")}
                value={
                  numericValue(evidence.durationMs) === null
                    ? tr("evidence.value.noInfoCheck")
                    : `${(numericValue(evidence.durationMs)! / 1000).toFixed(3)} s`
                }
              />
              <EvidenceField
                label={tr("evidence.technical.frameCount")}
                value={numericValue(evidence.frameCount) ?? tr("evidence.value.noInfoCheck")}
              />
              <EvidenceField label={tr("evidence.technical.sourceVersion")} value={formatNumber(evidence.version)} />
              <EvidenceField
                label={tr("evidence.technical.updatedAt")}
                value={formatDate(evidence.updatedAt)}
              />
            </div>
          </div>
          <details className="technical">
            <summary>{tr("evidence.technical.serverMetadata")}</summary>
            <RecordDetails value={metadata} />
          </details>
        </div>
      }
    />
  );
}
