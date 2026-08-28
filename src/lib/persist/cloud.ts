import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecurringStore, TrackedRecurring } from "@/lib/money-flow/recurring";
import type { PeriodFilter } from "@/lib/money-flow/period";
import type { SavingsPot, SavingsSnapshot } from "@/lib/money-flow/savings";
import type { FileInterpretation, InterpretedTransaction } from "@/lib/money-flow/types";
import {
  assignClientKeys,
  type CloudTransactionRow,
  ensureFileId,
  ensurePotId,
  fileFromRow,
  fileToRow,
  neededCategoryNames,
  periodFromJson,
  recurringFromRow,
  recurringToRow,
  resolveSourceFileId,
  savingsPotFromRow,
  savingsPotToRow,
  savingsSnapshotFromRow,
  transactionFromRow,
  transactionToRow,
} from "@/lib/persist/map";
import { primaryTag } from "@/lib/money-flow/tags";

export type FinanceClient = SupabaseClient;

export type CloudFinance = {
  files: FileInterpretation[];
  transactions: InterpretedTransaction[];
  period: PeriodFilter;
  recurring: RecurringStore;
  pots: SavingsPot[];
  snapshots: SavingsSnapshot[];
};

export function hasCloudMoneyFlow(data: Pick<CloudFinance, "files" | "transactions">): boolean {
  return data.files.length > 0 || data.transactions.length > 0;
}

export function hasCloudRecurring(data: RecurringStore): boolean {
  return data.ignored.length > 0 || data.confirmed.length > 0 || data.custom.length > 0;
}

export function hasCloudSavings(pots: SavingsPot[], snapshots: SavingsSnapshot[]): boolean {
  return pots.length > 0 || snapshots.length > 0;
}

export async function loadCloudFinance(client: FinanceClient, userId: string): Promise<CloudFinance> {
  const [files, transactions, preferences, recurringItems, ignored, pots, snapshots] = await Promise.all([
    client
      .from("uploaded_files")
      .select("id, filename, file_type, file_kind, notes, transaction_count, upload_status, processing_status, processing_error")
      .eq("user_id", userId),
    client
      .from("transactions")
      .select(
        "id, client_key, transaction_date, description, merchant_name, amount, transaction_type, subcategory, source_file_id, source_filename, ai_confidence, tags, tag_source, extracted_by, categories(name)",
      )
      .eq("user_id", userId)
      .order("transaction_date", { ascending: false }),
    client.from("user_preferences").select("period").eq("user_id", userId).maybeSingle(),
    client.from("recurring_items").select("id, fingerprint, name, amount, cadence, next_date, source").eq("user_id", userId),
    client.from("recurring_ignored").select("fingerprint").eq("user_id", userId),
    client
      .from("savings_pots")
      .select("id, name, detail, saved, target, monthly_contribution, included_in_total")
      .eq("user_id", userId)
      .order("sort_index", { ascending: true }),
    client.from("savings_snapshots").select("snapshot_date, total_saved").eq("user_id", userId).order("snapshot_date", { ascending: true }),
  ]);

  throwIfError(files.error, "Could not load documents.");
  throwIfError(transactions.error, "Could not load transactions.");
  throwIfError(preferences.error, "Could not load the period filter.");
  throwIfError(recurringItems.error, "Could not load recurring payments.");
  throwIfError(ignored.error, "Could not load ignored payments.");
  throwIfError(pots.error, "Could not load savings pots.");
  throwIfError(snapshots.error, "Could not load savings history.");

  const confirmed: TrackedRecurring[] = [];
  const custom: TrackedRecurring[] = [];
  for (const row of recurringItems.data ?? []) {
    const item = recurringFromRow(row);
    if (item.source === "custom") custom.push(item);
    else confirmed.push(item);
  }

  return {
    files: (files.data ?? []).map(fileFromRow),
    transactions: (transactions.data ?? []).map((row) => {
      const joined = row as {
        categories?: { name: string } | { name: string }[] | null;
      } & Record<string, unknown>;
      const categoryName = Array.isArray(joined.categories)
        ? joined.categories[0]?.name
        : joined.categories?.name;
      return transactionFromRow({ ...(row as CloudTransactionRow), category_name: categoryName ?? null });
    }),
    period: periodFromJson(preferences.data?.period),
    recurring: {
      ignored: (ignored.data ?? []).map((row) => row.fingerprint),
      confirmed,
      custom,
    },
    pots: (pots.data ?? []).map(savingsPotFromRow),
    snapshots: (snapshots.data ?? []).map(savingsSnapshotFromRow),
  };
}

