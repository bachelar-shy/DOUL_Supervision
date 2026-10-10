import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CommandDescriptor, WorkItem, Workspace } from "../data/ui-contract";
import type { IssuePackageInput } from "../data/ui-contract";
import { ApiError, type SupervisionClient } from "../data/supervision-client";
import { creationCapabilityLabel, reasonLabel, states } from "../labels";

const copy = {
  en: {
    title: "Media analysis and human review", intro: "Select registered project evidence and request a server-authorized analysis run.", issueUnavailable: "Issue creation is unavailable for this role or connection.",
    unavailable: "The server has not enabled the media analysis queue for this project.", synthetic: "Synthetic demo only — never a real site assessment or pilot result.", queueAccepted: "Analysis request accepted", refreshFailed: "The server write succeeded, but the latest status could not be refreshed.", evidence: "Source evidence", mode: "Analysis mode", inspection: "Link inspection (required before Issue creation)", noInspection: "No inspection link", queue: "Queue analysis", runs: "Analysis runs", reload: "Refresh run",
    noRuns: "No media analysis runs yet.", status: "Run status", model: "Model profile", sourceDetail: "Source details", coverage: "Coverage", frames: "Frames", transcripts: "Transcript segments", photoResults: "Photo results", candidates: "AI candidates",
    coverageEmpty: "No coverage has been reported yet.", coverageSummary: "Coverage summary", sourceRef: "Source evidence ID", analyzed: "Analyzed ranges", missing: "Missing ranges", audioProcessed: "Audio processed ranges", complete: "Complete", incomplete: "Incomplete", frameRef: "Source frame", noCandidates: "No candidates were proposed.", beginReview: "Begin review", confirm: "Confirm observation", reject: "Reject candidate", note: "Verification note", rejection: "Reason for rejection", requiredNote: "Enter a note before confirming or rejecting.", eligible: "Eligible for Issue", ineligible: "Not eligible for Issue", selected: "Select eligible confirmed observations for an Issue", issueTitle: "Issue title", actionTitle: "Corrective action title", subtype: "Issue type", subtypeDefect: "Defect", subtypeSafety: "Safety", subtypeNcr: "NCR", responsible: "Responsible contractor", dueAt: "Due date", createIssue: "Create Issue from selected observations", readiness: "Issue readiness", blockers: "Blocked by", issueCreated: "Issue created", working: "Working…", error: "The request could not be completed.", providerMissing: "The run needs an external worker/provider. The browser does not simulate analysis.", original: "Original evidence is unchanged.", noSources: "No eligible image, video, or audio evidence is available.", photo: "Photo", keyframes: "Selected video frames", adaptive: "Adaptive video ranges", everyFrame: "Every decoded frame", audio: "Audio time ranges", details: "Details", noProfile: "Server profile not reported", choose: "Choose…", notConfirmed: "Human confirmation is required before Issue creation.", unknownState: "Other state", stateNames: { succeeded: "Succeeded", candidate: "Candidate", under_review: "Under review", queued: "Queued", running: "Running" }, blockerNames: { INSPECTION_LINK_REQUIRED: "Link a failed inspection before creating an Issue.", ANALYSIS_NOT_COMPLETE: "Analysis is not complete.", CASE_ROOT_REQUIRED: "Resolve the inspection's existing case root first.", INSPECTION_NOT_FAILED: "The linked inspection must have a failed result.", OBSERVATION_UNVERIFIED: "A person must confirm an observation.", CLAIM_UNCORROBORATED: "A non-speech source must corroborate the observation." },
  },
  ko: {
    title: "미디어 분석 및 사람 검토", intro: "등록된 프로젝트 증빙을 선택해 서버 권한으로 분석 실행을 요청합니다.", issueUnavailable: "현재 역할 또는 연결 상태에서는 Issue를 생성할 수 없습니다.",
    unavailable: "서버가 이 프로젝트의 미디어 분석 대기열을 활성화하지 않았습니다.", synthetic: "합성 데모 전용 — 실제 현장 평가 또는 파일럿 결과가 아닙니다.", queueAccepted: "분석 요청 접수", refreshFailed: "서버 기록은 성공했지만 최신 상태를 새로고침하지 못했습니다.", evidence: "원본 증빙", mode: "분석 모드", inspection: "검측 연결 (Issue 생성 전 필수)", noInspection: "검측 연결 없음", queue: "분석 요청", runs: "분석 실행", reload: "실행 새로고침",
    noRuns: "미디어 분석 실행이 없습니다.", status: "실행 상태", model: "모델 프로필", sourceDetail: "원본 상세", coverage: "분석 범위", frames: "프레임", transcripts: "전사 구간", photoResults: "사진 결과", candidates: "AI 후보",
    coverageEmpty: "보고된 분석 범위가 없습니다.", coverageSummary: "범위 요약", sourceRef: "원본 증빙 ID", analyzed: "분석 구간", missing: "누락 구간", audioProcessed: "오디오 처리 구간", complete: "완료", incomplete: "미완료", frameRef: "원본 프레임", noCandidates: "제안된 후보가 없습니다.", beginReview: "검토 시작", confirm: "관찰 확인", reject: "후보 반려", note: "검증 메모", rejection: "반려 사유", requiredNote: "확인 또는 반려 전에 메모를 입력하세요.", eligible: "Issue 생성 가능", ineligible: "Issue 생성 불가", selected: "Issue에 포함할 확인된 적격 관찰 선택", issueTitle: "Issue 제목", actionTitle: "시정조치 제목", subtype: "Issue 유형", subtypeDefect: "하자", subtypeSafety: "안전", subtypeNcr: "NCR", responsible: "담당 시공사", dueAt: "기한", createIssue: "선택 관찰로 Issue 생성", readiness: "Issue 준비 상태", blockers: "차단 사유", issueCreated: "Issue 생성 완료", working: "처리 중…", error: "요청을 완료할 수 없습니다.", providerMissing: "실행에는 외부 작업자/제공자가 필요합니다. 브라우저는 분석을 흉내 내지 않습니다.", original: "원본 증빙은 변경되지 않습니다.", noSources: "사용 가능한 이미지·동영상·오디오 증빙이 없습니다.", photo: "사진", keyframes: "선택 프레임", adaptive: "적응형 동영상 구간", everyFrame: "모든 디코딩 프레임", audio: "오디오 시간 구간", details: "상세", noProfile: "서버 프로필 정보 없음", choose: "선택…", notConfirmed: "Issue 생성 전 사람의 확인이 필요합니다.", unknownState: "기타 상태", stateNames: { succeeded: "분석 완료", candidate: "후보", under_review: "검토 중", queued: "대기열", running: "실행 중" }, blockerNames: { INSPECTION_LINK_REQUIRED: "Issue 생성 전에 부적합 검측을 연결하세요.", ANALYSIS_NOT_COMPLETE: "분석이 완료되지 않았습니다.", CASE_ROOT_REQUIRED: "검측의 기존 사례 루트를 먼저 해결하세요.", INSPECTION_NOT_FAILED: "연결된 검측 결과가 부적합이어야 합니다.", OBSERVATION_UNVERIFIED: "사람이 관찰을 확인해야 합니다.", CLAIM_UNCORROBORATED: "비음성 증거로 관찰을 뒷받침해야 합니다." },
  },
  vi: {
    title: "Phân tích media và người duyệt", intro: "Chọn chứng cứ đã đăng ký để yêu cầu chạy phân tích theo quyền máy chủ.", issueUnavailable: "Không thể tạo Issue với vai trò hoặc kết nối hiện tại.",
    unavailable: "Máy chủ chưa bật hàng đợi phân tích media cho dự án này.", synthetic: "Chỉ là dữ liệu demo tổng hợp — không phải đánh giá công trường hay kết quả thí điểm.", queueAccepted: "Máy chủ đã nhận yêu cầu phân tích", refreshFailed: "Máy chủ đã ghi nhận, nhưng không thể làm mới trạng thái gần nhất.", evidence: "Chứng cứ nguồn", mode: "Chế độ phân tích", inspection: "Liên kết kiểm tra (bắt buộc trước khi tạo Issue)", noInspection: "Không liên kết kiểm tra", queue: "Đưa vào hàng đợi", runs: "Lượt phân tích", reload: "Làm mới lượt chạy",
    noRuns: "Chưa có lượt phân tích media.", status: "Trạng thái", model: "Hồ sơ mô hình", sourceDetail: "Chi tiết nguồn", coverage: "Phạm vi", frames: "Khung hình", transcripts: "Đoạn phiên âm", photoResults: "Kết quả ảnh", candidates: "Ứng viên AI",
    coverageEmpty: "Chưa có phạm vi được báo cáo.", coverageSummary: "Tóm tắt phạm vi", sourceRef: "ID chứng cứ nguồn", analyzed: "Khoảng đã phân tích", missing: "Khoảng bị thiếu", audioProcessed: "Khoảng âm thanh đã xử lý", complete: "Hoàn tất", incomplete: "Chưa hoàn tất", frameRef: "Khung hình nguồn", noCandidates: "Không có ứng viên được đề xuất.", beginReview: "Bắt đầu duyệt", confirm: "Xác nhận quan sát", reject: "Từ chối ứng viên", note: "Ghi chú xác minh", rejection: "Lý do từ chối", requiredNote: "Nhập ghi chú trước khi xác nhận hoặc từ chối.", eligible: "Đủ điều kiện tạo Issue", ineligible: "Không đủ điều kiện tạo Issue", selected: "Chọn quan sát đã xác nhận và đủ điều kiện", issueTitle: "Tiêu đề Issue", actionTitle: "Tiêu đề hành động khắc phục", subtype: "Loại Issue", subtypeDefect: "Khiếm khuyết", subtypeSafety: "An toàn", subtypeNcr: "NCR", responsible: "Nhà thầu phụ trách", dueAt: "Hạn hoàn thành", createIssue: "Tạo Issue từ quan sát đã chọn", readiness: "Điều kiện tạo Issue", blockers: "Lý do chặn", issueCreated: "Đã tạo Issue", working: "Đang xử lý…", error: "Không thể hoàn tất yêu cầu.", providerMissing: "Lượt chạy cần worker/provider bên ngoài. Trình duyệt không giả lập phân tích.", original: "Chứng cứ gốc không bị thay đổi.", noSources: "Không có chứng cứ ảnh, video hoặc âm thanh phù hợp.", photo: "Ảnh", keyframes: "Khung hình video đã chọn", adaptive: "Khoảng video thích ứng", everyFrame: "Mọi khung đã giải mã", audio: "Khoảng thời gian âm thanh", details: "Chi tiết", noProfile: "Máy chủ chưa báo hồ sơ", choose: "Chọn…", notConfirmed: "Cần người xác nhận trước khi tạo Issue.", unknownState: "Trạng thái khác", stateNames: { succeeded: "Đã phân tích xong", candidate: "Ứng viên", under_review: "Đang duyệt", queued: "Đang xếp hàng", running: "Đang thực hiện" }, blockerNames: { INSPECTION_LINK_REQUIRED: "Liên kết inspection không đạt trước khi tạo Issue.", ANALYSIS_NOT_COMPLETE: "Phân tích chưa hoàn tất.", CASE_ROOT_REQUIRED: "Trước tiên hãy xử lý case root hiện có của inspection.", INSPECTION_NOT_FAILED: "Inspection liên kết phải có kết quả không đạt.", OBSERVATION_UNVERIFIED: "Cần người xác nhận quan sát.", CLAIM_UNCORROBORATED: "Cần chứng cứ không phải lời nói để đối chiếu quan sát." },
  },
} as const;

