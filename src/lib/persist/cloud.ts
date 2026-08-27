import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecurringStore, TrackedRecurring } from "@/lib/money-flow/recurring";
import type { PeriodFilter } from "@/lib/money-flow/period";
import type { SavingsPot, SavingsSnapshot } from "@/lib/money-flow/savings";
import type { FileInterpretation, InterpretedTransaction } from "@/lib/money-flow/types";
import {
  fileFromRow,
  fileToRow,
  neededCategoryNames,
  periodFromJson,
  recurringFromRow,
  recurringToRow,
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
    client.from("uploaded_files").select("*").eq("user_id", userId),
    client.from("transactions").select("*, categories(name)").eq("user_id", userId).order("transaction_date", { ascending: false }),
    client.from("user_preferences").select("period").eq("user_id", userId).maybeSingle(),
    client.from("recurring_items").select("*").eq("user_id", userId),
    client.from("recurring_ignored").select("fingerprint").eq("user_id", userId),
    client.from("savings_pots").select("*").eq("user_id", userId).order("sort_index", { ascending: true }),
    client.from("savings_snapshots").select("*").eq("user_id", userId).order("snapshot_date", { ascending: true }),
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
      const joined = row as typeof row & { categories: { name: string } | { name: string }[] | null };
      const categoryName = Array.isArray(joined.categories)
        ? joined.categories[0]?.name
        : joined.categories?.name;
      return transactionFromRow({ ...row, category_name: categoryName });
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
  throwIfError((await client.from("transactions").delete().eq("user_id", userId)).error, "Could not update transactions.");
  throwIfError((await client.from("uploaded_files").delete().eq("user_id", userId)).error, "Could not update documents.");

  const fileRows = files.map((file) => fileToRow(file, userId));
  let insertedFiles: { id: string; filename: string }[] = [];
  if (fileRows.length > 0) {
    const inserted = await client.from("uploaded_files").insert(fileRows).select("id, filename");
    throwIfError(inserted.error, "Could not save documents.");
    insertedFiles = inserted.data ?? [];
  }

  const fileIdByName = new Map(insertedFiles.map((file) => [file.filename, file.id]));
  const categoryIds = await upsertCategories(client, userId, neededCategoryNames(transactions));

  const txnRows = transactions.map((txn) =>
    transactionToRow(
      txn,
      userId,
      categoryIds.get(primaryTag(txn).toLowerCase()) ?? null,
      fileIdByName.get(txn.sourceFile) ?? null,
    ),
  );
  if (txnRows.length > 0) {
    throwIfError((await client.from("transactions").insert(txnRows)).error, "Could not save transactions.");
  }
}

export async function replacePeriod(client: FinanceClient, userId: string, period: PeriodFilter) {
  throwIfError(
    (await client.from("user_preferences").upsert({ user_id: userId, period })).error,
    "Could not save the period filter.",
  );
}

export async function replaceRecurring(client: FinanceClient, userId: string, store: RecurringStore) {
  throwIfError((await client.from("recurring_items").delete().eq("user_id", userId)).error, "Could not update recurring payments.");
  throwIfError((await client.from("recurring_ignored").delete().eq("user_id", userId)).error, "Could not update ignored payments.");

  const items = [...store.confirmed, ...store.custom].map((item) => recurringToRow(item, userId));
  if (items.length > 0) {
    throwIfError((await client.from("recurring_items").insert(items)).error, "Could not save recurring payments.");
  }
  if (store.ignored.length > 0) {
    throwIfError(
      (
        await client.from("recurring_ignored").insert(store.ignored.map((fingerprint) => ({ user_id: userId, fingerprint })))
      ).error,
      "Could not save ignored payments.",
    );
  }
}

export async function replaceSavings(
  client: FinanceClient,
  userId: string,
  pots: SavingsPot[],
  snapshots: SavingsSnapshot[],
) {
  throwIfError((await client.from("savings_pots").delete().eq("user_id", userId)).error, "Could not update savings pots.");
  throwIfError((await client.from("savings_snapshots").delete().eq("user_id", userId)).error, "Could not update savings history.");

  const potRows = pots.map((pot, index) => savingsPotToRow(pot, userId, index));
  if (potRows.length > 0) {
    throwIfError((await client.from("savings_pots").insert(potRows)).error, "Could not save savings pots.");
  }
  if (snapshots.length > 0) {
    throwIfError(
      (
        await client.from("savings_snapshots").insert(
          snapshots.map((snapshot) => ({
            user_id: userId,
            snapshot_date: snapshot.date,
            total_saved: snapshot.totalSaved,
          })),
        )
      ).error,
      "Could not save savings history.",
    );
  }
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

function throwIfError(error: { message: string } | null, fallback: string) {
  if (error) throw new Error(error.message || fallback);
}
