const FALLBACK = "/dashboard";

export function safeInternalPath(next: string | null | undefined, fallback = FALLBACK): string {
  if (!next) return fallback;
  const trimmed = next.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\") || trimmed.includes("://")) {
    return fallback;
  }
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    return fallback;
  }
  if (
    decoded.includes("\\") ||
    decoded.includes("://") ||
    decoded.startsWith("//") ||
    /[\u0000-\u001f\u007f]/.test(decoded)
  ) {
    return fallback;
  }

  try {
    const origin = "https://bitbybit.invalid";
    const resolved = new URL(trimmed, origin);
    if (resolved.origin !== origin || resolved.username || resolved.password) return fallback;
    const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
  } catch {
    return fallback;
  }
}
