"""Locale-aware labels for immutable A4 document snapshots.

The form ID, field path, table path, and column keys remain schema identifiers.
Only their displayed labels and human-readable scalar formatting are localized.
Vietnamese and English wording is draft terminology pending field review.
"""
from datetime import datetime
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from hashlib import sha256
import re

from .engine import canonical, load

DOCUMENT_LOCALIZATION_VERSION = "document-labels/1"
SUPPORTED_LANGUAGES = ("ko", "vi", "en")

# Internal A4 and support-form titles. FM-09/10/11 statutory Vietnamese use is
# still decided by the existing render policy, not by this presentation catalog.
TITLE_TRANSLATIONS = {
    "FM-01": ("Bìa hồ sơ trình nộp của nhà thầu", "Contractor submittal cover sheet"),
    "FM-02": ("Phiếu xem xét biện pháp thi công", "Construction method review"),
    "FM-03": ("Phiếu xem xét bản vẽ thi công", "Shop drawing review"),
    "FM-04": ("Phiếu yêu cầu và xem xét phê duyệt vật liệu", "Material approval request and review"),
    "FM-05": ("Phiếu kiểm tra vật liệu đưa đến công trường", "Incoming material inspection"),
    "FM-06": ("Phiếu yêu cầu thử nghiệm · kiểm tra", "Test and inspection request"),
    "FM-07": ("Phiếu yêu cầu nghiệm thu", "Inspection request"),
    "FM-08": ("Bảng tự kiểm tra của nhà thầu", "Contractor self-inspection checklist"),
    "FM-09": ("Biên bản nghiệm thu công việc xây dựng", "Construction work acceptance record"),
    "FM-10": ("Biên bản nghiệm thu giai đoạn · bộ phận", "Stage · partial acceptance record"),
    "FM-11": ("Biên bản nghiệm thu hoàn thành", "Completion acceptance record"),
    "FM-12": ("Báo cáo điểm không phù hợp", "Nonconformity report"),
    "FM-13": ("Phiếu yêu cầu hành động khắc phục", "Corrective action request"),
    "FM-14": ("Chỉ thị hiện trường", "Site instruction"),
    "FM-15": ("Phiếu yêu cầu thông tin kỹ thuật", "Technical request for information"),
    "FM-16": ("Phiếu xem xét thay đổi thiết kế", "Design change review"),
    "FM-17": ("Phiếu xác nhận an toàn công việc rủi ro cao", "High-risk work safety check"),
    "FM-18": ("Nhật ký giám sát hằng ngày", "Daily supervision log"),
    "FM-19": ("Báo cáo giám sát hằng tuần", "Weekly supervision report"),
    "FM-20": ("Báo cáo khẩn gửi Chủ đầu tư", "Urgent Owner report"),
    "FM-21": ("Yêu cầu Chủ đầu tư ra quyết định", "Owner decision request"),
    "FM-22": ("Danh sách hạng mục chưa hoàn tất", "Open items list"),
    "FM-23": ("Bảng mức độ hoàn thiện hồ sơ hoàn công", "Completion dossier status"),
    "FM-24": ("Biên bản xác nhận bàn giao", "Handover verification"),
    "FM-25": ("Bảng theo dõi khiếm khuyết · bảo hành", "Defect and warranty tracking"),
    "FM-26": ("Phiếu xem xét · kiến nghị khối lượng và thanh toán", "Quantity and payment review · recommendation"),
    "FM-27": ("Phiếu xem xét tuân thủ · thử nghiệm · nghiệm thu PCCC", "Fire compliance, test and acceptance review"),
    "FM-28": ("Phiếu xem xét tuân thủ · đo đạc môi trường", "Environmental compliance and measurement review"),
    "FM-29": ("Phiếu xem xét thông báo hợp đồng · khiếu nại · EOT", "Contract notice · claim · EOT review"),
    "FM-30": ("Phiếu xem xét phạm vi áp dụng · tình trạng giấy phép", "Permit applicability and status review"),
    "FM-31": ("Phiếu xem xét rủi ro · bảo đảm · kiểm toán", "Risk · assurance · audit review"),
    "FM-32": ("Phiếu xem xét tuân thủ bảo hiểm · bảo lãnh", "Insurance and guarantee compliance review"),
    "FM-33": ("Phiếu xem xét kinh nghiệm · bài học", "Experience and lessons learned review"),
    "FM-34": ("Bìa phiếu chuyển giao tài liệu", "Document transmittal cover"),
    "FM-35": ("Phiếu xem xét bố trí nhân sự · năng lực", "Personnel and qualification deployment review"),
    "FM-36": ("Phiếu xác nhận sửa đổi bản vẽ · phát hành tại công trường", "Drawing revision and site distribution record"),
}

