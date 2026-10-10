import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommandDescriptor, WorkItem, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";

const copy = {
  en: {
    title: "Media analysis and human review", intro: "Select registered project evidence and request a server-authorized analysis run.",
    unavailable: "The server has not enabled the media analysis queue for this project.", synthetic: "Synthetic demo only — never a real site assessment or pilot result.",
    evidence: "Source evidence", mode: "Analysis mode", inspection: "Link inspection (required before Issue creation)", noInspection: "No inspection link", queue: "Queue analysis", runs: "Analysis runs", reload: "Refresh run",
    noRuns: "No media analysis runs yet.", status: "Run status", model: "Model profile", sourceDetail: "Source details", coverage: "Coverage", frames: "Frames", transcripts: "Transcript segments", photoResults: "Photo results", candidates: "AI candidates",
    coverageEmpty: "No coverage has been reported yet.", noCandidates: "No candidates were proposed.", beginReview: "Begin review", confirm: "Confirm observation", reject: "Reject candidate", note: "Verification note", rejection: "Reason for rejection", requiredNote: "Enter a note before confirming or rejecting.", eligible: "Eligible for Issue", ineligible: "Not eligible for Issue", selected: "Select eligible confirmed observations for an Issue", issueTitle: "Issue title", actionTitle: "Corrective action title", subtype: "Issue type", responsible: "Responsible contractor", dueAt: "Due date", createIssue: "Create Issue from selected observations", readiness: "Issue readiness", blockers: "Blocked by", issueCreated: "Issue created", working: "Working…", error: "The request could not be completed.", providerMissing: "The run needs an external worker/provider. The browser does not simulate analysis.", original: "Original evidence is unchanged.", noSources: "No eligible image, video, or audio evidence is available.", photo: "Photo", keyframes: "Selected video frames", adaptive: "Adaptive video ranges", everyFrame: "Every decoded frame", audio: "Audio time ranges", details: "Details", noProfile: "Server profile not reported", choose: "Choose…", notConfirmed: "Human confirmation is required before Issue creation.",
  },
  ko: {
    title: "미디어 분석 및 사람 검토", intro: "등록된 프로젝트 증빙을 선택해 서버 권한으로 분석 실행을 요청합니다.",
    unavailable: "서버가 이 프로젝트의 미디어 분석 대기열을 활성화하지 않았습니다.", synthetic: "합성 데모 전용 — 실제 현장 평가 또는 파일럿 결과가 아닙니다.",
    evidence: "원본 증빙", mode: "분석 모드", inspection: "검측 연결 (Issue 생성 전 필수)", noInspection: "검측 연결 없음", queue: "분석 요청", runs: "분석 실행", reload: "실행 새로고침",
    noRuns: "미디어 분석 실행이 없습니다.", status: "실행 상태", model: "모델 프로필", sourceDetail: "원본 상세", coverage: "분석 범위", frames: "프레임", transcripts: "전사 구간", photoResults: "사진 결과", candidates: "AI 후보",
    coverageEmpty: "보고된 분석 범위가 없습니다.", noCandidates: "제안된 후보가 없습니다.", beginReview: "검토 시작", confirm: "관찰 확인", reject: "후보 반려", note: "검증 메모", rejection: "반려 사유", requiredNote: "확인 또는 반려 전에 메모를 입력하세요.", eligible: "Issue 생성 가능", ineligible: "Issue 생성 불가", selected: "Issue에 포함할 확인된 적격 관찰 선택", issueTitle: "Issue 제목", actionTitle: "시정조치 제목", subtype: "Issue 유형", responsible: "담당 시공사", dueAt: "기한", createIssue: "선택 관찰로 Issue 생성", readiness: "Issue 준비 상태", blockers: "차단 사유", issueCreated: "Issue 생성 완료", working: "처리 중…", error: "요청을 완료할 수 없습니다.", providerMissing: "실행에는 외부 작업자/제공자가 필요합니다. 브라우저는 분석을 흉내 내지 않습니다.", original: "원본 증빙은 변경되지 않습니다.", noSources: "사용 가능한 이미지·동영상·오디오 증빙이 없습니다.", photo: "사진", keyframes: "선택 프레임", adaptive: "적응형 동영상 구간", everyFrame: "모든 디코딩 프레임", audio: "오디오 시간 구간", details: "상세", noProfile: "서버 프로필 정보 없음", choose: "선택…", notConfirmed: "Issue 생성 전 사람의 확인이 필요합니다.",
  },
  vi: {
    title: "Phân tích media và người duyệt", intro: "Chọn chứng cứ đã đăng ký để yêu cầu chạy phân tích theo quyền máy chủ.",
    unavailable: "Máy chủ chưa bật hàng đợi phân tích media cho dự án này.", synthetic: "Chỉ là dữ liệu demo tổng hợp — không phải đánh giá công trường hay kết quả thí điểm.",
    evidence: "Chứng cứ nguồn", mode: "Chế độ phân tích", inspection: "Liên kết kiểm tra (bắt buộc trước khi tạo Issue)", noInspection: "Không liên kết kiểm tra", queue: "Đưa vào hàng đợi", runs: "Lượt phân tích", reload: "Làm mới lượt chạy",
    noRuns: "Chưa có lượt phân tích media.", status: "Trạng thái", model: "Hồ sơ mô hình", sourceDetail: "Chi tiết nguồn", coverage: "Phạm vi", frames: "Khung hình", transcripts: "Đoạn phiên âm", photoResults: "Kết quả ảnh", candidates: "Ứng viên AI",
    coverageEmpty: "Chưa có phạm vi được báo cáo.", noCandidates: "Không có ứng viên được đề xuất.", beginReview: "Bắt đầu duyệt", confirm: "Xác nhận quan sát", reject: "Từ chối ứng viên", note: "Ghi chú xác minh", rejection: "Lý do từ chối", requiredNote: "Nhập ghi chú trước khi xác nhận hoặc từ chối.", eligible: "Đủ điều kiện tạo Issue", ineligible: "Không đủ điều kiện tạo Issue", selected: "Chọn quan sát đã xác nhận và đủ điều kiện", issueTitle: "Tiêu đề Issue", actionTitle: "Tiêu đề hành động khắc phục", subtype: "Loại Issue", responsible: "Nhà thầu phụ trách", dueAt: "Hạn hoàn thành", createIssue: "Tạo Issue từ quan sát đã chọn", readiness: "Điều kiện tạo Issue", blockers: "Lý do chặn", issueCreated: "Đã tạo Issue", working: "Đang xử lý…", error: "Không thể hoàn tất yêu cầu.", providerMissing: "Lượt chạy cần worker/provider bên ngoài. Trình duyệt không giả lập phân tích.", original: "Chứng cứ gốc không bị thay đổi.", noSources: "Không có chứng cứ ảnh, video hoặc âm thanh phù hợp.", photo: "Ảnh", keyframes: "Khung hình video đã chọn", adaptive: "Khoảng video thích ứng", everyFrame: "Mọi khung đã giải mã", audio: "Khoảng thời gian âm thanh", details: "Chi tiết", noProfile: "Máy chủ chưa báo hồ sơ", choose: "Chọn…", notConfirmed: "Cần người xác nhận trước khi tạo Issue.",
  },
} as const;

