import i18n from "./i18n/config";
import {
  koreanCommands,
  koreanFields,
  koreanReasonLabel,
  koreanRoles,
  koreanStates,
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

export const roles = localizedRecord("roles", koreanRoles);
export const states = localizedRecord("state", koreanStates);
export const commands = localizedRecord("command", koreanCommands);
export const fields = localizedRecord("field", koreanFields);

export const reasonLabel = (code?: string) =>
  i18n.t(`reason.${code || "default"}`, {
    defaultValue: koreanReasonLabel(code),
  });