# The labels are keyed by declared scalar/table-column suffixes. They are
# display text only; no translated text is written into source DTOs.
FIELD_SUFFIX_LABELS = {
    "name": ("Tên", "Tên", "Name"),
    "project_name": ("프로젝트명", "Tên dự án", "Project name"),
    "package": ("공사 패키지", "Gói thầu", "Work package"),
    "discipline": ("공종·분야", "Bộ môn / công tác", "Discipline / work type"),
    "location": ("위치", "Vị trí", "Location"),
    "no": ("번호", "Số hiệu", "Number"),
    "no_rev": ("문서번호 · 개정", "Số hiệu · lần sửa đổi", "Document number · revision"),
    "type": ("유형", "Loại", "Type"),
    "status": ("상태", "Trạng thái", "Status"),
    "final_status": ("최종 상태", "Trạng thái cuối cùng", "Final status"),
    "comment": ("의견", "Nhận xét", "Comment"),
    "conclusion": ("종합 결론", "Kết luận", "Conclusion"),
    "due": ("처리 기한", "Hạn xử lý", "Due date"),
    "required_by": ("요청 기한", "Hạn yêu cầu", "Required by"),
    "date": ("일자", "Ngày", "Date"),
    "datetime": ("일시", "Ngày giờ", "Date and time"),
    "datetime_place": ("일시 · 장소", "Ngày giờ · địa điểm", "Date and location"),
    "submitted_at": ("제출 시각", "Thời điểm nộp", "Submitted at"),
    "requested_at": ("요청 시각", "Thời điểm yêu cầu", "Requested at"),
    "requested_inspection_at": ("희망 검측 시각", "Thời gian nghiệm thu đề nghị", "Requested inspection time"),
    "delivery_date": ("반입 일자", "Ngày giao đến công trường", "Delivery date"),
    "occurred_at": ("발생 일시", "Thời điểm xảy ra", "Occurrence time"),
    "closed_at": ("종결 시각", "Thời điểm đóng", "Closed at"),
    "issued_at": ("발행 시각", "Thời điểm phát hành", "Issued at"),
    "response_due": ("회신 기한", "Hạn phản hồi", "Response due"),
    "valid_to": ("유효 종료일", "Ngày hết hiệu lực", "Valid through"),
    "start": ("시작", "Bắt đầu", "Start"),
    "period": ("기간", "Kỳ", "Period"),
    "name": ("명칭", "Tên", "Name"),
    "title": ("제목", "Tiêu đề", "Title"),
    "description": ("내용", "Mô tả", "Description"),
    "note": ("비고", "Ghi chú", "Note"),
    "basis": ("근거", "Căn cứ", "Basis"),
    "basis_note": ("근거 설명", "Ghi chú căn cứ", "Basis note"),
    "evidence": ("증빙", "Minh chứng", "Evidence"),
    "attachments": ("첨부자료", "Tài liệu đính kèm", "Attachments"),
    "references": ("참조자료", "Tài liệu tham chiếu", "References"),
    "related": ("관련 기록", "Hồ sơ liên quan", "Related records"),
    "source": ("출처", "Nguồn", "Source"),
    "owner": ("담당자", "Người phụ trách", "Owner"),
    "recipient": ("수신자", "Người nhận", "Recipient"),
    "sender": ("발신자", "Người gửi", "Sender"),
    "to": ("수신 대상", "Người nhận", "To"),
    "role": ("역할", "Vai trò", "Role"),
    "issuer": ("발행기관", "Đơn vị phát hành", "Issuer"),
    "authority": ("관할 기관", "Cơ quan có thẩm quyền", "Authority"),
    "purpose": ("목적", "Mục đích", "Purpose"),
    "reason": ("사유", "Lý do", "Reason"),
    "cause": ("발생 원인", "Nguyên nhân", "Cause"),
    "root_cause": ("근본 원인", "Nguyên nhân gốc", "Root cause"),
    "fact": ("사실관계", "Sự việc", "Facts"),
    "impact": ("영향", "Ảnh hưởng", "Impact"),
    "cost_impact": ("비용 영향", "Ảnh hưởng chi phí", "Cost impact"),
    "time_impact": ("공기 영향", "Ảnh hưởng tiến độ", "Time impact"),
    "schedule_impact": ("공정 영향", "Ảnh hưởng tiến độ", "Schedule impact"),
    "priority": ("우선순위", "Mức độ ưu tiên", "Priority"),
    "description": ("상세 내용", "Mô tả chi tiết", "Description"),
    "action": ("조치", "Hành động", "Action"),
    "immediate_action": ("즉시 조치", "Hành động ngay", "Immediate action"),
    "corrective_action": ("시정조치", "Hành động khắc phục", "Corrective action"),
    "preventive_action": ("재발방지 조치", "Hành động phòng ngừa", "Preventive action"),
    "next_action": ("후속 조치", "Hành động tiếp theo", "Next action"),
    "recommendation": ("감리 권고", "Kiến nghị của tư vấn giám sát", "Supervision recommendation"),
    "recommendation_comment": ("추천 의견", "Nhận xét đề xuất", "Recommendation comments"),
    "decision": ("결정", "Quyết định", "Decision"),
    "owner_decision": ("발주처 결정", "Quyết định của Chủ đầu tư", "Owner decision"),
    "decision_required": ("결정 필요사항", "Nội dung cần quyết định", "Decision required"),
    "option_a": ("대안 A", "Phương án A", "Option A"),
    "option_b": ("대안 B", "Phương án B", "Option B"),
    "option_c": ("대안 C", "Phương án C", "Option C"),
    "result": ("결과", "Kết quả", "Result"),
    "comment": ("검토 의견", "Nhận xét xem xét", "Review comments"),
    "criteria": ("판정 기준", "Tiêu chí đánh giá", "Criteria"),
    "criterion": ("기준", "Tiêu chí", "Criterion"),
    "condition": ("조건", "Điều kiện", "Condition"),
    "conditions": ("조건사항", "Các điều kiện", "Conditions"),
    "method": ("방법", "Phương pháp", "Method"),
    "model": ("모델·규격", "Mẫu mã · quy cách", "Model / specification"),
    "qty_spec": ("수량 · 규격", "Khối lượng · quy cách", "Quantity · specification"),
    "cert": ("인증서", "Chứng chỉ", "Certificate"),
    "sample": ("시료", "Mẫu", "Sample"),
    "storage": ("보관상태", "Tình trạng bảo quản", "Storage condition"),
    "equipment": ("장비", "Thiết bị", "Equipment"),
    "witness": ("입회자", "Người chứng kiến", "Witness"),
    "lab": ("시험기관", "Phòng thí nghiệm", "Laboratory"),
    "test": ("시험", "Thử nghiệm", "Test"),
    "inspections": ("검측 내역", "Nội dung nghiệm thu", "Inspections"),
    "tests": ("시험 내역", "Nội dung thử nghiệm", "Tests"),
    "change": ("변경사항", "Thay đổi", "Change"),
    "changes": ("변경 내역", "Các thay đổi", "Changes"),
    "drawing": ("도면", "Bản vẽ", "Drawing"),
    "drawings": ("도면 목록", "Danh sách bản vẽ", "Drawings"),
    "design_drawings": ("설계 도면", "Bản vẽ thiết kế", "Design drawings"),
    "dimension": ("치수", "Kích thước", "Dimensions"),
    "clash": ("간섭", "Va chạm", "Clash"),
    "constructability": ("시공성", "Khả năng thi công", "Constructability"),
    "design": ("설계", "Thiết kế", "Design"),
    "quality": ("품질", "Chất lượng", "Quality"),
    "safety": ("안전", "An toàn", "Safety"),
    "schedule": ("공정", "Tiến độ", "Schedule"),
    "scope": ("범위", "Phạm vi", "Scope"),
    "work": ("작업내용", "Công việc", "Work"),
    "work_name": ("작업명", "Tên công việc", "Work name"),
    "work_type": ("작업 유형", "Loại công việc", "Work type"),
    "stage": ("단계", "Giai đoạn", "Stage"),
    "name": ("명칭", "Tên", "Name"),
    "status": ("상태", "Trạng thái", "Status"),
    "revision": ("개정", "Lần sửa đổi", "Revision"),
    "rev": ("개정번호", "Mã lần sửa đổi", "Revision"),
    "asbuilt": ("준공도서", "Hồ sơ hoàn công", "As-built records"),
    "dossier": ("준공서류", "Hồ sơ hoàn công", "Completion dossier"),
    "warranty": ("하자보증", "Bảo hành", "Warranty"),
    "om": ("운영 · 유지관리", "Vận hành · bảo trì", "Operation · maintenance"),
    "training": ("교육", "Đào tạo", "Training"),
    "legal": ("법정 서류", "Hồ sơ pháp lý", "Legal records"),
    "facility": ("시설", "Công trình", "Facility"),
    "testing": ("시험 · 시운전", "Thử nghiệm · chạy thử", "Testing · commissioning"),
    "ncr_closed": ("부적합 종결", "Điểm không phù hợp đã đóng", "NCR closed"),
    "pccc": ("소방", "Phòng cháy chữa cháy", "Fire protection"),
    "percent": ("완성도 (%)", "Mức độ hoàn thành (%)", "Completeness (%)"),
    "as_of": ("기준일", "Tính đến ngày", "As of"),
    "total": ("전체 건수", "Tổng số", "Total"),
    "critical": ("중요", "Nghiêm trọng", "Critical"),
    "issue": ("이슈", "Vấn đề", "Issue"),
    "recheck": ("재검측", "Nghiệm thu lại", "Recheck"),
    "apply": ("적용 여부", "Áp dụng", "Applicable"),
    "draft": ("초안", "Bản nháp", "Draft"),
    "sign": ("서명", "Chữ ký", "Signature"),
    "original": ("원본", "Bản gốc", "Original"),
    "digital": ("전자본", "Bản điện tử", "Digital copy"),
    "file": ("파일", "Tệp", "File"),
    "percent": ("완성도", "Mức độ hoàn thành", "Completeness"),
    "boq_item": ("BOQ 항목", "Hạng mục BOQ", "BOQ item"),
    "unit": ("단위", "Đơn vị", "Unit"),
    "contract_qty": ("계약 수량", "Khối lượng hợp đồng", "Contract quantity"),
    "claimed_qty": ("청구 수량", "Khối lượng yêu cầu", "Claimed quantity"),
    "verified_qty": ("검증 수량", "Khối lượng đã xác minh", "Verified quantity"),
    "previous_certified_qty": ("기승인 누계 수량", "Khối lượng lũy kế đã xác nhận trước đó", "Previously certified quantity"),
    "cumulative_verified_qty": ("검증 누계 수량", "Khối lượng lũy kế đã xác minh", "Cumulative verified quantity"),
    "verified_amount": ("검증 금액", "Giá trị đã xác minh", "Verified amount"),
    "variation_ref": ("변경 참조", "Mã tham chiếu thay đổi", "Variation reference"),
    "claimed_amount": ("청구 금액", "Giá trị yêu cầu", "Claimed amount"),
    "recommended_amount": ("추천 금액", "Giá trị đề xuất", "Recommended amount"),
    "approved_variation": ("승인 변경 금액", "Giá trị thay đổi đã duyệt", "Approved variation"),
    "material_on_site": ("현장 반입 자재", "Vật liệu tại công trường", "Materials on site"),
    "retention": ("유보금", "Tiền giữ lại", "Retention"),
    "advance_recovery": ("선급금 상계", "Thu hồi tạm ứng", "Advance recovery"),
    "other_deduction": ("기타 공제", "Khoản khấu trừ khác", "Other deduction"),
    "tax": ("세금", "Thuế", "Tax"),
    "blocked_disputed_amount": ("보류 · 분쟁 금액", "Giá trị tạm giữ · tranh chấp", "Blocked · disputed amount"),
    "owner_status": ("발주처 상태", "Trạng thái của Chủ đầu tư", "Owner status"),
    "claim_no": ("기성 신청 번호", "Số đề nghị thanh toán", "Payment claim number"),
    "boq_revision": ("BOQ 개정", "Lần sửa đổi BOQ", "BOQ revision"),
    "currency": ("통화", "Tiền tệ", "Currency"),
    "amount": ("금액", "Số tiền", "Amount"),
    "manufacturer_model": ("제조사 · 모델", "Nhà sản xuất · mẫu mã", "Manufacturer · model"),
    "approval_no": ("승인 번호", "Số phê duyệt", "Approval number"),
    "request_no": ("요청 번호", "Số yêu cầu", "Request number"),
    "request": ("요청", "Yêu cầu", "Request"),
    "question": ("질의 내용", "Nội dung câu hỏi", "Question"),
    "response": ("회신", "Phản hồi", "Response"),
    "proposal": ("제안", "Đề xuất", "Proposal"),
    "site_condition": ("현장 여건", "Điều kiện hiện trường", "Site condition"),
    "change_required": ("설계 변경 필요 여부", "Có cần thay đổi thiết kế", "Design change required"),
    "risk_assessment": ("위험성 평가", "Đánh giá rủi ro", "Risk assessment"),
    "work_type": ("작업 유형", "Loại công việc", "Work type"),
    "supervisor": ("감독자", "Người giám sát", "Supervisor"),
    "permission": ("허가 사항", "Giấy phép", "Permission"),
    "emergency": ("비상 대응", "Ứng phó khẩn cấp", "Emergency response"),
    "controls": ("통제 조치", "Biện pháp kiểm soát", "Controls"),
    "milestones": ("주요 공정일정", "Các mốc tiến độ", "Milestones"),
    "achievements": ("주요 실적", "Kết quả chính", "Achievements"),
    "next_week": ("차주 계획", "Kế hoạch tuần tới", "Next week's plan"),
    "open_decisions": ("미결 결정사항", "Quyết định đang chờ", "Open decisions"),
    "progress": ("공정 진도", "Tiến độ thực hiện", "Progress"),
    "submittals": ("제출 · 승인", "Trình duyệt · phê duyệt", "Submittals · approvals"),
    "summary": ("종합 의견", "Tóm tắt", "Summary"),
    "date_weather": ("일자 · 기상", "Ngày · thời tiết", "Date · weather"),
    "supervision_staff": ("감리 인력", "Nhân sự tư vấn giám sát", "Supervision staff"),
    "contractor_resources": ("시공사 투입자원", "Nguồn lực nhà thầu", "Contractor resources"),
    "coordination": ("협의 사항", "Nội dung phối hợp", "Coordination"),
    "next_day": ("익일 작업계획", "Kế hoạch ngày tiếp theo", "Next day's plan"),
    "urgent": ("긴급", "Khẩn cấp", "Urgent"),
    "recipient": ("보고 수신자", "Người nhận báo cáo", "Report recipient"),
    "occurred_at": ("발생 일시", "Thời điểm xảy ra", "Occurrence time"),
    "decision_due": ("결정 기한", "Hạn quyết định", "Decision deadline"),
    "decision_required": ("결정 요청사항", "Nội dung cần quyết định", "Decision required"),
    "immediate_action": ("즉시 조치사항", "Biện pháp xử lý ngay", "Immediate action"),
    "next_action": ("후속 조치계획", "Kế hoạch tiếp theo", "Next action"),
    "fire": ("소방", "Phòng cháy chữa cháy", "Fire protection"),
    "system": ("설비", "Hệ thống", "System"),
    "acceptance": ("수용 · 승인", "Chấp thuận · nghiệm thu", "Acceptance"),
    "design_approval": ("설계 승인", "Phê duyệt thiết kế", "Design approval"),
    "test_status": ("시험 상태", "Trạng thái thử nghiệm", "Test status"),
    "environment": ("환경", "Môi trường", "Environment"),
    "condition": ("조건", "Điều kiện", "Condition"),
    "monitoring_date": ("측정 일자", "Ngày quan trắc", "Monitoring date"),
    "criterion": ("기준값", "Giá trị tiêu chí", "Criterion"),
    "point": ("측정 지점", "Điểm đo", "Monitoring point"),
    "method": ("방법", "Phương pháp", "Method"),
    "event": ("사건", "Sự kiện", "Event"),
    "notice": ("통지", "Thông báo", "Notice"),
    "notice_no": ("통지 번호", "Số thông báo", "Notice number"),
    "notice_due": ("통지 기한", "Hạn thông báo", "Notice deadline"),
    "claim_status": ("클레임 상태", "Trạng thái khiếu nại", "Claim status"),
    "recommendation": ("검토 권고", "Kiến nghị xem xét", "Recommendation"),
    "assessment": ("평가", "Đánh giá", "Assessment"),
    "permit": ("인허가", "Giấy phép", "Permit"),
    "authority": ("관할 기관", "Cơ quan có thẩm quyền", "Authority"),
    "submitted_at": ("제출 시각", "Thời điểm nộp", "Submitted at"),
    "condition": ("조건", "Điều kiện", "Condition"),
    "assurance": ("보증·확인", "Bảo đảm", "Assurance"),
    "risk_rating": ("위험 등급", "Mức rủi ro", "Risk rating"),
    "finding": ("지적사항", "Phát hiện", "Finding"),
    "verification": ("검증", "Xác minh", "Verification"),
    "guarantee": ("보증", "Bảo lãnh", "Guarantee"),
    "number": ("번호", "Số hiệu", "Number"),
    "lesson": ("교훈", "Bài học", "Lesson"),
    "applicability": ("적용성", "Khả năng áp dụng", "Applicability"),
    "effectiveness": ("효과성", "Hiệu quả", "Effectiveness"),
    "statement": ("내용", "Nội dung", "Statement"),
    "transmittal": ("송수신", "Chuyển giao", "Transmittal"),
    "purpose": ("목적", "Mục đích", "Purpose"),
    "qualification": ("자격", "Năng lực", "Qualification"),
    "personnel": ("인력", "Nhân sự", "Personnel"),
    "deployment": ("배치", "Bố trí", "Deployment"),
    "release_status": ("배포 상태", "Trạng thái phát hành", "Release status"),
    "distribution_status": ("현장 배포 상태", "Trạng thái phân phối tại công trường", "Site distribution status"),
    "issued_for": ("발행 목적", "Mục đích phát hành", "Issued for"),
    "revision": ("개정", "Lần sửa đổi", "Revision"),
    "recipient": ("수신자", "Người nhận", "Recipient"),
    "receipt": ("수령 상태", "Trạng thái nhận", "Receipt status"),
    "response": ("회신", "Phản hồi", "Response"),
    "approved_variation": ("승인 변경", "Thay đổi đã duyệt", "Approved variation"),
    "item": ("항목", "Hạng mục", "Item"),
    "value": ("값", "Giá trị", "Value"),
    "submission": ("제출", "Hồ sơ trình", "Submission"),
    "requirement": ("요구사항", "Yêu cầu", "Requirement"),
    "status": ("상태", "Trạng thái", "Status"),
    "source": ("출처", "Nguồn", "Source"),
    "name": ("명칭", "Tên", "Name"),
    "area": ("구역", "Khu vực", "Area"),
    "as_of": ("기준일", "Tính đến ngày", "As of"),
    "total": ("전체 수", "Tổng số", "Total"),
    "critical": ("중요", "Nghiêm trọng", "Critical"),
    "issue": ("이슈", "Vấn đề", "Issue"),
    "open": ("미결", "Chưa hoàn tất", "Open"),
    "owner": ("담당자", "Người phụ trách", "Owner"),
    "due": ("처리 기한", "Hạn xử lý", "Due date"),
    "recheck": ("재검측", "Nghiệm thu lại", "Recheck"),
    "payment": ("지급", "Thanh toán", "Payment"),
    "close_status": ("종결 상태", "Trạng thái đóng", "Closure status"),
    "closed_at": ("종결 시각", "Thời điểm đóng", "Closed at"),
    "root_cause": ("근본 원인", "Nguyên nhân gốc", "Root cause"),
    "corrective_action": ("시정조치", "Hành động khắc phục", "Corrective action"),
    "preventive_action": ("재발방지 조치", "Hành động phòng ngừa", "Preventive action"),
    "no": ("번호", "Số hiệu", "Number"),
    "owner_decision": ("발주처 결정", "Quyết định của Chủ đầu tư", "Owner decision"),
    "blocked_disputed_amount": ("보류 · 분쟁 금액", "Giá trị tạm giữ · tranh chấp", "Blocked · disputed amount"),
    "material_on_site": ("현장 반입 자재", "Vật liệu tại công trường", "Materials on site"),
    "boq_revision": ("BOQ 개정", "Lần sửa đổi BOQ", "BOQ revision"),
    "claim_no": ("기성 신청 번호", "Số đề nghị thanh toán", "Payment claim number"),
    "claimed_amount": ("청구 금액", "Giá trị yêu cầu", "Claimed amount"),
    "verified_amount": ("검증 금액", "Giá trị đã xác minh", "Verified amount"),
    "recommended_amount": ("추천 금액", "Giá trị đề xuất", "Recommended amount"),
    "period": ("기간", "Kỳ", "Period"),
}

