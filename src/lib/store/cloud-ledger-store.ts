"use client";

import { EMPTY_LEDGER, mergeLedgers, parseLedger, type Ledger } from "@/lib/money-flow/ledger";
import type { LedgerStore } from "@/lib/store/ledger-store";
import { supabase } from "@/lib/supabase/client";

/**
 * A ledger kept in the browser and backed up to an account.
 *
 * Local first, always. Every read and write still lands in IndexedDB, so the app is as fast
 * signed in as signed out and keeps working on a train. The cloud is a second copy that
 * catches up when it can, and a failure to reach it is never allowed to disturb what is on
 * screen — the same posture IndexedDB already takes when a browser refuses to write.
 *
 * Nothing is ever replaced. Both directions go through mergeLedgers, so signing in on a
 * device that already holds statements adds them rather than trading them for what the
 * account had, and two devices editing at once keep both answers.
 */

const TABLE = "ledgers";

/** Long enough that a burst of tag edits is one write, short enough to feel immediate. */
const SETTLE_MS = 2000;

type CloudRow = { document: unknown; revision: number };

export function cloudLedgerStore(local: LedgerStore): LedgerStore {
  let pending: ReturnType<typeof setTimeout> | null = null;
  let revision = 0;
  let latest: Ledger | null = null;

  return {
    async load() {
      const here = await local.load();
      const there = await pull();
      // Not signed in, or the cloud could not be reached. The browser's copy is the answer
      // and nothing is sent, so a blocked host reads as an app that simply works offline.
      if (there === null) return here;

      if (there === "absent") {
        // A first backup: this account has no row yet. Whatever is already in this browser
        // is the ledger, and it goes up now rather than waiting for the next edit.
        revision = 0;
        if (holdsAnything(here)) await push(here);
        return here;
      }

      revision = there.revision;
      const merged = mergeLedgers(here, there.ledger);
      // Write the merge back both ways, so the two copies agree from this moment on.
      await local.save(merged);
      if (changed(here, merged) || changed(there.ledger, merged)) await push(merged);
      return merged;
    },

    async save(ledger) {
      // The browser first and without waiting: a person who imports a statement and closes
      // the tab has not lost it, whatever the network did.
      await local.save(ledger);
      latest = ledger;
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        const next = latest;
        if (next) void push(next);
      }, SETTLE_MS);
    },

    async clear() {
      if (pending) clearTimeout(pending);
      pending = null;
      latest = null;
      await local.clear();
      await remove();
      revision = 0;
    },
  };

  /**
   * What the account holds, if anything.
   *
   * Three answers, and the difference between the last two matters: "absent" means the
   * account is reachable and has no backup yet, which is the moment to make one, while null
   * means we could not ask and must not assume anything about what is up there.
   */
  async function pull(): Promise<{ ledger: Ledger; revision: number } | "absent" | null> {
    const who = await signedInAs();
    if (!who) return null;
    try {
      const { data, error } = await who.client
        .from(TABLE)
        .select("document, revision")
        .eq("user_id", who.userId)
        .maybeSingle<CloudRow>();
      if (error) return null;
      if (!data) return "absent";
      // Whatever comes back is read the same way a stored ledger is: parseLedger drops
      // anything malformed rather than letting it reach a total.
      const ledger = parseLedger(data.document);
      // A row we cannot read is still a row, and its revision is what lets the next push
      // replace it. Merging against nothing leaves this browser's copy untouched.
      return { ledger: ledger ?? EMPTY_LEDGER, revision: data.revision };
    } catch {
      return null;
    }
  }

  /**
   * Sends the ledger up against the revision it was read at.
   *
   * An update that names the revision it expects touches nothing if another device has
   * written since — no rows come back, and that silence is the whole concurrency check.
   * The answer is never to insist: pull what the other device wrote, merge, and send the
   * two together. One retry, because a second collision means something is writing
   * continuously and the next save will carry it anyway.
   */
  async function push(ledger: Ledger, retrying = false): Promise<void> {
    const who = await signedInAs();
    if (!who) return;
    const document = ledger as unknown as Record<string, unknown>;

    try {
      const wrote =
        revision === 0
          ? // Nothing seen yet, so this is the first backup. A conflict here means another
            // device got there first, which the merge below settles.
            await who.client
              .from(TABLE)
              .insert({ user_id: who.userId, document })
              .select("revision")
              .maybeSingle<{ revision: number }>()
          : await who.client
              .from(TABLE)
              .update({ document })
              .eq("user_id", who.userId)
              .eq("revision", revision)
              .select("revision")
              .maybeSingle<{ revision: number }>();

      if (wrote.data) {
        revision = wrote.data.revision;
        return;
      }
      // Either the row moved under us or the insert collided. Both mean: read, merge, send.
      if (retrying) return;

      const there = await pull();
      if (there === null || there === "absent") return;
      revision = there.revision;
      const merged = mergeLedgers(ledger, there.ledger);
      await local.save(merged);
      await push(merged, true);
    } catch {
      // A backup that could not be written is not a reason to lose the ledger in front of
      // the person. The next save carries it.
    }
  }

  async function remove(): Promise<void> {
    const who = await signedInAs();
    if (!who) return;
    try {
      await who.client.from(TABLE).delete().eq("user_id", who.userId);
    } catch {
      // As above: clearing locally is what the person asked for and has already happened.
    }
  }
}

async function signedInAs(): Promise<{ client: NonNullable<ReturnType<typeof supabase>>; userId: string } | null> {
  const client = supabase();
  if (!client) return null;
  try {
    const { data } = await client.auth.getUser();
    return data.user ? { client, userId: data.user.id } : null;
  } catch {
    return null;
  }
}

/** Whether there is anything worth backing up, so an empty browser does not make a row. */
function holdsAnything(ledger: Ledger): boolean {
  return ledger.entries.length > 0 || ledger.imports.length > 0;
}

/** Whether a merge actually moved anything, so an unchanged ledger is not sent back up. */
function changed(before: Ledger, after: Ledger): boolean {
  return (
    before.entries.length !== after.entries.length ||
    before.imports.length !== after.imports.length ||
    JSON.stringify(before.institutions ?? {}) !== JSON.stringify(after.institutions ?? {}) ||
    JSON.stringify(before.accounts ?? {}) !== JSON.stringify(after.accounts ?? {}) ||
    JSON.stringify(before.verdicts ?? {}) !== JSON.stringify(after.verdicts ?? {}) ||
    JSON.stringify(before.payers ?? {}) !== JSON.stringify(after.payers ?? {})
  );
}
