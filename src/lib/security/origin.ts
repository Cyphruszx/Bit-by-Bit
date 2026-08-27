import { headers } from "next/headers";

export async function clientIp(): Promise<string> {
  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return headerStore.get("x-real-ip") || "unknown";
}

export async function assertSameOrigin() {
  const headerStore = await headers();
  const origin = headerStore.get("origin");
  if (!origin) return;
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  if (!host) return;
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new Error("Invalid request origin.");
  }
  if (originHost !== host) {
    throw new Error("Invalid request origin.");
  }
}
