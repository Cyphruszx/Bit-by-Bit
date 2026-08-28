const PAN = /\b(?:\d[ -]*?){13,19}\b/g;
const BSB = /\b\d{3}[ -]?\d{3}\b/g;
const ACCOUNT = /\b(?:bsb|acc(?:ount)?(?:\s*(?:no|number|#))?|card)[:\s-]*\d[\d -]{4,}\b/gi;

export function redactAccountIdentifiers(value: string): string {
  return value
    .replace(ACCOUNT, (match) => match.replace(/\d/g, "•"))
    .replace(PAN, (match) => (countDigits(match) >= 13 ? maskDigits(match) : match))
    .replace(BSB, (match) => (looksLikeBsb(match) ? maskDigits(match) : match));
}

export function looksLikeBsb(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length === 6;
}

function countDigits(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}

function maskDigits(value: string): string {
  return value.replace(/\d/g, "•");
}
