import "intl-pluralrules";

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import Storage from "expo-sqlite/kv-store";
import {
  appLanguages,
  defaultLanguage,
  localeStorageKey,
  normalizeLanguage,
  resources,
  type AppLanguage,
} from "@doul/localization";

const storedLanguage = Storage.getItemSync(localeStorageKey);

void i18n.use(initReactI18next).init({
  resources,
  lng: normalizeLanguage(storedLanguage),
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

i18n.on("languageChanged", (language) => {
  Storage.setItemSync(localeStorageKey, normalizeLanguage(language));
});

export async function changeMobileLanguage(language: AppLanguage) {
  await i18n.changeLanguage(language);
}

export { appLanguages };
export type { AppLanguage };
export default i18n;