export async function replaceMoneyFlow(
  client: FinanceClient,
  userId: string,
  files: FileInterpretation[],
  transactions: InterpretedTransaction[],
) {
  const filesWithIds = files.map(ensureFileId);
  const fileRows = filesWithIds.map((file) => fileToRow(file, userId));
  if (fileRows.length > 0) {
    throwIfError(
      (await client.from("uploaded_files").upsert(fileRows, { onConflict: "id" })).error,
      "Could not save documents.",
    );
  }

  const persistable = transactions.filter((txn) => txn.amount !== 0);
  const clientKeys = assignClientKeys(persistable.map((txn) => txn.id));
  const categoryIds = await upsertCategories(client, userId, neededCategoryNames(persistable));
  const txnRows = persistable.map((txn, index) =>
    transactionToRow(
      txn,
      userId,
      categoryIds.get(primaryTag(txn).toLowerCase()) ?? null,
      resolveSourceFileId(txn, filesWithIds),
      clientKeys[index],
    ),
  );
  if (txnRows.length > 0) {
    throwIfError(
      (await client.from("transactions").upsert(txnRows, { onConflict: "user_id,client_key" })).error,
      "Could not save transactions.",
    );
  }

  await deleteOthers(client, "transactions", userId, "client_key", clientKeys, "Could not update transactions.");
  await deleteOthers(
    client,
    "uploaded_files",
    userId,
    "id",
    filesWithIds.map((file) => file.id),
    "Could not update documents.",
  );
}

export async function replacePeriod(client: FinanceClient, userId: string, period: PeriodFilter) {
  throwIfError(
    (await client.from("user_preferences").upsert({ user_id: userId, period })).error,
    "Could not save the period filter.",
  );
}

export async function replaceRecurring(client: FinanceClient, userId: string, store: RecurringStore) {
  const items = [...store.confirmed, ...store.custom].map((item) => recurringToRow(item, userId));
  if (items.length > 0) {
    throwIfError(
      (await client.from("recurring_items").upsert(items, { onConflict: "user_id,fingerprint" })).error,
      "Could not save recurring payments.",
    );
  }
  if (store.ignored.length > 0) {
    throwIfError(
      (
        await client
          .from("recurring_ignored")
          .upsert(
            store.ignored.map((fingerprint) => ({ user_id: userId, fingerprint })),
            { onConflict: "user_id,fingerprint" },
          )
      ).error,
      "Could not save ignored payments.",
    );
  }

  await deleteOthers(
    client,
    "recurring_items",
    userId,
    "fingerprint",
    items.map((item) => item.fingerprint),
    "Could not update recurring payments.",
  );
  await deleteOthers(client, "recurring_ignored", userId, "fingerprint", store.ignored, "Could not update ignored payments.");
}

export async function replaceSavings(
  client: FinanceClient,
  userId: string,
  pots: SavingsPot[],
  snapshots: SavingsSnapshot[],
) {
  const potsWithIds = pots.map(ensurePotId);
  const potRows = potsWithIds.map((pot, index) => savingsPotToRow(pot, userId, index));
  if (potRows.length > 0) {
    throwIfError((await client.from("savings_pots").upsert(potRows, { onConflict: "id" })).error, "Could not save savings pots.");
  }
  if (snapshots.length > 0) {
    throwIfError(
      (
        await client.from("savings_snapshots").upsert(
          snapshots.map((snapshot) => ({
            user_id: userId,
            snapshot_date: snapshot.date,
            total_saved: snapshot.totalSaved,
          })),
          { onConflict: "user_id,snapshot_date" },
        )
      ).error,
      "Could not save savings history.",
    );
  }

  await deleteOthers(
    client,
    "savings_pots",
    userId,
    "id",
    potsWithIds.map((pot) => pot.id),
    "Could not update savings pots.",
  );
  await deleteOthers(
    client,
    "savings_snapshots",
    userId,
    "snapshot_date",
    snapshots.map((snapshot) => snapshot.date),
    "Could not update savings history.",
  );
}

async function upsertCategories(client: FinanceClient, userId: string, names: string[]) {
  const existing = await client.from("categories").select("id, name").eq("user_id", userId);
  throwIfError(existing.error, "Could not load tags.");
  const ids = new Map<string, string>();
  for (const row of existing.data ?? []) ids.set(row.name.toLowerCase(), row.id);

  const missing = names.filter((name) => !ids.has(name.toLowerCase()));
  if (missing.length > 0) {
    const inserted = await client
      .from("categories")
      .insert(missing.map((name) => ({ user_id: userId, name: name.slice(0, 80) })))
      .select("id, name");
    throwIfError(inserted.error, "Could not save tags.");
    for (const row of inserted.data ?? []) ids.set(row.name.toLowerCase(), row.id);
  }
  return ids;
}

async function deleteOthers(
  client: FinanceClient,
  table: string,
  userId: string,
  column: string,
  keep: string[],
  fallback: string,
) {
  if (keep.length === 0) {
    throwIfError((await client.from(table).delete().eq("user_id", userId)).error, fallback);
    return;
  }
  throwIfError(
    (await client.from(table).delete().eq("user_id", userId).not(column, "in", inList(keep))).error,
    fallback,
  );
}

export function inList(values: string[]): string {
  return `(${values.map((value) => `"${value.replace(/["\\]/g, "")}"`).join(",")})`;
}

function throwIfError(error: { message: string } | null, fallback: string) {
  if (error) throw new Error(error.message || fallback);
}
