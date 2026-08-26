const aud = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export function formatAud(amount: number) {
  return aud.format(amount);
}

export function formatSignedAud(amount: number) {
  const formatted = formatAud(Math.abs(amount));
  if (amount > 0) return `+${formatted}`;
  if (amount < 0) return `-${formatted}`;
  return formatted;
}

export function formatAudCompact(amount: number) {
  const abs = Math.abs(amount);
  if (abs === 0) return "$0";
  if (abs >= 1000) {
    const thousands = amount / 1000;
    const digits = Number.isInteger(thousands) || abs >= 10000 ? 0 : 1;
    return `$${thousands.toFixed(digits)}k`;
  }
  return formatAud(amount);
}
