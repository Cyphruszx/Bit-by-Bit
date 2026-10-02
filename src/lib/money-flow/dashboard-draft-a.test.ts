import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { accountsByInstitution } from "./accounts";
import { applySilentSameInstitutionUniquePairs, forgetAutoPairs } from "./auto-pairs";
import { BankAccountsCard } from "@/components/bank-accounts-card";
import { ScopeBar } from "@/components/scope-bar";
import { classify } from "./classify";
import {
  asOfHint,
  bankInstitutionTiles,
  bankTileTotal,
  presentAccountTiles,
  snapshotAsOfDate,
} from "./dashboard";
import { interpretDocuments } from "./interpret";
import { appendToLedger, EMPTY_LEDGER, visibleTransactions, type Ledger } from "./ledger";
import { filterByPeriod, summarizePeriod } from "./period";
import { defaultTransactionScope } from "./scope";
import { filterByScope } from "./scope";
import { accountBalanceView, NO_BANK_BALANCE_LABEL } from "./statement-balance";
import { summarizeMoneyFlow } from "./summary";
import type { AccountMeta } from "./account-identity";
import type { InterpretedTransaction } from "./types";
import { applyVerdicts } from "./verdicts";

/** Retired 2025–26 corpus. The served public samples are the 2026-09 CSVs locked in sample-locks.test.ts. */
const samples = path.join(process.cwd(), "src/lib/money-flow/fixtures/retired-samples");

function txn(
  id: string,
  dateIso: string,
  amount: number,
  extras: Partial<InterpretedTransaction> = {},
): InterpretedTransaction {
  const accountId = extras.accountId ?? "NAB · Everyday";
  const row = {
    id,
    merchant: extras.merchant ?? "Cafe",
    categoryKey: extras.categoryKey ?? "groceries",
    date: dateIso.slice(8),
    dateIso,
    amount,
    type: extras.type ?? (amount > 0 ? "earned" : "spent"),
    sourceFile: "demo",
    confidence: 1,
    institution: extras.institution ?? accountId.split(" · ")[0],
    accountId,
    ...extras,
  };
  if ((row.type === "earned" || row.type === "INCOME") && !row.verdict) {
    row.verdict = { because: "earned", counts: true, at: "2026-01-01T00:00:00.000Z" };
  }
  return row;
}

/** Same read the dashboard uses: stored ledger, classify, then silent same-bank pairs. */
async function shownLedger(files: Array<{ filename: string; mime: string }>) {
  let ledger: Ledger = EMPTY_LEDGER;
  for (const file of files) {
    const parsed = await interpretDocuments(
      [
        {
          filename: file.filename,
          mime: file.mime,
          bytes: readFileSync(path.join(samples, file.filename)),
        },
      ],
      { ai: null },
    );
    ledger = appendToLedger(ledger, parsed, { importedAt: "2026-07-01T00:00:00.000Z" }).ledger;
  }
  const registry = {
    institutions: ledger.institutions ?? {},
    names: ledger.accounts ?? {},
    payers: ledger.payers ?? {},
    mergedInto: ledger.mergedInto ?? {},
  };
  const classified = forgetAutoPairs(classify(visibleTransactions(ledger), { rules: ledger.rules ?? {} }));
  const judged = applyVerdicts(classified, ledger.verdicts ?? {}, registry);
  const transactions = applySilentSameInstitutionUniquePairs(judged, {
    institutions: registry.institutions,
    accounts: registry.names,
    mergedInto: registry.mergedInto,
  });
  const meta = ledger.accountMeta ?? {};
  const tiles = bankInstitutionTiles(accountsByInstitution(transactions, registry), {
    meta,
    mergedInto: registry.mergedInto,
  });
  return { transactions, meta, tiles, registry };
}

