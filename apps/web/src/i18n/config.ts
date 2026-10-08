import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  appLanguages,
  defaultLanguage,
  languageDirection,
  localeStorageKey,
  normalizeLanguage,
  resources,
  type AppLanguage,
} from "@doul/localization";

function initialLanguage(): AppLanguage {
  const stored = window.localStorage.getItem(localeStorageKey);
  if (stored) return normalizeLanguage(stored);
  return defaultLanguage;
}

function synchronizeDocumentLanguage(language: string) {
  const normalized = normalizeLanguage(language);
  document.documentElement.lang =
    appLanguages.find((candidate) => candidate.code === normalized)?.tag ??
    normalized;
  document.documentElement.dir = languageDirection(normalized);
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: defaultLanguage,
  supportedLngs: appLanguages.map((language) => language.code),
  load: "languageOnly",
  nonExplicitSupportedLngs: true,
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
  react: {
    useSuspense: false,
  },
});

synchronizeDocumentLanguage(i18n.resolvedLanguage ?? i18n.language);
i18n.on("languageChanged", (language) => {
  window.localStorage.setItem(localeStorageKey, normalizeLanguage(language));
  synchronizeDocumentLanguage(language);
});

export async function changeAppLanguage(language: AppLanguage) {
  await i18n.changeLanguage(language);
}

export { appLanguages };
export type { AppLanguage };
export default i18n;
