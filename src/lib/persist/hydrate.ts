import {
  hasCloudMoneyFlow,
  hasCloudRecurring,
  hasCloudSavings,
  loadCloudFinance,
  replaceMoneyFlow,
  replacePeriod,
  replaceRecurring,
  replaceSavings,
} from "@/lib/persist/cloud";
import { localHasImportableData, readLocalInterpreted, readLocalPeriod, readLocalRecurring, readLocalSavings, wipeLocalFinance } from "@/lib/persist/local";
import { financeClient, flushCloudWrites, setCloudUserId, setHydrating, setPersistError, setPersistReady } from "@/lib/persist/runtime";
import { applyRemoteMoneyFlow, resetMoneyFlowCache } from "@/components/money-flow-provider";
import { applyRemoteRecurring, resetRecurringCache } from "@/components/recurring-store";
import { applyRemoteSavings, resetSavingsCache } from "@/components/savings-store";

export async function hydrateCloudSession(userId: string | null) {
  await flushCloudWrites();
  setPersistError(null);
  if (!userId) {
    setCloudUserId(null);
    setPersistReady(false);
    setHydrating(false);
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
    const hasRemote =
      hasCloudMoneyFlow(remote) || hasCloudRecurring(remote.recurring) || hasCloudSavings(remote.pots, remote.snapshots);

    if (hasRemote) {
      applyRemoteMoneyFlow(remote.files, remote.transactions, remote.period, true);
      applyRemoteRecurring(remote.recurring, true);
      applyRemoteSavings(remote.pots, remote.snapshots, true);
      wipeLocalFinance();
    } else if (localHasImportableData()) {
      const localInterpreted = readLocalInterpreted();
      const localPeriod = readLocalPeriod();
      const localRecurring = readLocalRecurring();
      const localSavings = readLocalSavings();
      await replaceMoneyFlow(client, userId, localInterpreted.files, localInterpreted.transactions);
      await replacePeriod(client, userId, localPeriod);
      await replaceRecurring(client, userId, localRecurring);
      if (localSavings) await replaceSavings(client, userId, localSavings.pots, localSavings.snapshots);
      applyRemoteMoneyFlow(localInterpreted.files, localInterpreted.transactions, localPeriod, true);
      applyRemoteRecurring(localRecurring, true);
      if (localSavings) applyRemoteSavings(localSavings.pots, localSavings.snapshots, true);
      wipeLocalFinance();
    } else {
      applyRemoteMoneyFlow([], [], remote.period, true);
      applyRemoteRecurring(remote.recurring, true);
      applyRemoteSavings([], [], false);
    }
    setPersistReady(true);
  } catch (error) {
    setPersistError(error instanceof Error ? error.message : "Could not load your account.");
    setPersistReady(false);
  } finally {
    setHydrating(false);
  }
}