# Exact paths keep established form terms and statutory field meaning ahead of
# shorter generic labels derived from schema field names.
COMMON_FIELD_LABELS = {
    "project.name": ("프로젝트명", "Tên dự án", "Project name"),
    "contract.package": ("공사 패키지", "Gói thầu thi công", "Work package"),
    "work.discipline": ("공종·분야", "Bộ môn / công tác", "Discipline / work type"),
    "work.location": ("작업 위치", "Vị trí thi công", "Work location"),
    "inspection.no": ("검측기록 번호", "Số biên bản nghiệm thu", "Inspection record number"),
    "inspection.work_name": ("검측 공종·작업명", "Hạng mục / công tác nghiệm thu", "Work item for inspection"),
    "inspection.place": ("검측 장소", "Địa điểm nghiệm thu", "Inspection location"),
    "inspection.datetime": ("검측 일시", "Thời gian nghiệm thu", "Inspection date and time"),
    "inspection.requested_at": ("요청 시각", "Thời điểm yêu cầu", "Request time"),
    "inspection.requested_inspection_at": ("희망 검측 시각", "Thời gian nghiệm thu đề nghị", "Requested inspection time"),
    "inspection.request_no": ("검측 요청 번호", "Số yêu cầu nghiệm thu", "Inspection request number"),
    "inspection.requested_at": ("검측 요청 시각", "Thời điểm yêu cầu nghiệm thu", "Inspection request time"),
    "inspection.self_result": ("시공사 자체 검측 결과", "Kết quả tự nghiệm thu của nhà thầu", "Contractor self-inspection result"),
    "inspection.checklist_code": ("자체 검측표 코드", "Mã bảng tự kiểm tra", "Self-inspection checklist code"),
    "inspection.attachments": ("첨부 증빙", "Minh chứng đính kèm", "Attached evidence"),
    "test.inspection_no": ("연결 검측 번호", "Số biên bản nghiệm thu liên quan", "Related inspection number"),
    "ncr.owner_report": ("발주처 보고사항", "Nội dung báo cáo Chủ đầu tư", "Owner reporting"),
    "instruction.design_change": ("설계 변경 필요 여부", "Yêu cầu thay đổi thiết kế", "Design change required"),
    "result.status": ("검측 결과", "Kết quả nghiệm thu", "Inspection result"),
    "result.next_work_allowed": ("후속공정 진행 허용", "Cho phép công việc tiếp theo", "Follow-on work authorized"),
    "result.corrections": ("시정 필요사항", "Nội dung cần khắc phục", "Required corrections"),
    "basis.drawings": ("적용 도면", "Bản vẽ áp dụng", "Applicable drawings"),
    "basis.criteria": ("검측 기준", "Tiêu chí nghiệm thu", "Acceptance criteria"),
    "basis.tests": ("시험·측정자료", "Kết quả thử nghiệm · đo đạc", "Test and measurement records"),
    "basis.attachments": ("첨부자료", "Tài liệu đính kèm", "Attachments"),
    "urgent.no": ("즉시보고 번호", "Số báo cáo khẩn", "Urgent report number"),
    "urgent.occurred_at": ("발생 일시", "Thời điểm xảy ra", "Occurrence time"),
    "urgent.priority": ("긴급도", "Mức độ khẩn cấp", "Urgency"),
    "urgent.recipient": ("보고 수신자", "Người nhận báo cáo", "Report recipient"),
    "urgent.fact": ("긴급 상황·사실관계", "Tình hình khẩn cấp và sự việc", "Urgent facts"),
    "urgent.cause": ("발생 원인", "Nguyên nhân phát sinh", "Cause"),
    "urgent.impact": ("품질·공정·비용 영향", "Ảnh hưởng chất lượng · tiến độ · chi phí", "Quality, time and cost impacts"),
    "urgent.immediate_action": ("긴급 조치사항", "Biện pháp xử lý khẩn cấp", "Immediate actions"),
    "urgent.next_action": ("후속조치 계획", "Kế hoạch xử lý tiếp theo", "Next actions"),
    "urgent.decision_required": ("발주처 결정 필요사항", "Nội dung cần Chủ đầu tư quyết định", "Owner decision required"),
    "urgent.decision_due": ("결정 필요기한", "Hạn cần ra quyết định", "Decision due date"),
    "decision.no": ("결정요청 번호", "Số yêu cầu quyết định", "Decision request number"),
    "decision.date": ("결정요청일", "Ngày yêu cầu quyết định", "Request date"),
    "decision.due": ("결정기한", "Hạn quyết định", "Decision deadline"),
    "decision.issue": ("결정 요청사항", "Vấn đề cần quyết định", "Decision required"),
    "decision.impact": ("미결정 시 영향", "Ảnh hưởng nếu chưa quyết định", "Impact if undecided"),
    "decision.option_a": ("대안 A", "Phương án A", "Option A"),
    "decision.option_b": ("대안 B", "Phương án B", "Option B"),
    "decision.option_c": ("대안 C", "Phương án C", "Option C"),
    "decision.recommendation": ("감리 검토의견", "Kiến nghị của tư vấn giám sát", "Supervision recommendation"),
    "decision.result": ("발주처 결정", "Quyết định của Chủ đầu tư", "Owner decision"),
    "decision.decided_at": ("결정 시각", "Thời điểm quyết định", "Decision time"),
    "weekly.period": ("보고 기간", "Kỳ báo cáo", "Reporting period"),
    "weekly.progress": ("공정 진도 현황", "Tình hình tiến độ", "Progress status"),
    "weekly.milestones": ("주요 공정일정", "Các mốc tiến độ chính", "Key milestones"),
    "weekly.achievements": ("금주 주요 실적", "Kết quả nổi bật tuần này", "This week's achievements"),
    "weekly.next_week": ("차주 작업계획", "Kế hoạch tuần tới", "Next week's work"),
    "weekly.quality": ("품질관리 현황", "Tình hình quản lý chất lượng", "Quality status"),
    "weekly.safety": ("안전관리 현황", "Tình hình quản lý an toàn", "Safety status"),
    "weekly.submittals": ("제출·승인 현황", "Tình hình trình duyệt · phê duyệt", "Submittal and approval status"),
    "weekly.open_decisions": ("미결정 사항", "Các quyết định đang chờ", "Pending decisions"),
    "weekly.summary": ("금주 종합의견", "Tổng hợp nhận xét tuần", "Weekly summary"),
    "review.intent": ("설계 의도 부합", "Phù hợp với ý đồ thiết kế", "Design intent compliance"),
    "review.equivalence": ("동등성 검토", "Đánh giá tính tương đương", "Equivalence review"),
    "review.spec": ("규격 확인", "Kiểm tra quy cách", "Specification check"),
    "review.ncr_no": ("부적합 보고서 번호", "Số báo cáo không phù hợp", "NCR number"),
    "precheck.self_check": ("시공사 자체 확인 완료", "Nhà thầu đã tự kiểm tra", "Contractor self-check complete"),
    "precheck.material": ("자재 확인", "Kiểm tra vật liệu", "Material check"),
    "precheck.previous": ("선행 공정 확인", "Kiểm tra công việc trước", "Previous work check"),
    "lesson.context": ("교훈 발생 맥락", "Bối cảnh rút ra bài học", "Lesson context"),
    "handover.parties": ("인수인계 당사자", "Các bên bàn giao", "Handover parties"),
    "completion.design_compliance": ("설계 적합성", "Tuân thủ thiết kế", "Design compliance"),
    "fire.issue_status": ("소방 지적사항 상태", "Trạng thái vấn đề PCCC", "Fire issue status"),
    "drawing.approval_status": ("도면 승인 상태", "Trạng thái phê duyệt bản vẽ", "Drawing approval status"),
    "change.cost": ("비용 영향", "Ảnh hưởng chi phí", "Cost impact"),
    "change.rfi": ("연결 기술질의", "Yêu cầu thông tin liên quan", "Related RFI"),
}

