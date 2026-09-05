import type { SourceRow } from "@/lib/money-flow/types";

/**
 * Build a source row from a table's own headers. Extra cells without a header
 * are kept under a blank name so nothing the file printed is thrown away.
 */
export function sourceFromCells(headers: string[], cells: string[]): SourceRow {
  const length = Math.max(headers.length, cells.length);
  return {
    headers: Array.from({ length }, (_, index) => headers[index] ?? ""),
    values: Array.from({ length }, (_, index) => cells[index] ?? ""),
  };
}

export function sourceFromPairs(cells: Array<[string, string]>): SourceRow {
  return {
    headers: cells.map(([header]) => header),
    values: cells.map(([, value]) => value),
  };
}

export function hasSource(source: SourceRow | undefined): boolean {
  return Boolean(source && source.headers.length > 0);
}

/** First cell whose header matches after the same normalisation the filters use. */
export function sourceValue(source: SourceRow | undefined, header: string): string {
  if (!source) return "";
  const needle = normalizeHeader(header);
  const index = source.headers.findIndex((name) => normalizeHeader(name) === needle);
  return index >= 0 ? (source.values[index] ?? "") : "";
}

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Named cells, including empty values. The unused blank NAB column is dropped. */
export function sourcePairs(source: SourceRow | undefined): Array<{ header: string; value: string }> {
  if (!source) return [];
  return source.headers
    .map((header, index) => ({ header, value: source.values[index] ?? "" }))
    .filter((cell) => cell.header.trim().length > 0);
}
