/** Format a canonical decimal string without converting it to a JS number. */
export function formatDecimalExact(
  value: string,
  locale: string,
  currency?: string,
): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;

  const [, sign, whole, fraction = ""] = match;
  let formatter: Intl.NumberFormat;
  try {
    formatter = currency
      ? new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        })
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  } catch {
    return `${formatDecimalExact(value, locale)} ${currency}`;
  }

  const magnitude = BigInt(whole);
  const signedMagnitude = sign === "-" ? -magnitude : magnitude;
  let parts = formatter.formatToParts(signedMagnitude);
  if (sign === "-" && magnitude === 0n) {
    parts = formatter.formatToParts(-1n).map((part) =>
      part.type === "integer" ? { ...part, value: "0" } : part,
    );
  }

  if (fraction) {
    const decimal = new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === "decimal")?.value;
    const integerIndex = parts.findLastIndex((part) => part.type === "integer");
    if (decimal && integerIndex >= 0) {
      parts.splice(
        integerIndex + 1,
        0,
        { type: "decimal", value: decimal },
        { type: "fraction", value: fraction },
      );
    }
  }
  return parts.map((part) => part.value).join("");
}
