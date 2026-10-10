import { useTranslation } from "react-i18next";
import { koreanRegisterFieldLabels, koreanRegisterObjectLabels } from "@doul/localization";
import { fields, states, roles, commands, reasonLabel } from "../labels";
import { machineLabels } from "../app/routes";
import { formatDateTime, formatNumber } from "../i18n/format";

const labels: Record<string, string> = {
  id: "기록번호", title: "제목", name: "명칭", description: "내용", version: "작성 차수",
  status: "처리 상태", revision: "도면 개정", page: "도면 쪽", pageNumber: "도면 쪽",
  drawingNumber: "도면번호", fileName: "파일명", mimeType: "파일 형식", byteCount: "파일 크기",
  hash: "파일 무결성 확인값", sha256: "파일 무결성 확인값", contentHash: "파일 무결성 확인값",
  capturedAt: "촬영 일시", uploadedAt: "등록 일시", createdAt: "작성 일시", updatedAt: "수정 일시",
  mediaType: "자료 종류", sourceType: "자료 출처", objectType: "관련 기록 종류", objectId: "관련 기록번호",
  reference: "관련 기록", domainRef: "관련 기록", record: "업무 기록", data: "작성 내용",
  metadata: "자료 상세정보", calculated: "집계·확인 항목", items: "관련 업무", records: "등록 기록",
  locationId: "위치번호", packageId: "공사 구분", projectId: "현장번호", discipline: "공종",
  drawingRef: "관련 도면", sourceRef: "작성 근거", evidenceRefs: "관련 증빙", evidenceIds: "증빙번호",
  drawingAnchors: "도면 표시 위치", semanticAnchor: "위치 구분명", parentRef: "상위 위치",
  x: "가로 위치", y: "세로 위치", coordinateSystem: "도면 좌표 기준", depth: "위치 구분 단계",
  reason: "처리 사유", message: "안내 내용", responsiblePartyId: "담당자", submittedBy: "제출자",
  originalEvidenceId: "원본 증빙번호", fileId: "등록 파일번호", sourcePartyId: "자료 제공자",
  durationMs: "재생 시간(밀리초)", frameCount: "추출 사진 수", workName: "공종·작업명",
  subtype: "업무 종류", machine: "업무 구분", ready: "처리 가능", requiresInput: "작성 필요",
  to: "다음 처리 단계", command: "후속 업무", available: "사용 가능", blockedReason: "진행 불가 사유",
  dueAt: "처리 기한", count: "건수", total: "총계", state: "처리 상태",
};
const values: Record<string, string> = { photo: "사진", video: "영상", audio: "음성", document: "문서", measurement: "측정", original: "원본", derived: "추출 자료", pdf_points: "PDF 도면 좌표" };

/** Field-facing summary, deliberately excludes storage and permission implementation attributes. */
export function RecordDetails({ value, depth = 0, fieldKey = "" }: { value: unknown; depth?: number; fieldKey?: string }) {
  const { t, i18n } = useTranslation();
  const ko = (i18n.resolvedLanguage || i18n.language).startsWith("ko");
  if (value == null || value === "") return <span>{t("common.none")}</span>;
  if (typeof value === "boolean") return <span>{t(value ? "common.yes" : "common.no")}</span>;
  if (typeof value === "number") return <span>{formatNumber(value)}</span>;
  if (typeof value === "string") {
    const enumField = ["status", "state", "mediaType", "sourceType", "objectType", "machine", "command", "actorGroup", "to", "coordinateSystem"].includes(fieldKey);
    const label = enumField ? states[value] || roles[value] || commands[value] || machineLabels[value]
      || (ko ? koreanRegisterObjectLabels[value] || values[value] : undefined) : fieldKey === "reason" && /^[A-Z_]+$/.test(value) ? reasonLabel(value) : undefined;
    return <span className="break-words">{label || (/^\d{4}-\d{2}-\d{2}T/.test(value) ? formatDateTime(value) : value)}</span>;
  }
  if (depth > 8) return <span>{t("register.value.count", { count: Object.keys(value).length })}</span>;
  if (Array.isArray(value)) return value.length ? <ol>{value.map((item, index) => <li key={index}><RecordDetails value={item} depth={depth + 1} fieldKey={fieldKey} /></li>)}</ol> : <span>{t("common.none")}</span>;
  const rows = Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const label = fields[key] || (i18n.exists(`register.field.${key}`) ? t(`register.field.${key}`) : undefined)
      || (ko ? koreanRegisterFieldLabels[key] || labels[key] : labels[key] ? key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ") : undefined);
    return label ? [{ key, label, item }] : [];
  });
  return rows.length ? <dl className="space-y-2">{rows.map(({ key, label, item }) => <div key={key}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-sm"><RecordDetails value={item} depth={depth + 1} fieldKey={key} /></dd></div>)}</dl> : <span>{t("common.unknown")}</span>;
}
