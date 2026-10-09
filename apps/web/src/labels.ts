import i18n from "./i18n/config";
import type { CreationCapability } from "./data/ui-contract";
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

export const creationCapabilityLabel = (capability?: CreationCapability) =>
  i18n.t(`creation.${capability?.status === "unauthorized" ? "unauthorized"
    : capability?.status === "prerequisites_missing" ? "prerequisites"
    : capability?.status === "unavailable" ? "unavailable" : "unknown"}`);
