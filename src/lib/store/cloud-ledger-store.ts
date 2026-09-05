import { EMPTY_LEDGER, mergeLedgers, parseLedger, type Ledger } from "@/lib/money-flow/ledger";
import { ledgerOwner, setLedgerOwner, type LedgerStore } from "@/lib/store/ledger-store";
import { signedInUserId, supabaseRows, type CloudRows } from "@/lib/store/cloud-rows";

/**
 * A ledger kept in the browser and backed up to one person's account.
 *
 * Local first, always. Every read and write still lands in IndexedDB, so the app is as fast
 * signed in as signed out and keeps working on a train. The cloud is a second copy that
 * catches up when it can, and a failure to reach it is never allowed to disturb what is on
 * screen — the same posture IndexedDB already takes when a browser refuses to write.
 *
 * Nothing is ever replaced. Both directions go through mergeLedgers, so signing in on a
 * device that already holds statements adds them rather than trading them for what the
 * account had, and two devices editing at once keep both answers.
 *
 * The one thing never merged is somebody else's ledger. A store is made for a named person,
 * every call checks that person is still the one signed in, and the browser's copy carries a
 * note of who it belongs to. On a shared machine that is the difference between "back up the
 * statements I just added" and "send the last person's bank statements to my account", and
 * it is not a distinction to leave to timing: a save can still be waiting its two seconds
 * when the next person signs in.
 */

/** Long enough that a burst of tag edits is one write, short enough to feel immediate. */
const SETTLE_MS = 2000;

/**
 * What the store reaches for outside itself. The live ones in every real use; named here so
 * a test can hand it a database that does not exist and a browser that is not there.
 */
export type CloudParts = {
  rows: CloudRows;
  signedInUserId(): Promise<string | null>;
  owner(): Promise<string | null>;
  setOwner(userId: string | null): Promise<void>;
  /** How long a save waits before it is sent. Shortened in tests so they do not sit there. */
  settleMs?: number;
};

function liveParts(): CloudParts {
  return {
    rows: supabaseRows(),
    signedInUserId,
    owner: ledgerOwner,
    setOwner: setLedgerOwner,
  };
}

export function cloudLedgerStore(
  local: LedgerStore,
  forUserId: string,
  parts: CloudParts = liveParts(),
): LedgerStore {
  const { rows } = parts;
  const settleMs = parts.settleMs ?? SETTLE_MS;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let revision = 0;
  let latest: Ledger | null = null;

  return {
    async load() {
      const here = await local.load();
      // Whose statements are sitting in this browser. Ours, or nobody's, may go up; anybody
      // else's stays out of what this account holds and off this person's screen.
      const owner = await parts.owner();
      const inherited = owner !== null && owner !== forUserId;
      const mine = inherited ? EMPTY_LEDGER : here;

      const there = await read();
      // Not signed in as this person any more, or the cloud could not be reached. The
      // browser's copy is the answer and nothing is sent, so a blocked host reads as an app
      // that simply works offline.
      if (there === null) return mine;

      if (there === "absent") {
        // A first backup: this account has no row yet. Whatever is already in this browser
        // and belongs to us goes up now rather than waiting for the next edit.
        revision = 0;
        if (holdsAnything(mine)) await push(mine);
        await claim();
        return mine;
      }

      revision = there.revision;
      const merged = mergeLedgers(mine, there.ledger);
      // Someone else signed in while we were reading. Their store is already loading; ours
      // must not write over it, in the browser or in the cloud.
      if (!(await stillOurs())) return mine;

      // Write the merge back both ways, so the two copies agree from this moment on.
      await local.save(merged);
      await claim();
      if (changed(mine, merged) || changed(there.ledger, merged)) await push(merged);
      return merged;
    },

    async save(ledger) {
      // The browser first and without waiting: a person who imports a statement and closes
      // the tab has not lost it, whatever the network did.
      await local.save(ledger);
      await claim();
      latest = ledger;
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        const next = latest;
        if (next) void push(next);
      }, settleMs);
    },

    async clear() {
      if (pending) clearTimeout(pending);
      pending = null;
      latest = null;
      await local.clear();
      await parts.setOwner(null);
      if (await stillOurs()) await rows.remove(forUserId);
      revision = 0;
    },
  };

  /** Marks the browser's copy as this person's, so their next sign-in merges it back up. */
  async function claim(): Promise<void> {
    if (await stillOurs()) await parts.setOwner(forUserId);
  }

  /**
   * Whether the person this store was made for is still the one signed in. A save left
   * waiting from before an account switch finds the answer no and stops, which is the whole
   * guard: the alternative is one person's statements landing in the next person's account,
   * and row-level security cannot see the difference — the request is properly signed, just
   * carrying the wrong ledger.
   */
  async function stillOurs(): Promise<boolean> {
    return (await parts.signedInUserId()) === forUserId;
  }

  /**
   * What the account holds, if anything. The difference between the last two answers
   * matters: "absent" means the account is reachable and has no backup yet, which is the
   * moment to make one, while null means we could not ask and must assume nothing.
   */
  async function read(): Promise<{ ledger: Ledger; revision: number } | "absent" | null> {
    if (!(await stillOurs())) return null;
    const row = await rows.read(forUserId);
    if (row === null || row === "absent") return row;
    // Whatever comes back is read the same way a stored ledger is: parseLedger drops
    // anything malformed rather than letting it reach a total. A row we cannot read is
    // still a row, and its revision is what lets the next push replace it; merging against
    // nothing leaves this browser's copy untouched.
    return { ledger: parseLedger(row.document) ?? EMPTY_LEDGER, revision: row.revision };
  }

  /**
   * Sends the ledger up against the revision it was read at.
   *
   * A write that names the revision it expects touches nothing if another device has written
   * since, and that silence is the concurrency check. The answer is never to insist: pull
   * what the other device wrote, merge, and send the two together. One retry, because a
   * second collision means something is writing continuously and the next save carries it.
   */
  async function push(ledger: Ledger, retrying = false): Promise<void> {
    if (!(await stillOurs())) return;
    const document = ledger as unknown as Record<string, unknown>;

    const wrote =
      revision === 0
        ? // Nothing seen yet, so this is the first backup. A conflict here means another
          // device got there first, which the merge below settles.
          await rows.insert(forUserId, document)
        : await rows.update(forUserId, document, revision);

    if (wrote !== null) {
      revision = wrote;
      return;
    }
    // Either the row moved under us or the insert collided. Both mean: read, merge, send.
    if (retrying) return;

    const there = await read();
    if (there === null || there === "absent") return;
    revision = there.revision;
    const merged = mergeLedgers(ledger, there.ledger);
    if (!(await stillOurs())) return;
    await local.save(merged);
    await push(merged, true);
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
