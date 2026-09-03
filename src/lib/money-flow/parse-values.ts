const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes).replace(/^\uFEFF/, "");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(bytes.length - 2);
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      swapped[i - 2] = bytes[i + 1];
      swapped[i - 1] = bytes[i];
    }
    return new TextDecoder("utf-16le").decode(swapped);
  }
  return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
}

export function parseAmount(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw !== 0) return roundMoney(raw);
  if (raw == null) return null;
  let text = String(raw).trim();
  if (!text || text === "-" || text === "—") return null;

  const cr = /\b(cr|credit)\b/i.test(text);
  const dr = /\b(dr|debit)\b/i.test(text);
  const wrappedNegative = /^\(.*\)$/.test(text);
  const trailingMinus = /-$/.test(text);
  const leadingMinus = text.startsWith("-") || text.startsWith("−");

  // Take the first number rather than stripping every non-numeric character, so
  // words sitting alongside the value (for example "INTER-BANK CREDIT") cannot
  // contribute stray digits or hyphens to it.
  const token = text
    .replace(/[()]/g, "")
    .replace(/[−–—]/g, "-")
    .replace(/\b(cr|dr|credit|debit|aud|nzd|usd|eur|gbp)\b/gi, " ")
    .match(/-?\d[\d,.]*/);

  if (!token) return null;
  text = token[0].replace(/[.,]+$/, "");
  if (!text || text === "-") return null;

  const negative =
    wrappedNegative || trailingMinus || leadingMinus || dr || (cr ? false : false);

  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(text)) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",") && text.includes(".")) {
    text = text.replace(/,/g, "");
  } else if (/^\d+,\d{1,2}$/.test(text)) {
    text = text.replace(",", ".");
  } else {
    text = text.replace(/,/g, "");
  }

  const value = Number(text);
  if (!Number.isFinite(value) || value === 0) return null;
  const signed = negative ? -Math.abs(value) : cr ? Math.abs(value) : value;
  return roundMoney(signed);
}

export function parseDate(raw: string | number | Date | null | undefined): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return calendarIso(raw);
  if (typeof raw === "number" && raw > 20000 && raw < 80000) {
    return excelSerialToIso(raw);
  }
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return normalizeIso(iso[1], iso[2], iso[3]);

  const dmy = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) return fromDayMonthYear(dmy[1], dmy[2], dmy[3]);

  const ymd = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (ymd) return normalizeIso(ymd[1], ymd[2], ymd[3]);

  const named = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{2,4})$/);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (month) return fromDayMonthYear(named[1], String(month), named[3]);
  }

  const namedFirst = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (namedFirst) {
    const month = MONTHS[namedFirst[1].toLowerCase()];
    if (month) return fromDayMonthYear(namedFirst[2], String(month), namedFirst[3]);
  }

  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return calendarIso(new Date(parsed));
  return null;
}

export function formatDisplayDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * The stretch a run of movements covers, always saying which year. A ledger holds several,
 * so a bare "30 June" names no day in particular; a span crossing new year needs both
 * years or it reads backwards, and one that does not needs the year said only once.
 */
export function describeSpan(from: string, to: string): string {
  const [fromYear, toYear] = [from.slice(0, 4), to.slice(0, 4)];
  if (from === to) return `${formatDisplayDate(from)} ${fromYear}`;
  if (fromYear === toYear) return `${formatDisplayDate(from)} – ${formatDisplayDate(to)} ${toYear}`;
  return `${formatDisplayDate(from)} ${fromYear} – ${formatDisplayDate(to)} ${toYear}`;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function fromDayMonthYear(day: string, month: string, year: string): string | null {
  const y = year.length === 2 ? (Number(year) > 70 ? `19${year}` : `20${year}`) : year;
  return normalizeIso(y, month, day);
}

function normalizeIso(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function calendarIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function excelSerialToIso(serial: number): string | null {
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}
