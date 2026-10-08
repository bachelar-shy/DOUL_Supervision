import i18n from "./i18n/config";
import {
  koreanCommands,
  koreanFields,
  koreanReasonLabel,
  koreanRoles,
  koreanStates,
  legacyKoreanCommands,
  legacyKoreanFields,
  legacyKoreanReasonLabel,
  legacyKoreanRoles,
  legacyKoreanStates,
  normalizeLanguage,
} from "@doul/localization";

function localizedRecord(
  prefix: "roles" | "state" | "command" | "field",
  source: Record<string, string>,
): Record<string, string> {
  return new Proxy(source, {
    get(target, property, receiver) {
      if (typeof property !== "string") {
        return Reflect.get(target, property, receiver);
      }
      if (!(property in target)) return undefined;
      return i18n.t(`${prefix}.${property}`, {
        defaultValue: target[property],
      });
    },
  });
}

export const roles = localizedRecord("roles", {
  ...legacyKoreanRoles,
  ...koreanRoles,
});
export const states = localizedRecord("state", {
  ...legacyKoreanStates,
  ...koreanStates,
});
export const commands = localizedRecord("command", {
  ...legacyKoreanCommands,
  ...koreanCommands,
});
export const fields = localizedRecord("field", {
  ...legacyKoreanFields,
  ...koreanFields,
});
export const reasonLabel = (code?: string) =>
  i18n.t(`reason.${code || "default"}`, {
    defaultValue:
      normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) === "ko"
        ? koreanReasonLabel(code) || legacyKoreanReasonLabel(code)
        : i18n.t("reason.default"),
  });
