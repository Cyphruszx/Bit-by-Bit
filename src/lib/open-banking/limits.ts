/**
 * Spec 12.1a / Steven lock: a connection is one Fiskil bank link, not an
 * account. Hard max 5 at launch. The 6th is a hard block.
 */

export const MAX_BANK_CONNECTIONS = 5;

export const CONNECTION_CAP_CODE = "CONNECTION_CAP";

/** Locked UX copy for the 6th connect. */
export const CONNECTION_CAP_COPY = "Disconnect one to add another.";

export function connectionCapReached(connectionCount: number): boolean {
  return connectionCount >= MAX_BANK_CONNECTIONS;
}

export function remainingConnections(connectionCount: number): number {
  return Math.max(0, MAX_BANK_CONNECTIONS - connectionCount);
}

export function connectionCapMessage(connectionCount = MAX_BANK_CONNECTIONS): string {
  return `You already have ${connectionCount} bank connections. ${CONNECTION_CAP_COPY}`;
}
