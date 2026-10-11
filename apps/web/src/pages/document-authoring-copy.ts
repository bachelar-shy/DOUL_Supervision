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
  sessionSaved: string;
  sessionSaveFailed: string;
  sessionRestored: string;
  sessionDiscard: string;
}> = {
  ko: {
    noSource: "이 양식의 원본 기록이 없습니다. 해당 업무에서 기록을 먼저 작성하거나 접근 권한을 확인하십시오.",
    chooseSource: "원본 기록을 직접 선택하십시오. 자동 선택하지 않습니다.",
    downloading: "다운로드 중…",
    download: "다운로드",
    exportUnavailable: "PDF/DOCX 출력 엔진이 설치되지 않았습니다. 관리자에게 운영 환경 설정을 요청하십시오.",
    exportFailed: "문서를 다운로드하지 못했습니다. 접근 권한과 연결 상태를 확인하십시오.",
    signatureNote: "다운로드 파일은 보존된 문서의 출력 사본이며 원본 서명·법정 인증이 이전되지는 않습니다.",
    sessionSaved: "작성 중인 내용은 이 브라우저 탭에 임시 보관됩니다. 공식 문서 발행은 별개입니다.",
    sessionSaveFailed: "브라우저 임시저장이 실패했습니다. 화면을 이동하거나 새로고침하면 작성 내용이 사라질 수 있습니다. 필요한 내용을 다른 곳에 복사하십시오.",
    sessionRestored: "이전 작성 내용을 복원했습니다. 원본 기록과 작성 차수를 확인하십시오.",
    sessionDiscard: "임시 작성 내용 삭제",
  },
  vi: {
    noSource: "Chưa có hồ sơ nguồn phù hợp. Hãy tạo hồ sơ liên quan hoặc kiểm tra quyền truy cập.",
    chooseSource: "Chọn hồ sơ nguồn; không chọn tự động.",
    downloading: "Đang tải xuống…",
    download: "Tải xuống",
    exportUnavailable: "Chưa cài đặt bộ xuất PDF/DOCX. Vui lòng liên hệ quản trị viên.",
    exportFailed: "Không tải được tài liệu. Kiểm tra quyền truy cập và kết nối.",
    signatureNote: "Bản tải về là bản sao của hồ sơ đã lưu; chữ ký và hiệu lực pháp lý không tự chuyển sang bản này.",
    sessionSaved: "Nội dung đang soạn chỉ được lưu tạm trong tab trình duyệt này, chưa phát hành hồ sơ.",
    sessionSaveFailed: "Không thể lưu bản nháp trong trình duyệt. Dữ liệu có thể mất nếu rời trang hoặc tải lại. Hãy sao chép nội dung cần giữ.",
    sessionRestored: "Đã khôi phục bản nháp. Hãy kiểm tra lại hồ sơ nguồn và phiên bản.",
    sessionDiscard: "Xóa nội dung tạm",
  },
  en: {
    noSource: "No eligible source record. Create the related record first or check your access.",
    chooseSource: "Select a source record explicitly.",
    downloading: "Downloading…",
    download: "Download",
    exportUnavailable: "The PDF/DOCX export runtime is not installed. Ask an administrator to configure it.",
    exportFailed: "Document download failed. Check your access and connection.",
    signatureNote: "The downloaded file is a derivative. Legal signatures are not transferred.",
    sessionSaved: "Unsubmitted content is saved temporarily in this browser tab; not formally issued.",
    sessionSaveFailed: "Browser draft storage failed. This input may be lost if you navigate away or reload. Copy any text you need to keep.",
    sessionRestored: "Previous input restored. Verify the source record and version.",
    sessionDiscard: "Discard temporary input",
  },
};
