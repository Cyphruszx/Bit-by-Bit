/**
 * Statement descriptors are noisy: EFTPOS prefixes, Square `SQ *`, city suffixes,
 * and long reference numbers. Matching is done on a collapsed token string so
 * `EFTPOS WW METRO 3120` and `Woolworths Metro` land on the same needle.
 */

const PREFIX = /^(visa|mastercard|eftpos|debit|credit|pending|card purchase|purchase|pos(?: w\/?d)?|bpay|direct debit|aus(?:tralia)?|au)\s+/i;

const PROCESSOR = /^(sq|sp|paypal|pp)\s+/i;

const FURNITURE = new Set([
  "VISA",
  "MASTERCARD",
  "EFTPOS",
  "DEBIT",
  "CREDIT",
  "PENDING",
  "PURCHASE",
  "CARD",
  "POS",
  "BPAY",
  "AUS",
  "AU",
  "AUSTRALIA",
  "AUST",
  "PTY",
  "LTD",
  "LIMITED",
  "THE",
]);

export function normalizeMerchant(raw: string): string {
  let value = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  value = value.replace(/&/g, " AND ");
  value = value.replace(/[*_/#,.;:'"+!?()[\]{}|\\-]+/g, " ");
  value = value.replace(/\s+/g, " ").trim();
  value = value.replace(PREFIX, "");
  value = value.replace(PROCESSOR, "");
  value = value.replace(/\s+/g, " ").trim();

  const tokens = value
    .toUpperCase()
    .split(" ")
    .filter((token) => token && !FURNITURE.has(token) && !/^\d{3,}$/.test(token));

  return tokens.join(" ").trim();
}

export function merchantTokens(raw: string): string[] {
  const held = normalizeMerchant(raw);
  return held ? held.split(" ") : [];
}

/** Whether `needle` appears as consecutive tokens in `haystack`. */
export function containsTokenSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  const last = haystack.length - needle.length;
  for (let start = 0; start <= last; start += 1) {
    let matched = true;
    for (let i = 0; i < needle.length; i += 1) {
      if (haystack[start + i] !== needle[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}