const mediaErrorLabels = {
  en: { ANALYSIS_NOT_COMPLETE: "Media analysis must finish before creating an Issue.", INSPECTION_LINK_REQUIRED: "Link an inspection before creating an Issue.", INSPECTION_LINK_INVALID: "The linked inspection is unavailable.", OBSERVATION_REQUIRED: "Select a confirmed observation.", OBSERVATION_UNVERIFIED: "A person must confirm the observation first.", ANALYSIS_CANDIDATE_MISMATCH: "The observation does not belong to this analysis run.", CLAIM_UNCORROBORATED: "A non-speech source must corroborate the observation.", INSPECTION_NOT_FAILED: "The linked inspection must have a failed result.", CASE_ROOT_REQUIRED: "Resolve the inspection's existing case root first." },
  ko: { ANALYSIS_NOT_COMPLETE: "Issue 생성 전에 미디어 분석이 완료되어야 합니다.", INSPECTION_LINK_REQUIRED: "Issue 생성 전에 검측을 연결하세요.", INSPECTION_LINK_INVALID: "연결된 검측을 찾을 수 없습니다.", OBSERVATION_REQUIRED: "확인된 관찰을 선택하세요.", OBSERVATION_UNVERIFIED: "먼저 사람이 관찰을 확인해야 합니다.", ANALYSIS_CANDIDATE_MISMATCH: "이 관찰은 현재 분석 실행에 속하지 않습니다.", CLAIM_UNCORROBORATED: "비음성 증거로 관찰을 뒷받침해야 합니다.", INSPECTION_NOT_FAILED: "연결된 검측 결과가 부적합이어야 합니다.", CASE_ROOT_REQUIRED: "검측의 기존 사례 루트를 먼저 해결하세요." },
  vi: { ANALYSIS_NOT_COMPLETE: "Phân tích media phải hoàn tất trước khi tạo Issue.", INSPECTION_LINK_REQUIRED: "Hãy liên kết inspection trước khi tạo Issue.", INSPECTION_LINK_INVALID: "Không tìm thấy inspection đã liên kết.", OBSERVATION_REQUIRED: "Hãy chọn một quan sát đã xác nhận.", OBSERVATION_UNVERIFIED: "Cần người xác nhận quan sát trước.", ANALYSIS_CANDIDATE_MISMATCH: "Quan sát không thuộc lượt phân tích này.", CLAIM_UNCORROBORATED: "Cần chứng cứ không phải lời nói để đối chiếu quan sát.", INSPECTION_NOT_FAILED: "Inspection liên kết phải có kết quả không đạt.", CASE_ROOT_REQUIRED: "Trước tiên hãy xử lý case root hiện có của inspection." },
} as const;