type Lang = keyof typeof copy;
const detectLanguage = (): Lang => {
  const language = document.documentElement.lang.slice(0, 2);
  return language === "ko" || language === "vi" ? language : "en";
};
const evidenceModes: Record<string, Array<{ value: "photo" | "keyframes" | "adaptive" | "every_frame" | "audio"; label: keyof typeof copy.en }>> = {
  photo: [{ value: "photo", label: "photo" }],
  video: [{ value: "keyframes", label: "keyframes" }, { value: "adaptive", label: "adaptive" }, { value: "every_frame", label: "everyFrame" }],
  audio: [{ value: "audio", label: "audio" }],
};
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export function MediaAnalysisPanel({ client, workspace, online, onChanged }: {
  client: SupervisionClient;
  workspace: Workspace;
  online: boolean;
  onChanged: () => Promise<void>;
}) {
  const language = detectLanguage();
  const tx = copy[language];
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

  const capability = workspace.context.creationCapabilities?.analysis_run;
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
  const responsibleOptions = workspace.participants.filter((participant) => participant.actorGroup === "CON");

  const loadRun = useCallback(async (id: string) => {
    if (!id || client.kind !== "http") return;
    setError("");
    try {
      const result = await client.mediaAnalysisReview(id);
      setReview(result);
      setSelectedObservationIds((current) => current.filter((observationId) => result.issueReadiness.issueEligibleObservationIds.includes(observationId)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tx.error);
    }
  }, [client, tx.error]);

  useEffect(() => {
    const latestId = runItems.find((item) => item.record.id === runId)?.record.id;
    if (runId && (latestId || review?.run.record.id === runId)) void loadRun(runId);
    else if (!runId) setReview(null);
  }, [runId, workspace.items, loadRun]);

  useEffect(() => {
    if (!review || !["queued", "running"].includes(String(review.run.record.status))) return;
    const timer = window.setInterval(() => void loadRun(review.run.record.id), 5000);
    return () => window.clearInterval(timer);
  }, [review?.run.record.id, review?.run.record.status, loadRun]);

  const selectedSource = sourceEvidence.find((item) => item.id === selectedEvidenceId);
  const modeOptions = evidenceModes[String(selectedSource?.mediaType ?? "")] ?? [];
  useEffect(() => {
    if (modeOptions.length && !modeOptions.some((option) => option.value === mode)) setMode(modeOptions[0].value);
  }, [selectedEvidenceId, modeOptions, mode]);

  async function queueRun() {
    if (!selectedEvidenceId || !mode || !createEnabled) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const run = await client.requestMediaAnalysis({
        clientObjectId: crypto.randomUUID(),
        sourceEvidenceIds: [selectedEvidenceId],
        mode,
        languages: ["ko", "vi", "en", "auto"],
        ...(selectedInspectionId ? { inspectionId: selectedInspectionId } : {}),
      });
      setRunId(run.id);
      setReview(null);
      await onChanged();
      await loadRun(run.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tx.error);
    } finally { setBusy(false); }
  }

  async function reviewCommand(candidate: WorkItem, action: CommandDescriptor) {
    const note = action.command === "confirm" ? verificationNotes[candidate.record.id]?.trim() : "";
    const rejection = action.command === "reject" ? rejectionReasons[candidate.record.id]?.trim() : "";
    if (action.command === "confirm" && !note) { setError(tx.requiredNote); return; }
    if (action.command === "reject" && !rejection) { setError(tx.requiredNote); return; }
    const evidenceIds = action.command === "confirm" ? reviewEvidenceIds[candidate.record.id] ?? [] : [];
    if (action.command === "confirm" && !evidenceIds.length) { setError(tx.requiredNote); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await client.execute(candidate, action.command, action.command === "confirm"
        ? { verificationNote: note }
        : action.command === "reject" ? { reason: rejection } : {}, evidenceIds);
      await onChanged();
      await loadRun(candidate.record.analysisRunId as string);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tx.error);
    } finally { setBusy(false); }
  }

  async function createIssue() {
    if (!review || !review.issueReadiness.ready || !selectedObservationIds.length || !issueTitle.trim() || !actionTitle.trim() || !responsiblePartyId || !dueAt) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await client.createMediaIssuePackage(review.run.record.id, {
        observationIds: selectedObservationIds,
        subtype: issueSubtype,
        title: issueTitle.trim(),
        actionTitle: actionTitle.trim(),
        responsiblePartyId,
        dueAt: new Date(dueAt).toISOString(),
      });
      setMessage(`${tx.issueCreated}: ${result.issue.id}`);
      setSelectedObservationIds([]);
      await onChanged();
      await loadRun(review.run.record.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tx.error);
    } finally { setBusy(false); }
  }

  const selectedEligible = useMemo(() => selectedObservationIds.length > 0
    && selectedObservationIds.every((id) => review?.issueReadiness.issueEligibleObservationIds.includes(id)), [selectedObservationIds, review]);
  const syntheticResult = syntheticProvider || Boolean(review?.candidates.some((candidate) =>
    (candidate.record.reviewFlags as unknown[] | undefined)?.includes("synthetic_fixture")));

  return <section className="panel mt-4" data-testid="media-analysis-panel" data-busy={busy} data-online={online}>
    <div className="section-heading"><div><h2>{tx.title}</h2><p className="muted">{tx.intro}</p></div><span>{tx.original}</span></div>
    {syntheticResult && <p className="notice" role="note">{tx.synthetic}</p>}
    {!createEnabled && <p className="notice" role="status">{tx.unavailable}</p>}
    {!sourceEvidence.length && <p className="muted">{tx.noSources}</p>}
    <div className="grid gap-3 md:grid-cols-4">
      <label className="grid gap-1">{tx.evidence}<select aria-label={tx.evidence} value={selectedEvidenceId} onChange={(event) => setSelectedEvidenceId(event.target.value)} disabled={!createEnabled || busy}>
        <option value="">{tx.choose}</option>{sourceEvidence.map((source) => <option value={source.id} key={source.id}>{String(source.title ?? source.fileName ?? source.id)} · {source.mediaType} · {source.id.slice(0, 8)}</option>)}
      </select></label>
      <label className="grid gap-1">{tx.mode}<select aria-label={tx.mode} value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} disabled={!selectedSource || !createEnabled || busy}>
        {modeOptions.map((option) => <option value={option.value} key={option.value}>{tx[option.label]}</option>)}
      </select></label>
      <label className="grid gap-1">{tx.inspection}<select aria-label={tx.inspection} value={selectedInspectionId} onChange={(event) => setSelectedInspectionId(event.target.value)} disabled={!createEnabled || busy}>
        <option value="">{tx.noInspection}</option>{eligibleInspections.map((item) => <option value={item.record.id} key={item.record.id}>{String(item.record.workName ?? item.record.title ?? item.record.id)} · {item.record.status}</option>)}
      </select></label>
      <button className="primary self-end" type="button" onClick={() => void queueRun()} disabled={!createEnabled || !selectedEvidenceId || !modeOptions.length || busy}>{busy ? tx.working : tx.queue}</button>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-[minmax(12rem,1fr)_2fr_auto]">
      <label className="grid gap-1">{tx.runs}<select aria-label={tx.runs} value={runId} onChange={(event) => setRunId(event.target.value)}>
        <option value="">{tx.choose}</option>{runItems.map((item) => <option value={item.record.id} key={item.record.id}>{item.record.id.slice(0, 8)} · {item.record.status}</option>)}
      </select></label>
      {runId && <div className="notice" role="status"><strong>{tx.status}: {review?.run.record.status ?? "…"}</strong><p>{tx.model}: {String((review?.run.record.model as Record<string, unknown> | undefined)?.provider ?? provider?.model?.provider ?? tx.noProfile)} / {String((review?.run.record.model as Record<string, unknown> | undefined)?.version ?? provider?.model?.version ?? "")}</p>{review && ["queued", "running"].includes(String(review.run.record.status)) && <p>{tx.providerMissing}</p>}{review && <p>{tx.readiness}: {review.issueReadiness.ready ? tx.eligible : tx.notConfirmed}{review.issueReadiness.blockedReasons.length ? ` · ${tx.blockers}: ${review.issueReadiness.blockedReasons.join(", ")}` : ""}</p>}</div>}
      {runId && <button className="secondary self-start" type="button" onClick={() => void loadRun(runId)} disabled={busy}>{tx.reload}</button>}
    </div>
    {error && <p className="error-box mt-3" role="alert">{error}</p>}{message && <p className="notice mt-3" role="status">{message}</p>}
    {review && <div className="mt-4 grid gap-4">
      <details open><summary>{tx.sourceDetail}</summary><div className="grid gap-2 md:grid-cols-2">{review.sources.map((source) => <pre className="technical overflow-auto" key={source.id}>{pretty({ id: source.id, mediaType: source.mediaType, sourceType: source.sourceType, fileHash: source.fileHash, metadata: source.metadata, durationMs: source.durationMs, scope: { discipline: source.discipline, packageId: source.packageId, locationId: source.locationId } })}</pre>)}</div></details>
      <details open><summary>{tx.coverage}</summary>{Object.keys(review.coverage).length ? <pre className="technical overflow-auto">{pretty(review.coverage)}</pre> : <p>{tx.coverageEmpty}</p>}</details>
      {!!review.frames.length && <details><summary>{tx.frames} ({review.frames.length})</summary><pre className="technical overflow-auto">{pretty(review.frames)}</pre></details>}
      {!!review.transcripts.length && <details><summary>{tx.transcripts} ({review.transcripts.length})</summary><div className="grid gap-2">{review.transcripts.map((segment, index) => <article className="notice" key={String(segment.segmentId ?? index)}><p>{String(segment.startMs)}–{String(segment.endMs)} ms · {String(segment.speakerLabel ?? "")}</p><strong>{String(segment.originalText ?? "")}</strong>{segment.translatedText != null && <p>{String(segment.translatedText)}</p>}</article>)}</div></details>}
      {!!review.photoResults.length && <details><summary>{tx.photoResults} ({review.photoResults.length})</summary><pre className="technical overflow-auto">{pretty(review.photoResults)}</pre></details>}
      <section><h3>{tx.candidates}</h3>{review.candidates.length ? review.candidates.map((candidate) => {
        const actions = candidate.actions.filter((action) => ["begin_review", "confirm", "reject"].includes(action.command)
          && (action.ready || ["REASON_PRESENT", "EVIDENCE_REQUIRED"].includes(action.blockedReason?.code ?? "")));
        const eligible = review.issueReadiness.issueEligibleObservationIds.includes(candidate.record.id);
        return <article className="notice mb-2 grid gap-2" key={candidate.record.id} data-testid={`media-candidate-${candidate.record.id}`}>
          <strong>{String(candidate.record.description ?? candidate.record.id)} · {candidate.record.status}</strong>
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
      {review.issueReadiness.ready && <section className="notice grid gap-3" data-testid="media-issue-authoring"><h3>{tx.selected}</h3>
        {review.candidates.filter((candidate) => review.issueReadiness.issueEligibleObservationIds.includes(candidate.record.id)).map((candidate) => <label className="flex items-center gap-2" key={candidate.record.id}><input type="checkbox" checked={selectedObservationIds.includes(candidate.record.id)} onChange={(event) => setSelectedObservationIds((current) => event.target.checked ? [...current, candidate.record.id] : current.filter((id) => id !== candidate.record.id))} />{String(candidate.record.description ?? candidate.record.id)}</label>)}
        <label className="grid gap-1">{tx.issueTitle}<input value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} /></label>
        <label className="grid gap-1">{tx.actionTitle}<input value={actionTitle} onChange={(event) => setActionTitle(event.target.value)} /></label>
        <label className="grid gap-1">{tx.subtype}<select value={issueSubtype} onChange={(event) => setIssueSubtype(event.target.value)}><option value="NCR">NCR</option><option value="defect">Defect</option><option value="safety">Safety</option></select></label>
        <label className="grid gap-1">{tx.responsible}<select value={responsiblePartyId} onChange={(event) => setResponsiblePartyId(event.target.value)}><option value="">{tx.choose}</option>{responsibleOptions.map((party) => <option key={party.partyId} value={party.partyId}>{party.name}</option>)}</select></label>
        <label className="grid gap-1">{tx.dueAt}<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        <button className="primary" type="button" onClick={() => void createIssue()} disabled={busy || !online || !selectedEligible || !issueTitle.trim() || !actionTitle.trim() || !responsiblePartyId || !dueAt}>{busy ? tx.working : tx.createIssue}</button>
      </section>}
    </div>}
  </section>;
}
