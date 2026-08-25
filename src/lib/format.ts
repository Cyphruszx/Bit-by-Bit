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
