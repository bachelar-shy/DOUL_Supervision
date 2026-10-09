export type ActionAuthoringLabelKey =
  | "heading" | "description" | "scope" | "project" | "package" | "location" | "discipline" | "organization"
  | "authority" | "title" | "relatedIssue" | "selectIssue" | "noIssues" | "assignee" | "unassigned" | "noContractors"
  | "dueAt" | "draftOnly" | "create" | "saving" | "created" | "newAction" | "required" | "offline" | "preview" | "unavailable";

export const actionAuthoringTranslations: Record<"en" | "ko" | "vi", Record<ActionAuthoringLabelKey, string>> = {
  en: {
    heading: "Create an Action draft",
    description: "Select the related Issue and record the corrective work, assignee, and due date for this project.",
    scope: "Work scope", project: "Project", package: "Package", location: "Location", discipline: "Discipline", organization: "Responsible organization",
    authority: "Creation authority", title: "Action title", relatedIssue: "Related Issue", selectIssue: "Select a readable Issue", noIssues: "No readable Issues are available in this workspace.",
    assignee: "Assignee", unassigned: "Select a contractor", noContractors: "No readable contractor participants are available.", dueAt: "Due date", draftOnly: "Saving creates an Action record. It does not assign, start, submit, verify, or close the Action; those transitions remain server-authorized.",
    create: "Save Action draft", saving: "Saving…", created: "Action draft created.", newAction: "Create another Action", required: "Enter a title, select a readable Issue, and provide the assignee and due date.",
    offline: "Reconnect before creating an Action.", preview: "Actions cannot be created on the server in preview mode.", unavailable: "Action creation is unavailable for this role and scope.",
  },
  ko: {
    heading: "Action 초안 작성",
    description: "관련 Issue를 선택하고 이 프로젝트의 시정조치, 담당자와 기한을 기록합니다.",
    scope: "작업 범위", project: "프로젝트", package: "패키지", location: "위치", discipline: "분야", organization: "담당 조직",
    authority: "생성 권한", title: "Action 제목", relatedIssue: "관련 Issue", selectIssue: "열람 가능한 Issue 선택", noIssues: "현재 작업공간에서 열람 가능한 Issue가 없습니다.",
    assignee: "담당자", unassigned: "시공자 선택", noContractors: "열람 가능한 시공자 참여자가 없습니다.", dueAt: "기한", draftOnly: "저장하면 Action 기록이 생성됩니다. 배정, 착수, 제출, 검증 또는 종결은 수행하지 않으며 각 전이는 서버 권한에 따라 처리됩니다.",
    create: "Action 초안 저장", saving: "저장 중…", created: "Action 초안을 생성했습니다.", newAction: "다른 Action 작성", required: "제목과 열람 가능한 Issue를 선택하고 담당자와 기한을 입력하십시오.",
    offline: "연결 후 Action을 생성할 수 있습니다.", preview: "미리보기에서는 서버 Action을 생성할 수 없습니다.", unavailable: "현재 역할과 범위에서 Action 생성이 제공되지 않습니다.",
  },
  vi: {
    heading: "Tạo bản nháp Action",
    description: "Chọn Issue liên quan và ghi nhận công việc khắc phục, người phụ trách và hạn hoàn thành cho dự án này.",
    scope: "Phạm vi công việc", project: "Dự án", package: "Gói công việc", location: "Vị trí", discipline: "Chuyên ngành", organization: "Tổ chức phụ trách",
    authority: "Quyền tạo", title: "Tiêu đề Action", relatedIssue: "Issue liên quan", selectIssue: "Chọn Issue có thể xem", noIssues: "Không có Issue nào có thể xem trong không gian làm việc này.",
    assignee: "Người phụ trách", unassigned: "Chọn nhà thầu", noContractors: "Không có người tham gia nhà thầu nào có thể xem.", dueAt: "Hạn hoàn thành", draftOnly: "Lưu sẽ tạo hồ sơ Action. Thao tác này không phân công, bắt đầu, gửi, xác minh hoặc đóng Action; máy chủ kiểm soát các bước đó.",
    create: "Lưu bản nháp Action", saving: "Đang lưu…", created: "Đã tạo bản nháp Action.", newAction: "Tạo Action khác", required: "Nhập tiêu đề, chọn Issue có thể xem, người phụ trách và hạn hoàn thành.",
    offline: "Hãy kết nối lại trước khi tạo Action.", preview: "Không thể tạo Action trên máy chủ ở chế độ xem trước.", unavailable: "Vai trò và phạm vi hiện tại chưa được phép tạo Action.",
  },
};