type Lang = keyof typeof copy;
type CopyKey = { [Key in keyof typeof copy.en]: typeof copy.en[Key] extends string ? Key : never }[keyof typeof copy.en];
const detectLanguage = (resolvedLanguage?: string): Lang => {
  const language = (resolvedLanguage || document.documentElement.lang).slice(0, 2);
  return language === "ko" || language === "vi" ? language : "en";
};
const evidenceModes: Record<string, Array<{ value: "photo" | "keyframes" | "adaptive" | "every_frame" | "audio"; label: CopyKey }>> = {
  photo: [{ value: "photo", label: "photo" }],
  video: [{ value: "keyframes", label: "keyframes" }, { value: "adaptive", label: "adaptive" }, { value: "every_frame", label: "everyFrame" }],
  audio: [{ value: "audio", label: "audio" }],
};
const noModeOptions: Array<{ value: "photo" | "keyframes" | "adaptive" | "every_frame" | "audio"; label: CopyKey }> = [];
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const records = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value)
  ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
  : [];
const rangeLabel = (value: unknown) => {
  if (!value || typeof value !== "object") return String(value ?? "");
  const range = value as Record<string, unknown>;
  if (range.startMs != null || range.endMs != null) return `${String(range.startMs ?? "?")}–${String(range.endMs ?? "?")} ms${range.ptsMs == null ? "" : ` · PTS ${String(range.ptsMs)} ms`}`;
  if (range.start != null || range.end != null) return `${String(range.start ?? "?")}–${String(range.end ?? "?")}`;
  return pretty(value);
};

