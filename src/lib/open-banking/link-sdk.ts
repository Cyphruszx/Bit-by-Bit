/**
 * Thin wrapper around the Fiskil Link SDK. Loaded only in the browser on
 * Connect — the package talks to document/window.
 */

export type FiskilLinkResult = { consentId?: string };

export async function launchFiskilLink(sessionId: string): Promise<FiskilLinkResult> {
  const { link } = await import("@fiskil/link");
  const result = await link(sessionId);
  return { consentId: result.consentID };
}