describe("Draft A period tiles", () => {
  it("counts refund credits in Money in and still omits internal transfers", () => {
    const rows = [
      txn("pay", "2026-06-01", 2000, { type: "INCOME", categoryKey: "salary" }),
      txn("shop", "2026-06-02", -40, { type: "SPENDING" }),
      txn("kind", "2026-06-03", 25, { type: "REFUND", categoryKey: "tax-refund", merchant: "ATO" }),
      txn("linked", "2026-06-04", 15, {
        type: "REFUND",
        categoryKey: "tax-refund",
        refundPair: "refund-1",
        merchant: "Kmart",
      }),
      txn("out", "2026-06-05", -500, { type: "TRANSFER", transferPair: "pair", accountId: "Up · Spending" }),
      txn("inn", "2026-06-05", 500, { type: "TRANSFER", transferPair: "pair", accountId: "Up · Save!!" }),
    ];
    const flow = summarizeMoneyFlow(rows);
    // Salary $2,000 plus both refund credits. The transfer credit stays out.
    assert.equal(flow.cashIn, 2040);
    assert.equal(flow.cashOut, 40);
    assert.equal(flow.cashNet, 2000);
    assert.equal(flow.income, 2000);
    assert.equal(flow.refunds, 15);
  });

  it("uses transfer-excluded Money in minus Money out, not Spec 10 Net", () => {
    const rows = [
      txn("pay", "2026-03-06", 2000, { type: "earned", categoryKey: "salary" }),
      txn("loan", "2026-03-07", 25000, { type: "borrowed", categoryKey: "uncategorised", merchant: "Lender" }),
      txn("shop", "2026-03-08", -40, { type: "spent" }),
      txn("out", "2026-03-09", -500, { type: "TRANSFER", transferPair: "pair", accountId: "NAB · Everyday" }),
      txn("in", "2026-03-09", 500, { type: "TRANSFER", transferPair: "pair", accountId: "NAB · Saver" }),
    ];
    const flow = summarizeMoneyFlow(rows);
    assert.equal(flow.cashIn, 27000);
    assert.equal(flow.cashOut, 40);
    assert.equal(flow.cashNet, 26960);
    assert.equal(flow.net, 1960);
    assert.notEqual(flow.cashNet, flow.net);

    const bank = summarizeMoneyFlow(filterByScope(rows, { kind: "institution", institution: "NAB" }));
    assert.equal(bank.cashIn, 27000);
    assert.equal(bank.cashOut, 40);
    assert.equal(bank.cashNet, 26960);
  });

  it("keeps the balance snapshot when the period drops an account", () => {
    const rows = [
      txn("may", "2026-05-02", 10, { accountId: "NAB · Everyday", institution: "NAB" }),
      txn("jun", "2026-06-18", -5, { accountId: "Up · Spending", institution: "Up", type: "spent" }),
    ];
    const meta: Record<string, AccountMeta> = {
      "NAB · Everyday": { clearedBalance: 100, balanceSource: "running" },
      "Up · Spending": { clearedBalance: 40, balanceSource: "running" },
    };
    const tiles = bankInstitutionTiles(accountsByInstitution(rows), { meta });
    const juneRows = filterByPeriod(rows, { kind: "month", month: "2026-06" });
    const juneTiles = bankInstitutionTiles(accountsByInstitution(juneRows), { meta });
    const june = summarizePeriod(rows, { kind: "month", month: "2026-06" });

    assert.equal(presentAccountTiles(tiles).amount, 140);
    assert.equal(snapshotAsOfDate(rows, tiles, meta), "2026-06-18");
    assert.equal(asOfHint("2026-06-18"), "as of 18 June 2026");
    assert.equal(presentAccountTiles(juneTiles).amount, 40);
    assert.notEqual(presentAccountTiles(juneTiles).amount, presentAccountTiles(tiles).amount);
    assert.equal(june.cashIn, 0);
    assert.equal(june.cashOut, 5);
    assert.equal(june.cashNet, -5);
    assert.notEqual(june.cashNet, presentAccountTiles(tiles).amount);
  });
});

describe("bank totals hide when any account has no bank figure", () => {
  const stated = txn("stated", "2026-06-01", 10, {
    accountId: "NAB · Everyday",
    institution: "NAB",
    type: "INCOME",
    categoryKey: "salary",
  });
  const saver = txn("saver", "2026-06-02", 20, {
    accountId: "NAB · Saver",
    institution: "NAB",
    type: "INCOME",
    categoryKey: "salary",
  });
  const hidden = (id: string, accountId: string) =>
    txn(id, "2026-06-03", 5, { accountId, institution: "NAB", type: "INCOME", categoryKey: "salary" });
  const meta: Record<string, AccountMeta> = {
    "NAB · Everyday": { clearedBalance: 100, balanceSource: "running" },
    "NAB · Saver": { clearedBalance: 20, balanceSource: "fiskil" },
  };
  const readout = (rows: InterpretedTransaction[], extra: Record<string, AccountMeta> = meta) =>
    presentAccountTiles(bankInstitutionTiles(accountsByInstitution(rows), { meta: extra }));

  it("sums every bank figure and hides the total when one account has none", () => {
    const both = readout([stated, saver]);
    assert.equal(both.amount, 120);
    assert.equal(both.label, undefined);

    const oneMissing = readout([stated, hidden("hidden", "NAB · Hidden")]);
    assert.equal(oneMissing.amount, null);
    assert.equal(oneMissing.label, NO_BANK_BALANCE_LABEL);

    const pdfAndRunning = readout([stated, saver], {
      "NAB · Everyday": { clearedBalance: 100, balanceSource: "header" },
      "NAB · Saver": { clearedBalance: 20, balanceSource: "fiskil" },
    });
    assert.equal(pdfAndRunning.amount, null);
    assert.equal(pdfAndRunning.label, NO_BANK_BALANCE_LABEL);
  });

  it("does not render a partial bank total or an estimated label", () => {
    const tiles = bankInstitutionTiles(accountsByInstitution([stated, saver, hidden("hidden", "NAB · Hidden")]), {
      meta,
    });
    const total = bankTileTotal(tiles[0]!);
    assert.equal(total?.amount, null);
    assert.equal(total?.label, NO_BANK_BALANCE_LABEL);

    const html = renderToStaticMarkup(createElement(BankAccountsCard, { tiles }));
    assert.equal(html.includes("Estimated from movements"), false);
    assert.equal(html.includes("Excludes"), false);
    assert.match(html, /No balance from your bank\./);
  });
});

