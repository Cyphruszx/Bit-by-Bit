const windows = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const start = now - windowMs;
  const recent = (windows.get(key) ?? []).filter((time) => time > start);
  if (recent.length >= limit) {
    windows.set(key, recent);
    return false;
  }
  recent.push(now);
  windows.set(key, recent);
  return true;
}

export function resetRateLimits() {
  windows.clear();
}
