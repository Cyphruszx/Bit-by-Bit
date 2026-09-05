import { EMPTY_LEDGER, ledgerFromTransactions, parseLedger, type Ledger } from "@/lib/money-flow/ledger";
import type { FileInterpretation, InterpretedTransaction } from "@/lib/money-flow/types";
import { canSignIn } from "@/lib/supabase/config";

/**
 * Where the ledger lives. IndexedDB today; a signed-in cloud store can implement
 * the same three calls later without the app noticing.
 */
export type LedgerStore = {
  load(): Promise<Ledger>;
  save(ledger: Ledger): Promise<void>;
  clear(): Promise<void>;
};

const DB_NAME = "bitbybit";
const DB_VERSION = 1;
const STORE_NAME = "ledger";
const RECORD_KEY = "current";
/** Who the browser's copy belongs to, so the next person to sign in does not inherit it. */
const OWNER_KEY = "owner";

/** The single-blob store the app used before statements accumulated. */
const LEGACY_KEY = "bitbybit.interpreted-v1";
const MIGRATED_KEY = "bitbybit.ledger-migrated-v1";

export function createLedgerStore(): LedgerStore {
  return supportsIndexedDb() ? indexedDbStore() : memoryStore();
}

/**
 * The store the app should use. The browser one always, wrapped in a backup when this copy
 * of BitbyBit has an account to back up to and somebody is signed in. Unconfigured or signed
 * out, this is exactly the store the app has always used and nothing reaches the network.
 *
 * The backup is made for one person and told which one. Everything it sends checks that the
 * same person is still signed in, so work left over from before an account switch cannot
 * land in the account that follows.
 */
export async function resolveLedgerStore(): Promise<LedgerStore> {
  const local = createLedgerStore();
  if (!canSignIn()) return local;
  const { cloudLedgerStore } = await import("@/lib/store/cloud-ledger-store");
  const { signedInUserId } = await import("@/lib/store/cloud-rows");
  const userId = await signedInUserId();
  return userId ? cloudLedgerStore(local, userId) : local;
}

/**
 * The account the browser's copy was last saved under, or null while it belongs to nobody
 * — which is every copy built before signing in, and the ordinary case.
 *
 * This is what tells "my own statements, waiting to be backed up" apart from "the last
 * person's statements, still sitting in a shared browser". Only the first should be merged
 * into an account on sign-in.
 */
export async function ledgerOwner(): Promise<string | null> {
  if (!supportsIndexedDb()) return null;
  try {
    const db = await openDb();
    const raw = await request<unknown>(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(OWNER_KEY),
    );
    db.close();
    return typeof raw === "string" && raw ? raw : null;
  } catch {
    return null;
  }
}

/** Records who the browser's copy belongs to now. Null gives it back to nobody. */
export async function setLedgerOwner(userId: string | null): Promise<void> {
  if (!supportsIndexedDb()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    if (userId) store.put(userId, OWNER_KEY);
    else store.delete(OWNER_KEY);
    await settled(tx);
    db.close();
  } catch {
    // Same posture as every other write here: a browser that refuses to store must not
    // take the movements on screen down with it.
  }
}

export function supportsIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function indexedDbStore(): LedgerStore {
  return {
    async load() {
      const stored = await read();
      if (stored && stored.entries.length > 0) return stored;

      const legacy = takeLegacyLedger();
      if (legacy) {
        await write(legacy);
        return legacy;
      }
      return stored ?? EMPTY_LEDGER;
    },
    save: write,
    async clear() {
      await write(EMPTY_LEDGER);
    },
  };
}

function memoryStore(): LedgerStore {
  let held = EMPTY_LEDGER;
  return {
    async load() {
      return held;
    },
    async save(ledger) {
      held = ledger;
    },
    async clear() {
      held = EMPTY_LEDGER;
    },
  };
}

async function read(): Promise<Ledger | null> {
  try {
    const db = await openDb();
    const raw = await request<unknown>(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(RECORD_KEY));
    db.close();
    return parseLedger(raw);
  } catch {
    return null;
  }
}

async function write(ledger: Ledger): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(ledger, RECORD_KEY);
    await settled(tx);
    db.close();
  } catch {
    // A full or blocked database must not lose the movements already on screen.
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE_NAME)) open.result.createObjectStore(STORE_NAME);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("The BitbyBit database is open in another tab."));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function settled(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

/** Moves movements held by the older single-upload store into the ledger, once. */
function takeLegacyLedger(): Ledger | null {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return null;
    const raw = localStorage.getItem(LEGACY_KEY);
    localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { files?: FileInterpretation[]; transactions?: InterpretedTransaction[] };
    const transactions = parsed.transactions ?? [];
    if (transactions.length === 0) return null;
    return ledgerFromTransactions(transactions, parsed.files ?? [], new Date().toISOString());
  } catch {
    return null;
  }
}