describe("Draft A bank balances", () => {
  it("shows a CSV figure and hides an account with only an opening", () => {
    const rows = [
      txn("inv", "2026-06-02", -1433.14, {
        accountId: "Up · Investing",
        institution: "Up",
        type: "INVESTMENT",
        categoryKey: "investments",
      }),
      txn("spend", "2026-06-30", -14.95, {
        accountId: "Up · Spending",
        institution: "Up",
        type: "SPENDING",
      }),
    ];
    const tiles = bankInstitutionTiles(accountsByInstitution(rows), {
      meta: {
        "Up · Investing": { openingBalance: 0 },
        "Up · Spending": { clearedBalance: 177.64, balanceSource: "running" },
      },
    });
    const investing = tiles[0]?.accounts.find((account) => account.name === "Investing");
    assert.equal(investing?.amount, null);
    assert.equal(investing?.balanceLabel, NO_BANK_BALANCE_LABEL);

    const total = bankTileTotal(tiles[0]!);
    assert.equal(total?.amount, null);
    assert.equal(total?.label, NO_BANK_BALANCE_LABEL);

    const missing = accountBalanceView("Up · Investing", rows.filter((row) => row.accountId === "Up · Investing"), {});
    assert.equal(missing.amount, null);
    assert.equal(missing.label, NO_BANK_BALANCE_LABEL);

    const html = renderToStaticMarkup(createElement(BankAccountsCard, { tiles }));
    assert.equal(html.includes("Estimated from movements"), false);
    assert.equal(html.includes("-$1,433.14"), false);
    assert.match(html, /\$177\.64/);
    assert.match(html, /No balance from your bank\./);

    const single = bankInstitutionTiles(
      accountsByInstitution(rows.filter((row) => row.accountId === "Up · Spending")),
      { meta: { "Up · Spending": { clearedBalance: 177.64, balanceSource: "running" } } },
    );
    assert.equal(bankTileTotal(single[0]!), null);
    const oneAccount = renderToStaticMarkup(createElement(BankAccountsCard, { tiles: single }));
    assert.equal(oneAccount.includes(">Total<"), false);
  });
});

describe("Draft A transactions scope", () => {
  it("defaults to the first bank in dashboard card order and has no Everything option", () => {
    const rows = [
      txn("up", "2026-06-01", 100, { accountId: "Up · Spending", institution: "Up", type: "earned", categoryKey: "salary" }),
      txn("nab-1", "2026-06-01", -10, { accountId: "NAB · Everyday", institution: "NAB", type: "TRANSFER" }),
      txn("nab-2", "2026-06-02", -10, { accountId: "NAB · Everyday", institution: "NAB", type: "TRANSFER" }),
      txn("nab-3", "2026-06-03", -10, { accountId: "NAB · Saver", institution: "NAB", type: "TRANSFER" }),
      txn("cba", "2026-06-01", -4, { accountId: "CommBank · Smart", institution: "CommBank", type: "spent" }),
      txn("cba-2", "2026-06-02", -4, { accountId: "CommBank · Smart", institution: "CommBank", type: "spent" }),
    ];
    const groups = accountsByInstitution(rows);
    assert.deepEqual(
      groups.map((group) => group.institution),
      ["NAB", "CommBank", "Up"],
    );
    assert.deepEqual(defaultTransactionScope(groups.map((group) => group.institution)), {
      kind: "institution",
      institution: "NAB",
    });

    const html = renderToStaticMarkup(
      createElement(ScopeBar, {
        groups,
        scope: defaultTransactionScope(groups.map((group) => group.institution)),
        onScope: () => {},
      }),
    );
    assert.equal(html.includes("Everything"), false);
    assert.match(html, /aria-pressed="true"[^>]*>NAB/);
    assert.match(html, />CommBank</);
    assert.match(html, />Up</);
  });
});

