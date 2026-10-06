import type { CommandDescriptor } from "./ui-contract";
import { reasonLabel } from "../labels";

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
      label: "오프라인",
      disabled: true,
      reason: "네트워크 연결 후 서버에서 현재 권한과 선행조건을 다시 확인합니다.",
    };
  }

  if (
    action.blockedReason?.code === "NOT_AUTHORIZED" &&
    !action.requiresInput
  ) {
    return {
      availability: "forbidden",
      label: "권한 없음",
      disabled: true,
      reason: reasonLabel(action.blockedReason.code),
    };
  }

  if (action.requiresInput) {
    return {
      availability: "input",
      label: "입력 필요",
      disabled: false,
      reason: "입력 후 서버에서 선행조건과 권한을 다시 확인합니다.",
    };
  }

  if (action.ready) {
    return {
      availability: "ready",
      label: "실행 가능",
      disabled: false,
    };
  }

  return {
    availability: "blocked",
    label: "선행조건 대기",
    disabled: true,
    reason: action.blockedReason
      ? reasonLabel(action.blockedReason.code)
      : "서버가 현재 이 명령을 실행 가능 상태로 허용하지 않았습니다.",
  };
}
