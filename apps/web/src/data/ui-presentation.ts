import type { CommandDescriptor } from "./ui-contract";
import { reasonLabel } from "../labels";
import i18n from "../i18n/config";

export type CommandAvailability =
  | "ready"
  | "input"
  | "blocked"
  | "forbidden"
  | "offline";

export interface CommandPresentation {
  availability: CommandAvailability;
  label: string;
  disabled: boolean;
  reason?: string;
}

export function describeCommandAvailability(
  action: CommandDescriptor,
  online: boolean,
): CommandPresentation {
  if (!online) {
    return {
      availability: "offline",
      label: i18n.t("command.availability.offline"),
      disabled: true,
      reason: i18n.t("command.availability.offlineHelp"),
    };
  }

  if (
    action.blockedReason?.code === "NOT_AUTHORIZED" &&
    !action.requiresInput
  ) {
    return {
      availability: "forbidden",
      label: i18n.t("command.availability.forbidden"),
      disabled: true,
      reason: reasonLabel(action.blockedReason.code),
    };
  }

  if (action.requiresInput) {
    return {
      availability: "input",
      label: i18n.t("command.availability.input"),
      disabled: false,
      reason: i18n.t("command.availability.inputHelp"),
    };
  }

  if (action.ready) {
    return {
      availability: "ready",
      label: i18n.t("command.availability.ready"),
      disabled: false,
    };
  }

  return {
    availability: "blocked",
    label: i18n.t("command.availability.blocked"),
    disabled: true,
    reason: action.blockedReason
      ? reasonLabel(action.blockedReason.code)
      : i18n.t("command.availability.blockedHelp"),
  };
}
