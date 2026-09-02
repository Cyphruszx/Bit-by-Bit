export type Page<T> = {
  /** The rows to render for this page. */
  items: T[];
  /** The page actually shown, which is not always the one asked for. */
  page: number;
  pageCount: number;
  /** Zero-based index of the first row on this page, for "showing 26-50 of 1,704". */
  firstIndex: number;
  total: number;
};

/**
 * One page of a list, with the page number clamped into range.
 *
 * A list can shrink under the reader - a filter narrows it, or a shorter period is chosen -
 * and the page they were on stops existing. Clamping means they land on the last page that
 * does exist rather than on a blank column.
 */
export function paginate<T>(rows: T[], page: number, size: number): Page<T> {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);
  const firstIndex = (current - 1) * size;
  return {
    items: rows.slice(firstIndex, firstIndex + size),
    page: current,
    pageCount,
    firstIndex,
    total: rows.length,
  };
}
