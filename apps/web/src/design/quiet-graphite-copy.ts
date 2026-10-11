export const quietGraphiteNavigationCopy = {
  ko: { collapse: "왼쪽 메뉴 접기", expand: "왼쪽 메뉴 펼치기", product: "감리 업무" },
  vi: { collapse: "Thu gọn menu bên trái", expand: "Mở rộng menu bên trái", product: "Giám sát công trường" },
  en: { collapse: "Collapse left navigation", expand: "Expand left navigation", product: "Site supervision" },
} as const;

export type QuietGraphiteLanguage = keyof typeof quietGraphiteNavigationCopy;

export function quietGraphiteLanguage(locale: string | undefined): QuietGraphiteLanguage {
  const lang = (locale || "ko").split("-")[0];
  return lang === "vi" || lang === "en" ? lang : "ko";
}
