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

export function publicAppOrigin(
  env: Record<string, string | undefined> = process.env,
  headerStore?: HeaderReader,
): string | null {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (configured) return originFromValue(configured);
  const vercel = env.VERCEL_URL?.trim();
  if (vercel) return originFromValue(vercel);
  const host = headerStore?.get("host") ?? "";
  if (!isLoopbackHost(host)) return null;
  const proto = headerStore?.get("x-forwarded-proto") === "https" ? "https" : "http";
  return originFromValue(`${proto}://${host}`);
}

export function assertOriginMatches(originHeader: string | null, expectedOrigin: string | null) {
  if (!originHeader || !expectedOrigin) {
    throw new Error("Invalid request origin.");
  }
  let originHost = "";
  try {
    originHost = new URL(originHeader).origin;
  } catch {
    throw new Error("Invalid request origin.");
  }
  if (originHost !== expectedOrigin) {
    throw new Error("Invalid request origin.");
  }
}

export async function assertSameOrigin() {
  const headerStore = await headers();
  assertOriginMatches(headerStore.get("origin"), publicAppOrigin(process.env, headerStore));
}