# More specific meanings for corrective-action and payment forms take
# precedence over the shared form terms above.
FORM_FIELD_LABELS = {
    "FM-13": {
        "car.ncr_no": ("부적합 번호", "Số điểm không phù hợp", "NCR number"),
        "car.no": ("시정조치 번호", "Số yêu cầu khắc phục", "Corrective action number"),
        "car.owner": ("조치 담당자", "Người phụ trách khắc phục", "Action owner"),
        "car.due": ("조치 완료기한", "Hạn hoàn thành khắc phục", "Correction due date"),
        "car.root_cause": ("근본 원인", "Nguyên nhân gốc", "Root cause"),
        "car.corrective_action": ("시정조치 내용", "Nội dung khắc phục", "Corrective action"),
        "car.preventive_action": ("재발방지 대책", "Biện pháp phòng ngừa tái diễn", "Preventive action"),
        "car.evidence": ("조치 증빙", "Minh chứng khắc phục", "Corrective evidence"),
        "car.reinspection": ("재검측 결과", "Kết quả nghiệm thu lại", "Reinspection result"),
        "car.close_status": ("종결 상태", "Trạng thái đóng", "Closure status"),
        "car.closed_at": ("종결 일시", "Thời điểm đóng", "Closure date and time"),
    },
    "FM-26": {
        "payment.claim_no": ("기성 신청 번호", "Số đề nghị thanh toán", "Payment claim number"),
        "payment.period": ("기성 기간", "Kỳ thanh toán", "Payment period"),
        "payment.boq_revision": ("계약 BOQ 개정", "Lần sửa đổi BOQ hợp đồng", "Contract BOQ revision"),
        "payment.currency": ("통화", "Tiền tệ", "Currency"),
        "payment.claimed_amount": ("청구 금액", "Giá trị yêu cầu", "Claimed amount"),
        "payment.verified_amount": ("검증 금액", "Giá trị đã xác minh", "Verified amount"),
        "payment.recommended_amount": ("지급 추천 금액", "Giá trị đề xuất thanh toán", "Recommended payment amount"),
        "payment.approved_variation": ("승인된 변경 금액", "Giá trị thay đổi đã duyệt", "Approved variation amount"),
        "payment.material_on_site": ("현장 반입 자재 금액", "Giá trị vật liệu tại công trường", "Materials on site amount"),
        "payment.retention": ("유보금", "Tiền giữ lại", "Retention"),
        "payment.advance_recovery": ("선급금 상계", "Thu hồi tạm ứng", "Advance recovery"),
        "payment.other_deduction": ("기타 공제", "Khoản khấu trừ khác", "Other deduction"),
        "payment.tax": ("세금", "Thuế", "Tax"),
        "payment.blocked_disputed_amount": ("보류 · 분쟁 금액", "Giá trị tạm giữ · tranh chấp", "Blocked · disputed amount"),
        "payment.recommendation_comment": ("감리 추천 의견", "Nhận xét đề xuất của tư vấn giám sát", "Supervision recommendation comments"),
        "payment.owner_status": ("발주처 결정 상태", "Trạng thái quyết định của Chủ đầu tư", "Owner decision status"),
        "items.boq_item": ("BOQ 항목", "Hạng mục BOQ", "BOQ item"),
        "items.description": ("항목 설명", "Mô tả hạng mục", "Item description"),
        "items.unit": ("단위", "Đơn vị", "Unit"),
        "items.contract_qty": ("계약 수량", "Khối lượng hợp đồng", "Contract quantity"),
        "items.claimed_qty": ("청구 수량", "Khối lượng yêu cầu", "Claimed quantity"),
        "items.verified_qty": ("검증 수량", "Khối lượng đã xác minh", "Verified quantity"),
        "items.previous_certified_qty": ("기승인 누계 수량", "Khối lượng lũy kế đã xác nhận trước đó", "Previously certified quantity"),
        "items.cumulative_verified_qty": ("검증 누계 수량", "Khối lượng lũy kế đã xác minh", "Cumulative verified quantity"),
        "items.verified_amount": ("검증 금액", "Giá trị đã xác minh", "Verified amount"),
        "items.variation_ref": ("변경 참조", "Mã tham chiếu thay đổi", "Variation reference"),
        "items.basis_note": ("검증 근거", "Ghi chú căn cứ xác minh", "Verification basis"),
    },
}


