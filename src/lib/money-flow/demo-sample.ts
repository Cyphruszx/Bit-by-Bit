/**
 * Demo mode stand-in. Shown only while nobody is signed in and the ledger is
 * still empty. It is labelled Sample and is never written to the store.
 */
import { APP_TIME_ZONE } from "@/lib/money-flow/period";
import { STARTER_LIST_VERSION } from "@/lib/money-flow/starter-list";
import { appendToLedger, EMPTY_LEDGER, type Ledger } from "@/lib/money-flow/ledger";
import type { FileInterpretation, InterpretedTransaction } from "@/lib/money-flow/types";

const SAMPLE_FILE = "Sample";
const NAB = "NAB · 12345678";
const UP = "Up · Spending";

export function demoSampleApplies(input: {
  signedIn: boolean;
  imports: number;
  entries: number;
  demoSample?: boolean;
}): boolean {
  if (input.signedIn || input.demoSample) return false;
  return input.imports === 0 && input.entries === 0;
}

export function demoSampleLedger(now = new Date()): Ledger {
  const month = now.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE }).slice(0, 7);
  const on = (day: number) => `${month}-${String(day).padStart(2, "0")}`;
  const earned = { because: "earned" as const, counts: true, at: `${month}-01T00:00:00.000Z` };
  const rows: InterpretedTransaction[] = [
    row("pay", on(15), 4250, "Northwind Pty Ltd", "salary", "INCOME", NAB, { verdict: earned }),
    row("rent", on(1), -2100, "Ray White", "rent-mortgage", "SPENDING", NAB),
    row("woolies", on(3), -86.4, "Woolworths", "groceries", "SPENDING", NAB),
    row("coles", on(5), -54.2, "Coles", "groceries", "SPENDING", NAB),
    row("ampol", on(6), -78.15, "Ampol", "car", "SPENDING", NAB),
    row("opal", on(8), -42, "Transport for NSW", "getting-around", "SPENDING", NAB),
    row("telstra", on(10), -65, "Telstra", "internet-phone", "SPENDING", NAB),
    row("agl", on(12), -140.3, "AGL", "utilities", "SPENDING", NAB),
    row("grilld", on(14), -23.5, "Grill'd", "eating-out", "SPENDING", UP),
    row("netflix", on(16), -18.99, "Netflix", "streaming", "SPENDING", UP),
    row("chemist", on(18), -16.4, "Chemist Warehouse", "medical", "SPENDING", UP),
    row("medicare", on(20), 86.4, "Services Australia", "other-income", "INCOME", NAB, { verdict: earned }),
    row("interest", on(28), 1.15, "NAB interest", "other-income", "INCOME", NAB, { verdict: earned }),
    row("to-up", on(2), -200, "Transfer to Spending", "transfers", "TRANSFER", NAB, { transferPair: "sample-pocket" }),
    row("from-nab", on(2), 200, "Transfer from Everyday", "transfers", "TRANSFER", UP, { transferPair: "sample-pocket" }),
  ];

  const file: FileInterpretation = {
    filename: SAMPLE_FILE,
    fileType: "csv",
    kind: "csv",
    uploadStatus: "uploaded",
    processingStatus: "completed",
    transactionCount: rows.length,
    notes: ["Sample"],
  };
  const { ledger } = appendToLedger(EMPTY_LEDGER, { files: [file], transactions: rows }, {
    importedAt: `${month}-01T00:00:00.000Z`,
  });
  const asOf = on(28);
  return {
    ...ledger,
    demoSample: true,
    starterListVersion: STARTER_LIST_VERSION,
    imports: ledger.imports.map((record) => ({ ...record, label: "Sample", notes: ["Sample"] })),
    accounts: { [NAB]: "Everyday", [UP]: "Spending" },
    institutions: { [SAMPLE_FILE]: "NAB" },
    accountMeta: {
      [NAB]: { kind: "CHECKING", currency: "AUD", clearedBalance: 2140.55, balanceSource: "running", balanceAsOf: asOf },
      [UP]: { kind: "CHECKING", currency: "AUD", clearedBalance: 860.2, balanceSource: "running", balanceAsOf: asOf },
    },
  };
}

function row(
  id: string,
  dateIso: string,
  amount: number,
  merchant: string,
  categoryKey: string,
  type: InterpretedTransaction["type"],
  accountId: string,
  extra: Partial<InterpretedTransaction> = {},
): InterpretedTransaction {
  return {
    id,
    merchant,
    categoryKey,
    date: dateIso,
    dateIso,
    amount,
    baseAmount: amount,
    status: "CLEARED",
    type,
    sourceFile: SAMPLE_FILE,
    confidence: 1,
    accountId,
    institution: accountId.startsWith("Up") ? "Up" : "NAB",
    decidedBy: extra.verdict ? "said" : "rules",
    ...extra,
  };
}
