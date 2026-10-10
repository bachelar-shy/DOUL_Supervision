export const documentRenderCopy = {
  ko: {
    language: "문서 출력 언어", mode: "렌더링 종류", draft: "초안 렌더", final: "최종 확인 당시 기록 렌더",
    finalButton: "최종 HTML 확인 당시 기록 생성", draftStatus: "초안 · 법정 발행본 아님", yes: "예", no: "아니요",
    finalStatus: "최종 확인 당시 기록 · 서명은 별도 절차", noFinalData: "최종 렌더에 필요한 항목을 모두 입력하세요.",
    genericError: "문서 렌더를 완료할 수 없습니다. 입력과 연결을 확인한 뒤 다시 시도하세요.",
  },
  vi: {
    language: "Ngôn ngữ tài liệu", mode: "Loại kết xuất", draft: "Kết xuất bản nháp", final: "Kết xuất ảnh chụp cuối cùng",
    finalButton: "Tạo ảnh chụp HTML cuối cùng", draftStatus: "Bản nháp · Chưa phải hồ sơ pháp lý được phát hành", yes: "Có", no: "Không",
    finalStatus: "Ảnh chụp cuối cùng · Cần quy trình ký riêng", noFinalData: "Hãy điền tất cả các trường cần thiết để kết xuất bản cuối cùng.",
    genericError: "Không thể hoàn tất kết xuất tài liệu. Hãy kiểm tra thông tin và liên kết rồi thử lại.",
  },
  en: {
    language: "Document output language", mode: "Render type", draft: "Render draft", final: "Render final snapshot",
    finalButton: "Generate final HTML snapshot", draftStatus: "Draft · Not a legally issued record", yes: "Yes", no: "No",
    finalStatus: "Final snapshot · Signing is a separate step", noFinalData: "Complete every required field before rendering a final snapshot.",
    genericError: "The document could not be rendered. Check the inputs and source, then try again.",
  },
} as const;

export const documentOutputLanguageLabels = {
  ko: "한국어 · Korean",
  vi: "Tiếng Việt · Vietnamese",
  en: "English",
} as const;
