import i18n from "./config";
import { intlLocaleFor } from "@doul/localization";

function activeLocale() {
  return intlLocaleFor(i18n.resolvedLanguage ?? i18n.language);
}

export function formatLongDate(value: Date) {
  return new Intl.DateTimeFormat(activeLocale(), {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(value);
}

export function formatDateTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(activeLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(activeLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat(activeLocale()).format(value);
}

export function formatCurrency(value: number | string, currency?: string) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (!currency) return formatNumber(numeric);
  try {
    return new Intl.NumberFormat(activeLocale(), {
      style: "currency",
      currency,
    }).format(numeric);
  } catch {
    return `${formatNumber(numeric)} ${currency}`;
  }
}
