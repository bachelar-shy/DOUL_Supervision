import type { RegisterProjectionRow } from "./ui-contract";
import { states } from "../labels";
import { formatDateTime, formatNumber } from "../i18n/format";
import i18n from "../i18n/config";
import {
  koreanRegisterFieldLabels,
  koreanRegisterObjectLabels,
} from "@doul/localization";

const dateLike = /(?:^|_)(?:at|due|expiry|date)$/i;

export function registerFieldLabel(key: string) {
  const fallback = koreanRegisterFieldLabels[key] || key.replaceAll("_", " ");
  return i18n.t(`register.field.${key}`, { defaultValue: fallback });
}

export function registerSourceLabel(objectType?: string) {
  if (!objectType) return i18n.t("register.value.sourceUnknown");
  const fallback = koreanRegisterObjectLabels[objectType] || objectType;
  return i18n.t(`register.object.${objectType}`, { defaultValue: fallback });
}

export function registerRowTitle(row: RegisterProjectionRow) {
  const record = row.data;
  const metadata =
    record.metadata && typeof record.metadata === "object"
      ? (record.metadata as Record<string, unknown>)
      : undefined;
  const raw =
    record.workName ||
    record.title ||
    record.description ||
    metadata?.name ||
    record.subtype ||
    row.sourceDomainRefs[0]?.objectType ||
    record.id;
  return String(raw);
}

export function formatRegisterValue(value: unknown, fieldKey = ""): string {
  if (value === null || value === undefined || value === "") {
    return i18n.t("common.unknown");
  }
  if (typeof value === "boolean") {
    return value ? i18n.t("common.yes") : i18n.t("common.no");
  }
  if (typeof value === "number") return formatNumber(value);
  if (Array.isArray(value)) {
    if (!value.length) return i18n.t("common.none");
    if (
      value.every((item) =>
        ["string", "number", "boolean"].includes(typeof item),
      )
    ) {
      return value.map((item) => String(item)).join(", ");
    }
    return i18n.t("register.value.count", { count: value.length });
  }
  if (typeof value === "object") return JSON.stringify(value);

  const text = String(value);
  if (states[text]) return states[text];
  if (dateLike.test(fieldKey) || /^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return formatDateTime(date);
  }
  return text;
}

export function registerRowSearchText(row: RegisterProjectionRow) {
  return [
    row.data.id,
    row.data.title,
    row.data.workName,
    row.data.description,
    row.data.status,
    row.data.locationId,
    row.data.packageId,
    row.data.discipline,
    row.sourceDomainRefs[0]?.objectType,
    ...Object.values(row.calculated).map((value) =>
      formatRegisterValue(value),
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