@lru_cache(maxsize=1)
def _form_catalogs():
    templates = {item["id"]: item for item in load("forms/form_templates_v1.json")["templates"]}
    schemas = load("forms/form_data_schemas_v1.json")["forms"]
    return templates, schemas


def _language(language):
    code = str(language or "ko").lower().replace("_", "-").split("-", 1)[0]
    if code not in SUPPORTED_LANGUAGES:
        raise ValueError("Unsupported document label language")
    return code


def _field_label(form_id, path, language):
    labels = FORM_FIELD_LABELS.get(form_id, {}).get(path)
    if labels is None:
        labels = COMMON_FIELD_LABELS.get(path)
    if labels is not None:
        return labels[SUPPORTED_LANGUAGES.index(language)], False
    suffix = path.rsplit(".", 1)[-1]
    labels = FIELD_SUFFIX_LABELS.get(suffix)
    if labels is not None:
        return labels[SUPPORTED_LANGUAGES.index(language)], False
    # Keep identifiers out of the rendered document when a new schema field is
    # added before a human term is reviewed. Report this key for follow-up.
    fallback = ("추가 기재사항", "Thông tin bổ sung", "Additional information")
    return fallback[SUPPORTED_LANGUAGES.index(language)], True


def document_localization(form_id, language):
    """Return a stable labels-only catalog for a form and output language."""
    language = _language(language)
    templates, schemas = _form_catalogs()
    if form_id not in templates or form_id not in schemas:
        raise KeyError("Unknown form ID")
    template, schema = templates[form_id], schemas[form_id]
    ko_title = template["title"]
    vi_title, en_title = TITLE_TRANSLATIONS.get(form_id, (ko_title, ko_title))
    title = {"ko": ko_title, "vi": vi_title, "en": en_title}[language]
    fields = {}
    fallback_fields = []
    for path in schema["scalar_fields"]:
        fields[path], fallback = _field_label(form_id, path, language)
        if fallback:
            fallback_fields.append(path)
    tables = []
    for table in schema["tables"]:
        columns = []
        for column in table["columns"]:
            path = f"{table['path']}.{column}"
            label, fallback = _field_label(form_id, path, language)
            fields[path] = label
            columns.append({"key": column, "label": label})
            if fallback:
                fallback_fields.append(path)
        tables.append({"path": table["path"], "columns": columns})
    body = {
        "version": DOCUMENT_LOCALIZATION_VERSION,
        "language": language,
        "reviewStatus": "approved_master" if language == "ko" else "draft_pending_local_review",
        "formId": form_id,
        "title": title,
        "fields": fields,
        "tables": tables,
        "fallbackFields": sorted(set(fallback_fields)),
    }
    body["sha256"] = sha256(canonical(body)).hexdigest()
    return body