export function MediaAnalysisPanel({ client, workspace, online, onChanged }: {
  client: SupervisionClient;
  workspace: Workspace;
  online: boolean;
  onChanged: () => Promise<void>;
}) {
  const { i18n } = useTranslation();
  const language = detectLanguage(i18n.resolvedLanguage);
  const tx = copy[language];
  const apiErrorText = useCallback((cause: unknown) => cause instanceof ApiError
    ? (mediaErrorLabels[language] as Record<string, string>)[cause.detail.code] || reasonLabel(cause.detail.code)
    : tx.error, [language, tx.error]);
  const stateText = (value: unknown) => {
    const code = String(value ?? "");
    return states[code] || (tx.stateNames as Record<string, string>)[code] || tx.unknownState;
  };
  const blockerText = (value: string) => (tx.blockerNames as Record<string, string>)[value] || reasonLabel(value);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState("");
  const [selectedInspectionId, setSelectedInspectionId] = useState("");
  const [mode, setMode] = useState<"photo" | "keyframes" | "adaptive" | "every_frame" | "audio">("photo");
  const [runId, setRunId] = useState("");
  const [review, setReview] = useState<import("../data/ui-contract").MediaAnalysisReview | null>(null);
  const [verificationNotes, setVerificationNotes] = useState<Record<string, string>>({});
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [reviewEvidenceIds, setReviewEvidenceIds] = useState<Record<string, string[]>>({});
  const [selectedObservationIds, setSelectedObservationIds] = useState<string[]>([]);
  const [issueTitle, setIssueTitle] = useState("");
  const [actionTitle, setActionTitle] = useState("");
  const [responsiblePartyId, setResponsiblePartyId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [issueSubtype, setIssueSubtype] = useState("NCR");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [submittedIssueRuns, setSubmittedIssueRuns] = useState<string[]>([]);
  const queueAttempt = useRef<{ signature: string; key: string; clientObjectId: string } | null>(null);
  const commandKeys = useRef(new Map<string, string>());
  const issueAttempt = useRef<{ signature: string; key: string; runId: string; input: IssuePackageInput } | null>(null);
  const loadSequence = useRef(0);

  const capability = workspace.context.creationCapabilities?.analysis_run;
  const issueCapability = workspace.context.creationCapabilities?.issue;
  const sourceEvidence = workspace.items
    .filter((item) => item.machine === "evidence" && ["photo", "video", "audio"].includes(String(item.record.mediaType)))
    .map((item) => item.record);
  const eligibleInspections = workspace.items.filter((item) => item.machine === "inspection"
    && item.record.status !== "closed"
    && (!selectedEvidenceId || ["packageId", "locationId", "discipline"].every((key) =>
      !item.record[key] || !sourceEvidence.find((source) => source.id === selectedEvidenceId)?.[key]
      || item.record[key] === sourceEvidence.find((source) => source.id === selectedEvidenceId)?.[key])));
  const runItems = workspace.items.filter((item) => item.machine === "analysis_run");
  const provider = (workspace.context as unknown as { analysisProfile?: { model?: { provider?: string; name?: string; version?: string } } }).analysisProfile;
  const syntheticProvider = workspace.demo && provider?.model?.provider === "development-fixture";
  const createEnabled = client.kind === "http" && workspace.role.actorGroup === "SUP" && online && capability?.canCreate === true;
  const createIssueEnabled = client.kind === "http" && online && issueCapability?.canCreate === true;
  const queueUnavailable = capability?.status === "unauthorized" ? creationCapabilityLabel(capability) : tx.unavailable;
  const responsibleOptions = workspace.participants.filter((participant) => participant.actorGroup === "CON");

  const loadRun = useCallback(async (id: string) => {
    if (!id || client.kind !== "http") return;
    const sequence = ++loadSequence.current;
    try {
      const result = await client.mediaAnalysisReview(id);
      if (sequence !== loadSequence.current) return;
      setError("");
      setReview(result);
      setSelectedObservationIds((current) => current.filter((observationId) => result.issueReadiness.issueEligibleObservationIds.includes(observationId)));
    } catch (reason) {
      if (sequence === loadSequence.current) setError(apiErrorText(reason));
    }
  }, [apiErrorText, client]);

  useEffect(() => {
    if (!runId || client.kind !== "http") return;
    const sequence = ++loadSequence.current;
    let active = true;
    const refresh = async () => {
      try {
        const result = await client.mediaAnalysisReview(runId);
        if (!active || sequence !== loadSequence.current) return;
        setError("");
        setReview(result);
        setSelectedObservationIds((current) => current.filter((observationId) => result.issueReadiness.issueEligibleObservationIds.includes(observationId)));
      } catch (reason) {
        if (active && sequence === loadSequence.current) setError(apiErrorText(reason));
      }
    };
    void refresh();
    return () => { active = false; };
  }, [apiErrorText, client, runId]);

  const activeReviewRunId = review?.run.record.id;
  const activeReviewStatus = String(review?.run.record.status ?? "");
  useEffect(() => {
    if (!activeReviewRunId || !["queued", "running"].includes(activeReviewStatus)) return;
    const timer = window.setInterval(() => void loadRun(activeReviewRunId), 5000);
    return () => window.clearInterval(timer);
  }, [activeReviewRunId, activeReviewStatus, loadRun]);

  const selectedSource = sourceEvidence.find((item) => item.id === selectedEvidenceId);
  const modeOptions = evidenceModes[String(selectedSource?.mediaType ?? "")] ?? noModeOptions;

  async function queueRun() {
    if (!selectedEvidenceId || !mode || !createEnabled) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const signature = JSON.stringify({ selectedEvidenceId, mode, selectedInspectionId, languages: ["ko", "vi", "en", "auto"] });
      if (!queueAttempt.current || queueAttempt.current.signature !== signature) {
        queueAttempt.current = { signature, key: crypto.randomUUID(), clientObjectId: crypto.randomUUID() };
      }
      const run = await client.requestMediaAnalysis({
        clientObjectId: queueAttempt.current.clientObjectId,
        sourceEvidenceIds: [selectedEvidenceId],
        mode,
        languages: ["ko", "vi", "en", "auto"],
        ...(selectedInspectionId ? { inspectionId: selectedInspectionId } : {}),
      }, queueAttempt.current.key);
      queueAttempt.current = null;
      setRunId(run.id);
      setMessage(`${tx.queueAccepted}: ${run.id}`);
      setReview(null);
      let refreshFailed = false;
      try { await onChanged(); } catch { refreshFailed = true; }
      await loadRun(run.id);
      if (refreshFailed) setError(tx.refreshFailed);
    } catch (reason) {
      setError(apiErrorText(reason));
    } finally { setBusy(false); }
  }

  async function reviewCommand(candidate: WorkItem, action: CommandDescriptor) {
    const note = action.command === "confirm" ? verificationNotes[candidate.record.id]?.trim() : "";
    const rejection = action.command === "reject" ? rejectionReasons[candidate.record.id]?.trim() : "";
    if (action.command === "confirm" && !note) { setError(tx.requiredNote); return; }
    if (action.command === "reject" && !rejection) { setError(tx.requiredNote); return; }
    const evidenceIds = action.command === "confirm" ? reviewEvidenceIds[candidate.record.id] ?? [] : [];
    if (action.command === "confirm" && !evidenceIds.length) { setError(tx.requiredNote); return; }
    const signature = JSON.stringify({
      candidateId: candidate.record.id,
      expectedVersion: candidate.record.version,
      command: action.command,
      payload: action.command === "confirm" ? { verificationNote: note } : action.command === "reject" ? { reason: rejection } : {},
      evidenceIds,
    });
    if (!commandKeys.current.has(signature)) commandKeys.current.set(signature, crypto.randomUUID());
    setBusy(true); setError(""); setMessage("");
    try {
      await client.execute(candidate, action.command, action.command === "confirm"
        ? { verificationNote: note }
        : action.command === "reject" ? { reason: rejection } : {}, evidenceIds, commandKeys.current.get(signature));
      await onChanged();
      await loadRun(candidate.record.analysisRunId as string);
    } catch (reason) {
      setError(apiErrorText(reason));
    } finally { setBusy(false); }
  }

  async function createIssue() {
    if (!createIssueEnabled || !review || submittedIssueRuns.includes(review.run.record.id) || !review.issueReadiness.ready || !selectedObservationIds.length || !issueTitle.trim() || !actionTitle.trim() || !responsiblePartyId || !dueAt) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const signature = JSON.stringify({ runId: review.run.record.id, observationIds: selectedObservationIds, subtype: issueSubtype, title: issueTitle.trim(), actionTitle: actionTitle.trim(), responsiblePartyId, dueAt: new Date(dueAt).toISOString() });
      if (!issueAttempt.current || issueAttempt.current.signature !== signature || issueAttempt.current.runId !== review.run.record.id) {
        issueAttempt.current = {
          signature,
          key: crypto.randomUUID(),
          runId: review.run.record.id,
          input: {
            issueObjectId: crypto.randomUUID(),
            actionObjectId: crypto.randomUUID(),
            observationIds: selectedObservationIds,
            subtype: issueSubtype,
            title: issueTitle.trim(),
            actionTitle: actionTitle.trim(),
            responsiblePartyId,
            dueAt: new Date(dueAt).toISOString(),
          },
        };
      }
      const result = await client.createMediaIssuePackage(review.run.record.id, issueAttempt.current.input, issueAttempt.current.key);
      issueAttempt.current = null;
      setSubmittedIssueRuns((current) => current.includes(review.run.record.id) ? current : [...current, review.run.record.id]);
      setMessage(`${tx.issueCreated}: ${result.issue.id}`);
      setSelectedObservationIds([]);
      let refreshFailed = false;
      try { await onChanged(); } catch { refreshFailed = true; }
      await loadRun(review.run.record.id);
      if (refreshFailed) setError(tx.refreshFailed);
    } catch (reason) {
      setError(apiErrorText(reason));
    } finally { setBusy(false); }
  }

  const selectedEligible = useMemo(() => selectedObservationIds.length > 0
    && selectedObservationIds.every((id) => review?.issueReadiness.issueEligibleObservationIds.includes(id)), [selectedObservationIds, review]);
  const syntheticResult = syntheticProvider || Boolean(review?.candidates.some((candidate) =>
    (candidate.record.reviewFlags as unknown[] | undefined)?.includes("synthetic_fixture")));
  const coverageSources = records(review?.coverage.sources);
  const analyzedRangeCount = coverageSources.reduce((sum, source) => sum + records(source.analyzedRanges).length, 0);
  const missingRangeCount = coverageSources.reduce((sum, source) => sum + records(source.missingRanges).length, 0);
  const audioRangeCount = coverageSources.reduce((sum, source) => sum + records(source.audioProcessedRanges).length, 0);

  return <section className="panel mt-4" data-testid="media-analysis-panel">
    <div className="section-heading"><div><h2>{tx.title}</h2><p className="muted">{tx.intro}</p></div><span>{tx.original}</span></div>
    {syntheticResult && <p className="notice" role="note">{tx.synthetic}</p>}
    {!createEnabled && <p className="notice" role="status">{queueUnavailable}</p>}
    {!sourceEvidence.length && <p className="muted">{tx.noSources}</p>}
    <div className="grid gap-3 md:grid-cols-4">
      <label className="grid gap-1">{tx.evidence}<select aria-label={tx.evidence} value={selectedEvidenceId} onChange={(event) => { const nextId = event.target.value; setSelectedEvidenceId(nextId); const nextMode = evidenceModes[String(sourceEvidence.find((source) => source.id === nextId)?.mediaType ?? "")]?.[0]?.value; if (nextMode) setMode(nextMode); }} disabled={!createEnabled || busy}>
        <option value="">{tx.choose}</option>{sourceEvidence.map((source) => <option value={source.id} key={source.id}>{String(source.title ?? source.fileName ?? source.id)} · {source.mediaType} · {source.id.slice(0, 8)}</option>)}
      </select></label>
      <label className="grid gap-1">{tx.mode}<select aria-label={tx.mode} value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} disabled={!selectedSource || !createEnabled || busy}>
        {modeOptions.map((option) => <option value={option.value} key={option.value}>{tx[option.label]}</option>)}
      </select></label>
      <label className="grid gap-1">{tx.inspection}<select aria-label={tx.inspection} value={selectedInspectionId} onChange={(event) => setSelectedInspectionId(event.target.value)} disabled={!createEnabled || busy}>
        <option value="">{tx.noInspection}</option>{eligibleInspections.map((item) => <option value={item.record.id} key={item.record.id}>{String(item.record.workName ?? item.record.title ?? item.record.id)} · {stateText(item.record.status)}</option>)}
      </select></label>
      <button className="primary self-end" type="button" onClick={() => void queueRun()} disabled={!createEnabled || !selectedEvidenceId || !modeOptions.length || busy}>{busy ? tx.working : tx.queue}</button>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-[minmax(12rem,1fr)_2fr_auto]">
      <label className="grid gap-1">{tx.runs}<select aria-label={tx.runs} value={runId} disabled={busy} onChange={(event) => { loadSequence.current += 1; setRunId(event.target.value); setReview(null); }}>
        <option value="">{tx.choose}</option>{runItems.map((item) => <option value={item.record.id} key={item.record.id}>{item.record.id.slice(0, 8)} · {stateText(item.record.status)}</option>)}
      </select></label>
      {runId && <div className="notice" role="status"><strong>{tx.status}: {review ? stateText(review.run.record.status) : "…"}</strong><p>{tx.model}: {String((review?.run.record.model as Record<string, unknown> | undefined)?.provider ?? provider?.model?.provider ?? tx.noProfile)} / {String((review?.run.record.model as Record<string, unknown> | undefined)?.version ?? provider?.model?.version ?? "")}</p>{review && ["queued", "running"].includes(String(review.run.record.status)) && <p>{tx.providerMissing}</p>}{review && <p>{tx.readiness}: {review.issueReadiness.ready ? tx.eligible : tx.notConfirmed}{review.issueReadiness.blockedReasons.length ? ` · ${tx.blockers}: ${review.issueReadiness.blockedReasons.map(blockerText).join(", ")}` : ""}</p>}{review && review.issueReadiness.blockedReasons.length > 0 && <details><summary>{tx.details}</summary><pre className="technical overflow-auto">{pretty({ blockedReasonCodes: review.issueReadiness.blockedReasons, status: review.run.record.status })}</pre></details>}</div>}
      {runId && <button className="secondary self-start" type="button" onClick={() => void loadRun(runId)} disabled={busy}>{tx.reload}</button>}
    </div>
    {error && <p className="error-box mt-3" role="alert">{error}</p>}{message && <p className="notice mt-3" role="status">{message}</p>}
    {review && <div className="mt-4 grid gap-4">
      <details open><summary>{tx.sourceDetail} ({review.sources.length})</summary><div className="grid gap-2 md:grid-cols-2">{review.sources.map((source) => <article className="notice grid gap-1" key={source.id}><strong>{String(source.title ?? source.fileName ?? source.id)}</strong><span>{tx.sourceRef}: <code>{source.id}</code></span><span>{String(source.mediaType ?? "")} · {String(source.sourceType ?? "")}</span><span>SHA-256: <code>{String(source.fileHash ?? "")}</code></span><span>{tx.details}: {String(source.durationMs ?? "—")} ms · {String(source.discipline ?? "")} · {String(source.packageId ?? "")} · {String(source.locationId ?? "")}</span><details><summary>{tx.details}</summary><pre className="technical overflow-auto">{pretty({ metadata: source.metadata, scope: { discipline: source.discipline, packageId: source.packageId, locationId: source.locationId } })}</pre></details></article>)}</div></details>
      <section aria-label={tx.coverage}>
        <h3>{tx.coverage}</h3>
        {Object.keys(review.coverage).length ? <>
          <p className="muted">{tx.coverageSummary}: {coverageSources.length} source(s) · {analyzedRangeCount} {tx.analyzed.toLowerCase()} · {missingRangeCount} {tx.missing.toLowerCase()} · {audioRangeCount} {tx.audioProcessed.toLowerCase()}</p>
          <div className="grid gap-2">{coverageSources.map((source, index) => <article className="notice grid gap-1" key={String(source.sourceEvidenceId ?? index)}>
            <strong>{tx.sourceRef}: <code>{String(source.sourceEvidenceId ?? "—")}</code></strong>
            <span>{tx.complete}: {source.complete === true ? tx.complete : tx.incomplete}</span>
            <span>{tx.analyzed}: {records(source.analyzedRanges).length ? records(source.analyzedRanges).map(rangeLabel).join(", ") : "—"}</span>
            <span>{tx.missing}: {records(source.missingRanges).length ? records(source.missingRanges).map((range) => `${rangeLabel(range)}${range.reason ? ` (${String(range.reason)})` : ""}`).join(", ") : "—"}</span>
            <span>{tx.audioProcessed}: {records(source.audioProcessedRanges).length ? records(source.audioProcessedRanges).map(rangeLabel).join(", ") : "—"}</span>
          </article>)}</div>
          <details className="mt-2"><summary>{tx.details} · JSON</summary><pre className="technical overflow-auto">{pretty(review.coverage)}</pre></details>
        </> : <p>{tx.coverageEmpty}</p>}
      </section>
      {!!review.frames.length && <details open><summary>{tx.frames} ({review.frames.length})</summary><div className="grid gap-2">{review.frames.map((frame, index) => <article className="notice" key={String(frame.frameId ?? frame.id ?? index)}><strong>{tx.frameRef} {String(frame.frameIndex ?? index)}</strong><p>{tx.sourceRef}: <code>{String(frame.sourceEvidenceId ?? frame.evidenceId ?? "—")}</code></p><p>PTS: {String(frame.ptsMs ?? frame.presentationTimeMs ?? "—")} ms · {String(frame.sha256 ?? frame.fileHash ?? "")}</p><details><summary>{tx.details}</summary><pre className="technical overflow-auto">{pretty(frame)}</pre></details></article>)}</div></details>}
      {!!review.transcripts.length && <details open><summary>{tx.transcripts} ({review.transcripts.length})</summary><div className="grid gap-2">{review.transcripts.map((segment, index) => <article className="notice" key={String(segment.segmentId ?? index)}><p>{String(segment.startMs)}–{String(segment.endMs)} ms · {String(segment.speakerLabel ?? "")}</p><p>{tx.sourceRef}: <code>{String(segment.sourceEvidenceId ?? segment.evidenceId ?? "—")}</code></p><strong>{String(segment.originalText ?? "")}</strong>{segment.translatedText != null && <p>{String(segment.translatedText)}</p>}</article>)}</div></details>}
      {!!review.photoResults.length && <details open><summary>{tx.photoResults} ({review.photoResults.length})</summary><div className="grid gap-2">{review.photoResults.map((result, index) => <article className="notice" key={String(result.id ?? index)}><p>{tx.sourceRef}: <code>{String(result.sourceEvidenceId ?? result.evidenceId ?? "—")}</code></p><strong>{String(result.description ?? result.text ?? result.result ?? tx.details)}</strong><details><summary>{tx.details}</summary><pre className="technical overflow-auto">{pretty(result)}</pre></details></article>)}</div></details>}
      <section><h3>{tx.candidates}</h3>{review.candidates.length ? review.candidates.map((candidate) => {
        const actions = candidate.actions.filter((action) => ["begin_review", "confirm", "reject"].includes(action.command)
          && (action.ready || ["REASON_PRESENT", "EVIDENCE_REQUIRED"].includes(action.blockedReason?.code ?? "")));
        const eligible = review.issueReadiness.issueEligibleObservationIds.includes(candidate.record.id);
        return <article className="notice mb-2 grid gap-2" key={candidate.record.id} data-testid={`media-candidate-${candidate.record.id}`}>
          <strong>{String(candidate.record.description ?? candidate.record.id)} · {stateText(candidate.record.status)}</strong>
          <span>{eligible ? tx.eligible : tx.ineligible} · {String(candidate.record.confidence ?? "")}</span>
          <details><summary>{tx.details}</summary><pre className="technical overflow-auto">{pretty({ id: candidate.record.id, source: candidate.record.source, analysisRunId: candidate.record.analysisRunId, evidenceIds: candidate.record.evidenceIds, grounding: candidate.record.grounding, reviewFlags: candidate.record.reviewFlags })}</pre></details>
          {actions.map((action) => <div className="flex flex-wrap items-end gap-2" key={action.command}>
            {action.command === "confirm" && <label className="grid min-w-64 flex-1 gap-1">{tx.note}<textarea value={verificationNotes[candidate.record.id] ?? ""} onChange={(event) => setVerificationNotes((current) => ({ ...current, [candidate.record.id]: event.target.value }))} /></label>}
            {action.command === "confirm" && candidate.record.evidenceIds?.map((evidenceId) => <label className="flex items-center gap-2" key={evidenceId}><input type="checkbox" checked={(reviewEvidenceIds[candidate.record.id] ?? []).includes(evidenceId)} onChange={(event) => setReviewEvidenceIds((current) => ({ ...current, [candidate.record.id]: event.target.checked ? [...(current[candidate.record.id] ?? []), evidenceId] : (current[candidate.record.id] ?? []).filter((id) => id !== evidenceId) }))} />{evidenceId.slice(0, 12)} · {tx.sourceDetail}</label>)}
            {action.command === "reject" && <label className="grid min-w-64 flex-1 gap-1">{tx.rejection}<textarea value={rejectionReasons[candidate.record.id] ?? ""} onChange={(event) => setRejectionReasons((current) => ({ ...current, [candidate.record.id]: event.target.value }))} /></label>}
            <button className={action.command === "confirm" ? "primary" : "secondary"} type="button" onClick={() => void reviewCommand(candidate, action)} disabled={busy || !online || ((action.command === "confirm" && (!verificationNotes[candidate.record.id]?.trim() || !(reviewEvidenceIds[candidate.record.id]?.length))) || (action.command === "reject" && !rejectionReasons[candidate.record.id]?.trim()))}>{action.command === "begin_review" ? tx.beginReview : action.command === "confirm" ? tx.confirm : tx.reject}</button>
          </div>)}
          {!actions.length && candidate.record.status !== "confirmed" && <p>{tx.notConfirmed}</p>}
        </article>;
      }) : <p>{tx.noCandidates}</p>}</section>
      {review.issueReadiness.ready && !createIssueEnabled && <p className="notice" role="status">{issueCapability?.status === "unauthorized" ? creationCapabilityLabel(issueCapability) : tx.issueUnavailable}</p>}
      {review.issueReadiness.ready && createIssueEnabled && !submittedIssueRuns.includes(review.run.record.id) && <section className="notice grid gap-3" data-testid="media-issue-authoring"><h3>{tx.selected}</h3>
        {review.candidates.filter((candidate) => review.issueReadiness.issueEligibleObservationIds.includes(candidate.record.id)).map((candidate) => <label className="flex items-center gap-2" key={candidate.record.id}><input type="checkbox" checked={selectedObservationIds.includes(candidate.record.id)} onChange={(event) => setSelectedObservationIds((current) => event.target.checked ? [...current, candidate.record.id] : current.filter((id) => id !== candidate.record.id))} />{String(candidate.record.description ?? candidate.record.id)}</label>)}
        <label className="grid gap-1">{tx.issueTitle}<input value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} /></label>
        <label className="grid gap-1">{tx.actionTitle}<input value={actionTitle} onChange={(event) => setActionTitle(event.target.value)} /></label>
        <label className="grid gap-1">{tx.subtype}<select value={issueSubtype} onChange={(event) => setIssueSubtype(event.target.value)}><option value="NCR">{tx.subtypeNcr}</option><option value="Defect">{tx.subtypeDefect}</option><option value="Safety">{tx.subtypeSafety}</option></select></label>
        <label className="grid gap-1">{tx.responsible}<select value={responsiblePartyId} onChange={(event) => setResponsiblePartyId(event.target.value)}><option value="">{tx.choose}</option>{responsibleOptions.map((party) => <option key={party.partyId} value={party.partyId}>{party.name}</option>)}</select></label>
        <label className="grid gap-1">{tx.dueAt}<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        <button className="primary" type="button" onClick={() => void createIssue()} disabled={busy || !createIssueEnabled || !selectedEligible || !issueTitle.trim() || !actionTitle.trim() || !responsiblePartyId || !dueAt}>{busy ? tx.working : tx.createIssue}</button>
      </section>}
    </div>}
  </section>;
}
