/**
 * Fiskil Data API credentials and endpoints (Spec 12 Slice 1).
 *
 * Client id and secret live in server env only. A NEXT_PUBLIC_ prefix here
 * would ship them to the browser, which the spec forbids.
 */

export const FISKIL_TOKEN_URL = "https://api.fiskil.com/v1/token";
export const FISKIL_API_BASE = "https://api.fiskil.com/v1";

/** Minimum scopes Dev verified for app token + end-user create/link. */
export const FISKIL_SCOPES = ["api:user.read", "api:user.write", "api:banking"] as const;

/** Fiskil tokens last 15 minutes. Refresh a minute early so a 401 is not the first sign. */
export const FISKIL_TOKEN_TTL_SECONDS = 900;
export const FISKIL_TOKEN_REFRESH_SKEW_SECONDS = 60;

export type FiskilEnv = Record<string, string | undefined>;

export type FiskilCredentials = {
  clientId: string;
  clientSecret: string;
};

export function fiskilCredentials(env: FiskilEnv = process.env): FiskilCredentials | null {
  const clientId = env.FISKIL_CLIENT_ID?.trim();
  const clientSecret = env.FISKIL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Fiskil webhook HMAC secret (base64). Server-only — never NEXT_PUBLIC_. */
export function fiskilWebhookSecret(env: FiskilEnv = process.env): string | null {
  const secret = env.FISKIL_WEBHOOK_SECRET?.trim();
  return secret || null;
}

export function isFiskilConfigured(env: FiskilEnv = process.env): boolean {
  return fiskilCredentials(env) !== null;
}

/** Public Fiskil keys would leak into the client bundle. None should exist. */
export function publicFiskilEnvNames(env: FiskilEnv = process.env): string[] {
  return Object.keys(env).filter((key) => key.startsWith("NEXT_PUBLIC_FISKIL"));
}
