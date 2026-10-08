import i18n from "../i18n/config";

export function evidenceMediaLabel(value: unknown) {
  const labels: Record<string, string> = {
    photo: i18n.t("evidence.media.photo"),
    video: i18n.t("evidence.media.video"),
    audio: i18n.t("evidence.media.audio"),
    document: i18n.t("evidence.media.document"),
    measurement: i18n.t("evidence.media.measurement"),
  };
  return typeof value === "string" && value.trim()
    ? labels[value] || value
    : i18n.t("evidence.media.unknown");
}

export function evidenceSourceLabel(value: unknown) {
  return value === "derived"
    ? i18n.t("evidence.source.derived")
    : value === "original"
      ? i18n.t("evidence.source.original")
      : i18n.t("evidence.source.unknown");
}
