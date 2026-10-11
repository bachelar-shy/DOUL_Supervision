type Locale = "ko" | "vi" | "en";

export const documentFormNames: Record<string, Record<Locale, string>> = {
  "FM-02": { ko: "시공계획 검토서", vi: "Phiếu kiểm tra biện pháp thi công", en: "Construction method review" },
  "FM-13": { ko: "시정조치서", vi: "Phiếu khắc phục", en: "Corrective action form" },
  "FM-15": { ko: "기술질의서", vi: "Phiếu yêu cầu thông tin kỹ thuật", en: "Technical inquiry form" },
};

export const documentAuthoringCopy: Record<Locale, {
  noSource: string;
  chooseSource: string;
  downloading: string;
  download: string;
  exportUnavailable: string;
  exportFailed: string;
  signatureNote: string;
}> = {
  ko: {
    noSource: "이 양식의 원본 기록이 없습니다. 해당 업무에서 기록을 먼저 작성하거나 접근 권한을 확인하십시오.",
    chooseSource: "원본 기록을 직접 선택하십시오. 자동 선택하지 않습니다.",
    downloading: "다운로드 중…",
    download: "다운로드",
    exportUnavailable: "PDF/DOCX 출력 엔진이 설치되지 않았습니다. 관리자에게 운영 환경 설정을 요청하십시오.",
    exportFailed: "문서를 다운로드하지 못했습니다. 접근 권한과 연결 상태를 확인하십시오.",
    signatureNote: "다운로드 파일은 보존된 문서의 출력 사본이며 원본 서명·법정 인증이 이전되지는 않습니다.",
  },
  vi: {
    noSource: "Chưa có hồ sơ nguồn phù hợp. Hãy tạo hồ sơ liên quan hoặc kiểm tra quyền truy cập.",
    chooseSource: "Chọn hồ sơ nguồn; không chọn tự động.",
    downloading: "Đang tải xuống…",
    download: "Tải xuống",
    exportUnavailable: "Chưa cài đặt bộ xuất PDF/DOCX. Vui lòng liên hệ quản trị viên.",
    exportFailed: "Không tải được tài liệu. Kiểm tra quyền truy cập và kết nối.",
    signatureNote: "Bản tải về là bản sao của hồ sơ đã lưu; chữ ký và hiệu lực pháp lý không tự chuyển sang bản này.",
  },
  en: {
    noSource: "No eligible source record. Create the related record first or check your access.",
    chooseSource: "Select a source record explicitly.",
    downloading: "Downloading…",
    download: "Download",
    exportUnavailable: "The PDF/DOCX export runtime is not installed. Ask an administrator to configure it.",
    exportFailed: "Document download failed. Check your access and connection.",
    signatureNote: "The downloaded file is a derivative. Legal signatures are not transferred.",
  },
};
