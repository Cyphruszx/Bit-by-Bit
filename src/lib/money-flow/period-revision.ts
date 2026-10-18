/**
 * Counts month-picker writes. Reading the stored period on load does not bump it,
 * so the transactions chart can open on 1M and follow only a later change.
 */
let revision = 0;
const listeners = new Set<() => void>();

export function bumpPeriodRevision(): void {
  revision += 1;
  listeners.forEach((listener) => listener());
}

export function subscribePeriodRevision(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function getPeriodRevision(): number {
  return revision;
}
