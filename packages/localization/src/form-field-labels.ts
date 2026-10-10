/** Form field display terms for the five active A4 draft forms.
 * Keys are authoritative scalar-field paths. Text is presentation only;
 * it must never be written back as a schema identifier.
 * Korean is the reviewed source; Vietnamese and English require field review.
 */
export const formFieldLabels = {
  "basis.attachments": { ko: "첨부자료", vi: "Tài liệu đính kèm", en: "Attachments" },
  "basis.criteria": { ko: "검측기준", vi: "Tiêu chí nghiệm thu", en: "Acceptance criteria" },
  "basis.drawings": { ko: "적용 도면", vi: "Bản vẽ áp dụng", en: "Applicable drawings" },
  "basis.tests": { ko: "시험·측정자료", vi: "Kết quả thí nghiệm / đo đạc", en: "Test and measurement records" },
  "contract.package": { ko: "공사 공사 구분", vi: "Gói thầu thi công", en: "Work package" },
  "decision.date": { ko: "결정요청일", vi: "Ngày yêu cầu quyết định", en: "Request date" },
  "decision.decided_at": { ko: "결정 시각", vi: "Thời điểm quyết định", en: "Decision time" },
  "decision.due": { ko: "결정기한", vi: "Hạn quyết định", en: "Decision deadline" },
  "decision.impact": { ko: "미결정 시 영향", vi: "Ảnh hưởng nếu chưa quyết định", en: "Impact if undecided" },
  "decision.issue": { ko: "결정 요청사항", vi: "Vấn đề cần quyết định", en: "Decision required" },
  "decision.no": { ko: "결정요청 번호", vi: "Số yêu cầu quyết định", en: "Decision request number" },
  "decision.option_a": { ko: "대안 A", vi: "Phương án A", en: "Option A" },
  "decision.option_b": { ko: "대안 B", vi: "Phương án B", en: "Option B" },
  "decision.option_c": { ko: "대안 C", vi: "Phương án C", en: "Option C" },
  "decision.recommendation": { ko: "감리 검토의견", vi: "Kiến nghị của tư vấn giám sát", en: "Supervision recommendation" },
  "decision.result": { ko: "발주처 결정", vi: "Quyết định của chủ đầu tư", en: "Owner decision" },
  "inspection.datetime": { ko: "검측 일시", vi: "Thời gian nghiệm thu", en: "Inspection date and time" },
  "inspection.no": { ko: "검측기록 번호", vi: "Số biên bản nghiệm thu", en: "Inspection record number" },
  "inspection.place": { ko: "검측 장소", vi: "Địa điểm nghiệm thu", en: "Inspection location" },
  "inspection.work_name": { ko: "검측 공종·작업명", vi: "Hạng mục / công tác nghiệm thu", en: "Work item for inspection" },
  "ncr.criteria": { ko: "부적합 판정기준", vi: "Tiêu chí xác định không phù hợp", en: "Nonconformity criteria" },
  "ncr.date": { ko: "부적합 확인일", vi: "Ngày phát hiện không phù hợp", en: "Date identified" },
  "ncr.description": { ko: "부적합 내용", vi: "Nội dung không phù hợp", en: "Nonconformity description" },
  "ncr.due": { ko: "시정 완료기한", vi: "Hạn hoàn thành khắc phục", en: "Corrective action deadline" },
  "ncr.immediate_action": { ko: "즉시 시정조치", vi: "Biện pháp khắc phục ngay", en: "Immediate corrective action" },
  "ncr.impact": { ko: "품질·공정 영향", vi: "Ảnh hưởng đến chất lượng / tiến độ", en: "Quality and schedule impact" },
  "ncr.no": { ko: "부적합 보고서 번호", vi: "Số báo cáo không phù hợp", en: "NCR number" },
  "ncr.owner_report": { ko: "발주처 보고사항", vi: "Nội dung báo cáo chủ đầu tư", en: "Owner reporting" },
  "ncr.priority": { ko: "조치 우선순위", vi: "Mức độ ưu tiên khắc phục", en: "Corrective priority" },
  "ncr.related": { ko: "관련 도면·기록", vi: "Bản vẽ / hồ sơ liên quan", en: "Related drawings and records" },
  "project.name": { ko: "현장명", vi: "Tên dự án", en: "Project name" },
  "result.corrections": { ko: "시정 필요사항", vi: "Nội dung cần khắc phục", en: "Required corrections" },
  "result.next_work_allowed": { ko: "후속공정 진행 허용", vi: "Cho phép triển khai công việc tiếp theo", en: "Follow-on work authorized" },
  "result.status": { ko: "검측 결과", vi: "Kết quả nghiệm thu", en: "Inspection result" },
  "urgent.cause": { ko: "발생 원인", vi: "Nguyên nhân phát sinh", en: "Cause" },
  "urgent.decision_due": { ko: "결정 필요기한", vi: "Hạn cần ra quyết định", en: "Decision due date" },
  "urgent.decision_required": { ko: "발주처 결정 필요사항", vi: "Nội dung cần chủ đầu tư quyết định", en: "Owner decision required" },
  "urgent.fact": { ko: "긴급 상황·사실관계", vi: "Tình hình khẩn cấp và sự việc", en: "Urgent facts" },
  "urgent.immediate_action": { ko: "긴급 조치사항", vi: "Biện pháp xử lý khẩn cấp", en: "Immediate actions" },
  "urgent.impact": { ko: "품질·공정·비용 영향", vi: "Ảnh hưởng chất lượng / tiến độ / chi phí", en: "Quality, time and cost impacts" },
  "urgent.next_action": { ko: "후속조치 계획", vi: "Kế hoạch xử lý tiếp theo", en: "Next actions" },
  "urgent.no": { ko: "즉시보고 번호", vi: "Số báo cáo khẩn", en: "Immediate report number" },
  "urgent.occurred_at": { ko: "발생 일시", vi: "Thời điểm xảy ra", en: "Occurrence time" },
  "urgent.priority": { ko: "긴급도", vi: "Mức độ khẩn cấp", en: "Urgency" },
  "urgent.recipient": { ko: "보고 수신자", vi: "Người nhận báo cáo", en: "Report recipient" },
  "weekly.achievements": { ko: "금주 주요 실적", vi: "Kết quả nổi bật tuần này", en: "This week's achievements" },
  "weekly.milestones": { ko: "주요 공정일정", vi: "Mốc tiến độ chính", en: "Key milestones" },
  "weekly.next_week": { ko: "차주 작업계획", vi: "Kế hoạch tuần tới", en: "Next week's work" },
  "weekly.open_decisions": { ko: "미결정 사항", vi: "Các quyết định đang chờ", en: "Pending decisions" },
  "weekly.period": { ko: "보고 기간", vi: "Kỳ báo cáo", en: "Reporting period" },
  "weekly.progress": { ko: "공정 진도 현황", vi: "Tình hình tiến độ", en: "Progress status" },
  "weekly.quality": { ko: "품질관리 현황", vi: "Tình hình quản lý chất lượng", en: "Quality status" },
  "weekly.safety": { ko: "안전관리 현황", vi: "Tình hình quản lý an toàn", en: "Safety status" },
  "weekly.submittals": { ko: "제출·승인 현황", vi: "Tình hình trình duyệt / phê duyệt", en: "Submittal and approval status" },
  "weekly.summary": { ko: "금주 종합의견", vi: "Tổng hợp nhận xét tuần", en: "Weekly summary" },
  "work.discipline": { ko: "공종·분야", vi: "Bộ môn / công tác", en: "Discipline / work type" },
  "work.location": { ko: "작업 위치", vi: "Vị trí thi công", en: "Work location" },
} as const;

type FieldPath = keyof typeof formFieldLabels;
type FieldLocale = "ko" | "vi" | "en";

export function formFieldLabel(fieldPath: string, locale?: string): string {
  const labels = formFieldLabels[fieldPath as FieldPath];
  if (!labels) return fieldPath;
  const language = locale?.toLowerCase().split("-")[0];
  const resolved: FieldLocale =
    language === "vi" || language === "en" ? language : "ko";
  return labels[resolved];
}
