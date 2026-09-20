"use client";

import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/session-store";
import { applyRemoteLedger, rehydrateLedger, useMoneyFlow } from "@/components/money-flow-provider";
import {
  browserConnectDeps,
  canShowConnectBank,
  connectBlockedByCap,
  connectCapCopy,
  fetchOpenBankingConnections,
  reconnectOpenBankingSession,
  requestOpenBankingSync,
  revokeOpenBankingConnection,
  runConnectBankFlow,
  runReconnectBankFlow,
} from "@/lib/open-banking/connect-flow";
import { parseLedger } from "@/lib/money-flow/ledger";
import { MAX_BANK_CONNECTIONS } from "@/lib/open-banking/limits";
import { launchFiskilLink } from "@/lib/open-banking/link-sdk";

type ListedConnection = { id: string; status: string; createdAt: string };

type ListedSnapshot = {
  connections: ListedConnection[];
  connectionCount: number;
  blocked: boolean;
};

/**
 * Spec 12 Slice 2: Connect bank behind the OPEN_BANKING gate.
 * End-user → auth session → Fiskil Link. Secrets stay on the server.
 */
export function ConnectBank({ onTurnOff }: { onTurnOff?: () => void }) {
  const { featureOn } = useMoneyFlow();
  const session = useSession();
  const openBanking = canShowConnectBank(featureOn("OPEN_BANKING"));
  const [listed, setListed] = useState<ListedSnapshot>({
    connections: [],
    connectionCount: 0,
    blocked: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!openBanking) return null;

  const toggles = { OPEN_BANKING: true };
  const signedIn = Boolean(session?.userId && session.email);
  const atCap = listed.blocked || connectBlockedByCap(listed.connectionCount);

  const uris = () => {
    const origin = window.location.origin;
    return {
      redirectUri: `${origin}/accounts?open-banking=linked`,
      cancelUri: `${origin}/accounts?open-banking=cancelled`,
    };
  };

  const applyList = (next: Awaited<ReturnType<typeof fetchOpenBankingConnections>>): ListedSnapshot => {
    const snapshot = {
      connections: next.connections,
      connectionCount: next.connectionCount,
      blocked: connectBlockedByCap(next.connectionCount),
    };
    setListed(snapshot);
    return snapshot;
  };

  const loadConnections = async (userId: string) => {
    const next = await fetchOpenBankingConnections(userId);
    return applyList(next);
  };

  const connect = async () => {
    if (!session?.userId || !session.email) return;
    setBusy(true);
    setMessage(null);
    try {
      const current = await loadConnections(session.userId);
      if (current.blocked) {
        setMessage(connectCapCopy(current.connectionCount));
        return;
      }
      const result = await runConnectBankFlow(
        {
          userId: session.userId,
          email: session.email,
          featureToggles: toggles,
          ...uris(),
        },
        browserConnectDeps(launchFiskilLink),
      );
      if (!result.ok) {
        setMessage(result.error);
        if (result.code === "CONNECTION_CAP" || connectBlockedByCap(result.connectionCount ?? 0)) {
          setListed((held) => ({
            ...held,
            blocked: true,
            connectionCount: result.connectionCount ?? held.connectionCount,
          }));
        }
        return;
      }
      await applySyncedLedger(result.ledger);
      setMessage(
        result.sync?.ok === false
          ? result.sync.error ?? "Bank connected, but the first sync did not finish. Use Sync now."
          : "Bank connected. First 90 days of transactions are on Accounts and Transactions.",
      );
      await loadConnections(session.userId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not start the bank connection.");
    } finally {
      setBusy(false);
    }
  };

  const reconnect = async (connectionId: string) => {
    if (!session?.userId || !session.email) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await runReconnectBankFlow(
        {
          userId: session.userId,
          email: session.email,
          featureToggles: toggles,
          connectionId,
          ...uris(),
        },
        {
          launchLink: launchFiskilLink,
          completeConnection: browserConnectDeps(launchFiskilLink).completeConnection,
          reconnect: reconnectOpenBankingSession,
        },
      );
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      await applySyncedLedger(result.ledger);
      setMessage("Bank reconnected.");
      await loadConnections(session.userId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not reconnect the bank.");
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async (connectionId: string) => {
    if (!session?.userId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await requestOpenBankingSync({
        userId: session.userId,
        connectionId,
        featureToggles: toggles,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      await applySyncedLedger(result.ledger);
      setMessage("Bank synced. Accounts and Transactions are up to date.");
      await loadConnections(session.userId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not sync the bank.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (connectionId: string) => {
    if (!session?.userId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await revokeOpenBankingConnection({
        userId: session.userId,
        connectionId,
        featureToggles: toggles,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage("Bank disconnected.");
      await loadConnections(session.userId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not disconnect the bank.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8 card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Open Banking</h2>
          <p className="mt-2 text-sm text-muted">
            Connect an Australian bank through Fiskil. A connection is one bank link — up to{" "}
            {MAX_BANK_CONNECTIONS} at launch — and may expose several accounts.
          </p>
        </div>
        {signedIn ? (
          <div className="flex flex-wrap gap-2">
            {onTurnOff ? <TurnOffButton onClick={onTurnOff} /> : null}
            <button
              type="button"
              onClick={() => {
                if (!session?.userId) return;
                setBusy(true);
                setMessage(null);
                void loadConnections(session.userId)
                  .catch((err: unknown) => {
                    setMessage(err instanceof Error ? err.message : "Could not load bank connections.");
                  })
                  .finally(() => setBusy(false));
              }}
              disabled={busy}
              className="rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-semibold text-ink-soft disabled:opacity-50"
            >
              Show connections
            </button>
            <button
              type="button"
              onClick={() => void connect()}
              disabled={busy || atCap}
              className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary disabled:opacity-50"
            >
              {busy ? "Connecting…" : "Connect bank"}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {onTurnOff ? <TurnOffButton onClick={onTurnOff} /> : null}
            <Link
              href="/sign-in"
              className="rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-semibold text-ink-soft"
            >
              Sign in to connect
            </Link>
          </div>
        )}
      </div>

      {atCap ? (
        <p className="mt-4 rounded-[var(--radius-inner)] border border-attention-line bg-attention-surface px-4 py-3 text-sm text-attention-ink">
          {connectCapCopy(listed.connectionCount || MAX_BANK_CONNECTIONS)}
        </p>
      ) : null}

      {!signedIn ? (
        <p className="mt-4 text-sm text-muted">
          Sign in so BitbyBit can link a Fiskil end user to your account, then launch consent.
        </p>
      ) : null}

      {message ? <p className="mt-4 text-sm text-ink-soft">{message}</p> : null}

      {listed.connections.length > 0 ? (
        <ul className="mt-5 divide-y divide-surface-subtle">
          {listed.connections.map((connection) => (
            <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-semibold">Bank connection</p>
                <p className="mt-1 text-sm text-muted">
                  {statusLabel(connection.status)} · {connection.id}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void syncNow(connection.id)}
                  disabled={busy || connection.status === "revoked"}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink-soft disabled:opacity-50"
                >
                  Sync now
                </button>
                <button
                  type="button"
                  onClick={() => void reconnect(connection.id)}
                  disabled={busy || connection.status === "revoked"}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink-soft disabled:opacity-50"
                >
                  Reconnect
                </button>
                <button
                  type="button"
                  onClick={() => void disconnect(connection.id)}
                  disabled={busy || connection.status === "revoked"}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink-soft disabled:opacity-50"
                >
                  Disconnect
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function TurnOffButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-semibold text-ink-soft"
    >
      Turn off
    </button>
  );
}

async function applySyncedLedger(raw: unknown): Promise<void> {
  const parsed = parseLedger(raw);
  if (parsed) {
    applyRemoteLedger(parsed);
    return;
  }
  await rehydrateLedger();
}

function statusLabel(status: string): string {
  if (status === "revoked") return "Disconnected";
  if (status === "needs_reconnect") return "Needs reconnect";
  return "Connected";
}
