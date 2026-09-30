/**
 * Spec 2A. Server-only switch for the archived PDF text + OCR path and the
 * older photo/image OCR path (PR #62). Unset means off. Never a user setting.
 *
 * OFX/QFX stay rejected either way.
 */

export function ingestPdfEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.INGEST_PDF_ENABLED;
  if (raw == null || raw.trim() === "") return false;
  const value = raw.trim().toLowerCase();
  return value === "true" || value === "1" || value === "on" || value === "yes";
}

/** node:test options. PDF/OCR suites run only when the flag is on. */
export function archivedPdfTestOptions(): { skip?: string } {
  return ingestPdfEnabled()
    ? {}
    : { skip: "INGEST_PDF_ENABLED is not true (Spec 2A)" };
}