def format_document_value(value, language, field_type=None, field_path="", currency=None):
    """Format date/decimal values for output without changing source payloads."""
    language = _language(language)
    if not isinstance(value, (str, int, float, Decimal)) or isinstance(value, bool):
        return str(value)
    raw = str(value)
    if field_type == "date-time":
        try:
            stamp = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return raw
        if language == "ko":
            return stamp.strftime("%Y.%m.%d %H:%M")
        if language == "vi":
            return stamp.strftime("%H:%M %d/%m/%Y")
        return stamp.strftime("%m/%d/%Y %I:%M %p")
    if re.search(r"(?:amount|cost|tax|deduction|retention|recovery)$", field_path):
        try:
            number = Decimal(raw)
        except InvalidOperation:
            return raw
        negative = number < 0
        number = abs(number)
        normalized = format(number, "f")
        whole, dot, fraction = normalized.partition(".")
        grouped = f"{int(whole):,}"
        if language == "vi":
            grouped = grouped.replace(",", ".")
            fraction = fraction.rstrip("0")
            formatted = grouped + (("," + fraction) if fraction else "")
        else:
            fraction = fraction.rstrip("0")
            formatted = grouped + (("." + fraction) if fraction else "")
        if negative:
            formatted = "-" + formatted
        return f"{formatted} {currency}" if currency else formatted
    return raw
