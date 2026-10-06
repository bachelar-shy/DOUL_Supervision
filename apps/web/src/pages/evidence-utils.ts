export function evidenceMediaLabel(value: unknown) {
  const labels: Record<string, string> = {
    photo: "사진",
    video: "영상",
    audio: "음성",
    document: "문서",
    measurement: "측정",
  };
  return typeof value === "string" && value.trim()
    ? labels[value] || value
    : "유형 미상";
}

export function evidenceSourceLabel(value: unknown) {
  return value === "derived"
    ? "파생 증빙"
    : value === "original"
      ? "원본 증빙"
      : "출처 확인 필요";
}
