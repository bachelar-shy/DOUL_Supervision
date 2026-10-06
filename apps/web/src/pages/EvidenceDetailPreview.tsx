import { useEffect, useState, type ReactNode } from "react";

import type { SupervisionClient } from "../data/supervision-client";
import type { RecordDTO, Workspace } from "../data/ui-contract";
import { EvidenceDetailSheet } from "../ui/catalog";
import { evidenceMediaLabel, evidenceSourceLabel } from "./evidence-utils";
import { Icon } from "./shared";
import { recordTitle } from "./record-utils";

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
  if (!source) return "정보 없음/확인 필요";
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return source;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatBytes(value: unknown) {
  const bytes = numericValue(value);
  if (bytes === null) return "정보 없음/확인 필요";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortId(value: unknown) {
  const id = textValue(value);
  return id ? id.slice(0, 12) : "정보 없음";
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
        증빙 원본을 불러오는 중입니다.
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
        영상 미리보기를 지원하지 않는 브라우저입니다.
      </video>
    );
  }
  if (mime.startsWith("audio/") && preview.url) {
    return (
      <div className="rounded-sm border border-border bg-white p-5">
        <audio src={preview.url} controls preload="metadata" className="w-full">
          음성 미리보기를 지원하지 않는 브라우저입니다.
        </audio>
      </div>
    );
  }
  if (mime === "application/pdf" && preview.url) {
    return (
      <iframe
        src={preview.url}
        title={`${fileName} PDF 미리보기`}
        className="h-[52vh] w-full rounded-sm border border-border bg-white"
      />
    );
  }
  if (preview.text !== undefined) {
    return (
      <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-white p-4 text-[11px] leading-5 text-slate-700">
        {preview.text || "내용 없음"}
      </pre>
    );
  }
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-sm border border-border bg-white px-5 text-center">
      <Icon name="document" />
      <strong className="mt-3 text-xs text-slate-700">
        미리보기를 지원하지 않는 형식입니다.
      </strong>
      <small className="mt-2 text-[10px] text-slate-400">
        파일 정보와 출처 연결은 아래 탭에서 확인할 수 있습니다.
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
              reason instanceof Error
                ? reason.message
                : "증빙 원본을 불러오지 못했습니다.",
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
          <div className="grid gap-2 sm:grid-cols-2">
            <EvidenceField
              label="증빙 구분"
              value={evidenceSourceLabel(evidence.sourceType)}
            />
            <EvidenceField
              label="미디어 유형"
              value={evidenceMediaLabel(evidence.mediaType)}
            />
            <EvidenceField label="촬영 시각" value={formatDate(evidence.capturedAt)} />
            <EvidenceField
              label="서버 등록 시각"
              value={formatDate(evidence.uploadedAt)}
            />
            <EvidenceField label="파일 크기" value={formatBytes(metadata.byteCount)} />
            <EvidenceField
              label="위치 / 공종"
              value={
                <>
                  {textValue(evidence.locationId) || "정보 없음/확인 필요"} /{" "}
                  {textValue(evidence.discipline) || "정보 없음/확인 필요"}
                </>
              }
            />
          </div>
          <div className="notice">
            <strong>판정 경계</strong>
            <p>
              증빙 등록 또는 분석 결과의 존재만으로 검측 합격, 승인, 이슈 종결이
              결정되지 않습니다. 공식 판정은 별도의 권한 있는 업무 절차를 따릅니다.
            </p>
          </div>
        </div>
      }
      provenance={
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <EvidenceField label="증빙 ID" value={evidence.id} mono />
            <EvidenceField
              label="제출자"
              value={
                workspace.participants.find(
                  (party) => party.partyId === evidence.submittedBy,
                )?.name ||
                textValue(evidence.submittedBy) ||
                "정보 없음/확인 필요"
              }
            />
            <EvidenceField
              label="원천 당사자"
              value={
                workspace.participants.find(
                  (party) => party.partyId === evidence.sourcePartyId,
                )?.name ||
                textValue(evidence.sourcePartyId) ||
                "정보 없음/확인 필요"
              }
            />
            <EvidenceField
              label="책임 조직"
              value={
                textValue(evidence.responsibleOrganizationId) ||
                "정보 없음/확인 필요"
              }
              mono
            />
            <EvidenceField
              label="패키지"
              value={textValue(evidence.packageId) || "정보 없음/확인 필요"}
              mono
            />
            <EvidenceField
              label="위치"
              value={textValue(evidence.locationId) || "정보 없음/확인 필요"}
              mono
            />
          </div>

          {evidence.sourceType === "derived" ? (
            <div className="rounded-sm border border-border bg-slate-50 p-4">
              <span className="eyebrow">파생 연결</span>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <EvidenceField
                  label="원본 증빙"
                  value={
                    originalEvidence
                      ? `${recordTitle(originalEvidence)} · ${originalEvidence.id}`
                      : originalEvidenceId || "정보 없음/확인 필요"
                  }
                  mono
                />
                <EvidenceField
                  label="파생 작업"
                  value={
                    textValue(evidence.derivationRunId) ||
                    "정보 없음/확인 필요"
                  }
                  mono
                />
                <EvidenceField
                  label="원본 시간범위"
                  value={
                    sourceRange
                      ? `${numericValue(sourceRange.startMs) ?? "?"}–${numericValue(sourceRange.endMs) ?? "?"} ms`
                      : "정보 없음/확인 필요"
                  }
                />
                <EvidenceField
                  label="Frame / PTS"
                  value={
                    sourceRange
                      ? `#${numericValue(sourceRange.frameIndex) ?? "?"} / ${numericValue(sourceRange.ptsMs) ?? "?"} ms`
                      : "정보 없음/확인 필요"
                  }
                />
              </div>
            </div>
          ) : (
            <div className="notice">
              <strong>원본 증빙</strong>
              <p>
                이 기록은 원본으로 보존됩니다. 파생 이미지·전사·분석 결과가
                생성되더라도 원본을 대체하지 않습니다.
              </p>
            </div>
          )}
        </div>
      }
      technical={
        <div className="space-y-4">
          <div className="grid gap-2">
            <EvidenceField
              label="SHA-256"
              value={textValue(evidence.fileHash) || "정보 없음/확인 필요"}
              mono
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <EvidenceField
                label="파일 ID"
                value={textValue(evidence.fileId) || "정보 없음/확인 필요"}
                mono
              />
              <EvidenceField
                label="MIME"
                value={
                  textValue(metadata.mimeType) ||
                  preview.mime ||
                  "정보 없음/확인 필요"
                }
                mono
              />
              <EvidenceField
                label="재생 길이"
                value={
                  numericValue(evidence.durationMs) === null
                    ? "정보 없음/확인 필요"
                    : `${(numericValue(evidence.durationMs)! / 1000).toFixed(3)} s`
                }
              />
              <EvidenceField
                label="Frame 수"
                value={numericValue(evidence.frameCount) ?? "정보 없음/확인 필요"}
              />
              <EvidenceField label="Domain version" value={`v${evidence.version}`} />
              <EvidenceField
                label="마지막 갱신"
                value={formatDate(evidence.updatedAt)}
              />
            </div>
          </div>
          <details className="technical">
            <summary>서버 메타데이터</summary>
            <pre>{JSON.stringify(metadata, null, 2)}</pre>
          </details>
        </div>
      }
    />
  );
}