describe("Draft A sample statements", () => {
  it("quotes Up and NAB tile figures, and the snapshot ignores June", async () => {
    const up = await shownLedger([{ filename: "up-2025-07-to-2026-06.txt", mime: "text/plain" }]);
    const upFlow = summarizePeriod(up.transactions, { kind: "all" });
    const upJune = summarizePeriod(up.transactions, { kind: "month", month: "2026-06" });
    const upSnapshot = presentAccountTiles(up.tiles);
    const upTotal = bankTileTotal(up.tiles[0]!);

    // Retired up-2025-07-to-2026-06.txt — all activity.
    // Printed closings stay stored and are not shown. Income is 0 without an earned verdict.
    assert.equal(upFlow.cashIn, 70574.39);
    assert.equal(upFlow.cashOut, 71631.34);
    assert.equal(upFlow.cashNet, -1056.95);
    assert.equal(upFlow.net, -71631.34);
    assert.notEqual(upFlow.cashNet, upFlow.net);
    assert.equal(upSnapshot.amount, null);
    assert.equal(upSnapshot.label, NO_BANK_BALANCE_LABEL);
    assert.equal(snapshotAsOfDate(up.transactions, up.tiles, up.meta), null);
    assert.equal(asOfHint("2026-06-30"), "as of 30 June 2026");
    assert.equal(up.tiles[0]?.institution, "Up");
    assert.equal(up.tiles[0]?.accounts.length, 9);
    assert.equal(upTotal?.amount, null);
    assert.equal(upTotal?.label, NO_BANK_BALANCE_LABEL);
    assert.equal(upJune.cashIn, 4788.08);
    assert.equal(upJune.cashOut, 4879.57);
    assert.equal(upJune.cashNet, -91.49);
    assert.equal(presentAccountTiles(up.tiles).amount, null);

    const nab = await shownLedger([
      { filename: "nab-medicare.csv", mime: "text/csv" },
      { filename: "nab-rent.csv", mime: "text/csv" },
    ]);
    const nabFlow = summarizePeriod(nab.transactions, { kind: "all" });
    const nabJune = summarizePeriod(nab.transactions, { kind: "month", month: "2026-06" });
    const nabSnapshot = presentAccountTiles(nab.tiles);
    const nabTotal = bankTileTotal(nab.tiles[0]!);

    // Retired nab-medicare.csv + nab-rent.csv — all activity.
    // CSV Balance cells still show. Income is 0 without an earned verdict.
    assert.equal(nabFlow.cashIn, 162371.67);
    assert.equal(nabFlow.cashOut, 161822.23);
    assert.equal(nabFlow.cashNet, 549.44);
    assert.equal(nabFlow.net, -161822.23);
    assert.notEqual(nabFlow.cashNet, nabFlow.net);
    assert.equal(nabSnapshot.amount, 4913.56);
    assert.equal(nabSnapshot.label, undefined);
    assert.equal(snapshotAsOfDate(nab.transactions, nab.tiles, nab.meta), "2026-06-30");
    assert.deepEqual(
      nab.tiles[0]?.accounts.map((account) => [account.name, account.amount]),
      [
        ["···300", 4913.07],
        ["···600", 0.49],
      ],
    );
    assert.equal(nabTotal?.amount, 4913.56);
    assert.equal(nabTotal?.label, undefined);
    assert.equal(nabJune.cashIn, 37121.25);
    assert.equal(nabJune.cashOut, 35751.4);
    assert.equal(nabJune.cashNet, 1369.85);
    assert.equal(nabJune.net, -35751.4);
    assert.equal(presentAccountTiles(nab.tiles).amount, 4913.56);

    const both = await shownLedger([
      { filename: "nab-medicare.csv", mime: "text/csv" },
      { filename: "nab-rent.csv", mime: "text/csv" },
      { filename: "up-2025-07-to-2026-06.txt", mime: "text/plain" },
    ]);
    const order = accountsByInstitution(both.transactions, both.registry).map((group) => group.institution);
    assert.deepEqual(order, ["Up", "NAB"]);
    assert.deepEqual(defaultTransactionScope(order), { kind: "institution", institution: "Up" });
  });
});

describe("Draft A removed chrome", () => {
  it("drops the Income strip and the Set aside tile from the dashboard", () => {
    const view = readFileSync(new URL("../../app/(app)/dashboard/dashboard-view.tsx", import.meta.url), "utf8");
    assert.equal(view.includes("Set aside"), false);
    assert.equal(view.includes("PeriodStrip"), false);
    assert.equal(view.includes("flow.net"), false);
    const moneyIn = view.indexOf('label="Money in"');
    const moneyOut = view.indexOf('label="Money out"');
    const net = view.indexOf('label="Net"');
    const total = view.indexOf('label="Total balance"');
    assert.ok(moneyIn >= 0 && moneyIn < moneyOut && moneyOut < net && net < total);
    assert.match(view, /flow\.cashIn/);
    assert.match(view, /flow\.cashOut/);
    assert.match(view, /flow\.cashNet/);
    assert.match(view, /snapshotAsOfDate\(allTransactions/);
  });
});
