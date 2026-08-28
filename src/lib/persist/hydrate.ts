import {
  hasCloudMoneyFlow,
  hasCloudRecurring,
  hasCloudSavings,
  loadCloudFinance,
  replaceMoneyFlow,
  replacePeriod,
  replaceRecurring,
  replaceSavings,
  type CloudFinance,
} from "@/lib/persist/cloud";
import {
  localHasImportableData,
  readLocalInterpreted,
  readLocalPeriod,
  readLocalRecurring,
  readLocalSavings,
  wipeLocalFinance,
  type LocalInterpreted,
  type LocalSavings,
} from "@/lib/persist/local";
import {
  clearDeferredWrites,
  financeClient,
  flushCloudWrites,
  hasDeferredWrite,
  setCloudUserId,
  setHydrating,
  setPersistError,
  setPersistReady,
} from "@/lib/persist/runtime";
import { applyRemoteMoneyFlow, resetMoneyFlowCache } from "@/components/money-flow-provider";
import { applyRemoteRecurring, resetRecurringCache } from "@/components/recurring-store";
import { applyRemoteSavings, resetSavingsCache } from "@/components/savings-store";
import { ALL_PERIOD } from "@/lib/money-flow/period";
import type { RecurringStore } from "@/lib/money-flow/recurring";

const emptyRecurring: RecurringStore = { ignored: [], confirmed: [], custom: [] };

export type LocalFinanceSnapshot = {
  interpreted: LocalInterpreted;
  period: ReturnType<typeof readLocalPeriod>;
  recurring: RecurringStore;
  savings: LocalSavings | null;
};

export function storesToImportFromLocal(remote: CloudFinance, local: LocalFinanceSnapshot) {
  const hasLocalMoney = local.interpreted.files.length > 0 || local.interpreted.transactions.length > 0;
  const hasLocalRecurring =
    local.recurring.ignored.length > 0 || local.recurring.confirmed.length > 0 || local.recurring.custom.length > 0;
  const hasLocalSavings = local.savings != null;
  return {
    money: !hasCloudMoneyFlow(remote) && hasLocalMoney,
    recurring: !hasCloudRecurring(remote.recurring) && hasLocalRecurring,
    savings: !hasCloudSavings(remote.pots, remote.snapshots) && hasLocalSavings,
  };
}

function applyLoadedMoney(
  files: CloudFinance["files"],
  transactions: CloudFinance["transactions"],
  period: CloudFinance["period"],
) {
  applyRemoteMoneyFlow(files, transactions, period, true, {
    money: hasDeferredWrite("money"),
    period: hasDeferredWrite("period"),
  });
}

function applyLoadedRecurring(store: RecurringStore) {
  if (!hasDeferredWrite("recurring")) applyRemoteRecurring(store, true);
}

function applyLoadedSavings(pots: CloudFinance["pots"], snapshots: CloudFinance["snapshots"]) {
  if (!hasDeferredWrite("savings")) applyRemoteSavings(pots, snapshots, true);
}

export async function hydrateCloudSession(userId: string | null) {
  await flushCloudWrites();
  setPersistError(null);
  if (!userId) {
    setCloudUserId(null);
    setPersistReady(false);
    setHydrating(false);
    clearDeferredWrites();
    resetMoneyFlowCache();
    resetRecurringCache();
    resetSavingsCache();
    return;
  }

  setHydrating(true);
  setPersistReady(false);
  setCloudUserId(userId);
  try {
    const client = financeClient();
    const remote = await loadCloudFinance(client, userId);
    if (localHasImportableData()) {
      const local: LocalFinanceSnapshot = {
        interpreted: readLocalInterpreted(),
        period: readLocalPeriod(),
        recurring: readLocalRecurring(),
        savings: readLocalSavings(),
      };
      const importing = storesToImportFromLocal(remote, local);

      if (importing.money) {
        await replaceMoneyFlow(client, userId, local.interpreted.files, local.interpreted.transactions);
        await replacePeriod(client, userId, local.period);
        applyLoadedMoney(local.interpreted.files, local.interpreted.transactions, local.period);
      } else {
        applyLoadedMoney(remote.files, remote.transactions, remote.period);
      }

      if (importing.recurring) {
        await replaceRecurring(client, userId, local.recurring);
        applyLoadedRecurring(local.recurring);
      } else {
        applyLoadedRecurring(remote.recurring);
      }

      if (importing.savings && local.savings) {
        await replaceSavings(client, userId, local.savings.pots, local.savings.snapshots);
        applyLoadedSavings(local.savings.pots, local.savings.snapshots);
      } else {
        applyLoadedSavings(remote.pots, remote.snapshots);
      }

      wipeLocalFinance();
    } else {
      applyLoadedMoney(remote.files, remote.transactions, remote.period);
      applyLoadedRecurring(remote.recurring);
      applyLoadedSavings(remote.pots, remote.snapshots);
    }
    setHydrating(false);
    setPersistReady(true);
  } catch (error) {
    setPersistError(error instanceof Error ? error.message : "Could not load your account.");
    clearDeferredWrites();
    applyRemoteMoneyFlow([], [], ALL_PERIOD, true);
    applyRemoteRecurring(emptyRecurring, true);
    applyRemoteSavings([], [], true);
    setPersistReady(false);
    setHydrating(false);
  }
}
