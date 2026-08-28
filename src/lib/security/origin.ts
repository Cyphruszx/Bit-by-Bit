import { headers } from "next/headers";

const PLATFORM_IP_HEADERS = ["x-vercel-forwarded-for", "cf-connecting-ip", "true-client-ip"] as const;

type HeaderReader = { get(name: string): string | null };

export function clientIpFromHeaders(headerStore: HeaderReader): string {
  for (const name of PLATFORM_IP_HEADERS) {
    const value = headerStore.get(name)?.split(",")[0]?.trim();
    if (value) return value;
  }
  const realIp = headerStore.get("x-real-ip")?.trim();
  if (realIp && !realIp.includes(",")) return realIp;
  const forwarded = headerStore.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "unknown";
}

export async function clientIp(): Promise<string> {
  return clientIpFromHeaders(await headers());
}

function hostnameFromHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  return trimmed.split(":")[0] ?? "";
}

function isLoopbackHost(host: string): boolean {
  const hostname = hostnameFromHost(host);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function originFromValue(value: string): string | null {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).origin;
  } catch {
    return null;
  }
}

function addOrigin(origins: string[], value: string | undefined) {
  const origin = value?.trim() ? originFromValue(value.trim().replace(/\/$/, "")) : null;
  if (origin && !origins.includes(origin)) origins.push(origin);
}

export function trustedAppOrigins(
  env: Record<string, string | undefined> = process.env,
  headerStore?: HeaderReader,
): string[] {
  const origins: string[] = [];
  addOrigin(origins, env.NEXT_PUBLIC_SITE_URL);
  addOrigin(origins, env.VERCEL_PROJECT_PRODUCTION_URL);
  addOrigin(origins, env.VERCEL_BRANCH_URL);
  addOrigin(origins, env.VERCEL_URL);
  const host = headerStore?.get("host") ?? "";
  if (isLoopbackHost(host)) {
    const proto = headerStore?.get("x-forwarded-proto") === "https" ? "https" : "http";
    addOrigin(origins, `${proto}://${host}`);
  }
  return origins;
}

export function publicAppOrigin(
  env: Record<string, string | undefined> = process.env,
  headerStore?: HeaderReader,
): string | null {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (configured) return originFromValue(configured);
  const production = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return originFromValue(production);
  const host = headerStore?.get("host") ?? "";
  if (!isLoopbackHost(host)) return null;
  const proto = headerStore?.get("x-forwarded-proto") === "https" ? "https" : "http";
  return originFromValue(`${proto}://${host}`);
}

export function originForEmailRedirect(
  originHeader: string | null,
  env: Record<string, string | undefined> = process.env,
  headerStore?: HeaderReader,
): string | null {
  const trusted = trustedAppOrigins(env, headerStore);
  if (originHeader) {
    try {
      const origin = new URL(originHeader).origin;
      if (trusted.includes(origin)) return origin;
    } catch {
      /* fall through to the canonical origin */
    }
  }
  return publicAppOrigin(env, headerStore);
}

export function assertOriginMatches(originHeader: string | null, trustedOrigins: readonly string[]) {
  if (!originHeader || trustedOrigins.length === 0) {
    throw new Error("Invalid request origin.");
  }
  let origin = "";
  try {
    origin = new URL(originHeader).origin;
  } catch {
    throw new Error("Invalid request origin.");
  }
  if (!trustedOrigins.includes(origin)) {
    throw new Error("Invalid request origin.");
  }
}

export async function assertSameOrigin() {
  const headerStore = await headers();
  assertOriginMatches(headerStore.get("origin"), trustedAppOrigins(process.env, headerStore));
}
