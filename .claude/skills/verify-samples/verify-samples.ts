/**
 * Reads every file in public/samples/ the way the app reads an upload, then prints the
 * figures it arrived at. AGENTS.md asks that a change to how a statement is read be
 * checked against a real file with the numbers quoted; this prints those numbers in the
 * shape the commit messages already quote them, so the check is one command rather than a
 * script written fresh each time.
 *
 * The reader runs with AI off, so two runs of an unchanged reader print the same figures
 * and any difference belongs to the change under test.
 *
 * Run: npx tsx .claude/skills/verify-samples/verify-samples.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { interpretDocuments } from "@/lib/money-flow/interpret";
import { matchTransfers } from "@/lib/money-flow/transfers";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

const SAMPLES = path.join(process.cwd(), "public", "samples");

/** Merchants the fixtures are known to print, so a tidying change cannot quietly eat a name. */
const SPOT_CHECK_MERCHANTS = ["KFC", "Grill'd", "PayPal", "JORDAN LEE"];

const MIME_BY_EXTENSION: Record<string, string> = {
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
  ".ofx": "application/x-ofx",
  ".qfx": "application/x-ofx",
  ".qif": "application/qif",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function money(value: number): string {
  return value.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function line(label: string, value: string): void {
  console.log(`  ${pad(label, 21)}${padStart(value, 14)}`);
}

function institutionOf(txn: InterpretedTransaction): string {
  return txn.institution ?? "Unknown source";
}

async function main(): Promise<void> {
  const filenames = readdirSync(SAMPLES)
    .filter((name) => !name.startsWith("."))
    .sort();

  if (filenames.length === 0) {
    console.error(`No sample files in ${SAMPLES}`);
    process.exitCode = 1;
    return;
  }

  const files = filenames.map((filename) => ({
    filename,
    mime: MIME_BY_EXTENSION[path.extname(filename).toLowerCase()] ?? "application/octet-stream",
    bytes: new Uint8Array(readFileSync(path.join(SAMPLES, filename))),
  }));

  console.log(`Reading ${files.length} file(s) from public/samples — AI off, merchant rules only`);

  const result = await interpretDocuments(files, { ai: null });
  const { flow } = result;
  const match = matchTransfers(result.transactions);

  console.log("\nFILES");
  for (const file of result.files) {
    const status = file.processingError
      ? `${file.processingStatus}: ${file.processingError}`
      : file.processingStatus;
    console.log(
      `  ${pad(file.filename, 32)}${pad(file.kind, 8)}${pad(status, 12)}${padStart(String(file.transactionCount), 6)} movements`,
    );
    for (const note of file.notes) {
      console.log(`      note: ${note}`);
    }
  }

  console.log("\nTOTALS");
  line("Movements", String(flow.transactionCount));
  line("Income", money(flow.income));
  line("Spending", money(flow.spending));
  line("Net", money(flow.net));
  line("Own-money transfers", money(flow.transfers));
  line("Refunds", money(flow.refunds));
  line("Unsettled", money(flow.unmatchedInternal));
  line("Transfer pairs", String(match.pairs.length));
  line("Contested", String(match.contested.length));
  line("Period", flow.periodLabel);

  const byInstitution = new Map<string, { count: number; inflow: number; outflow: number }>();
  for (const txn of result.transactions) {
    const key = institutionOf(txn);
    const seen = byInstitution.get(key) ?? { count: 0, inflow: 0, outflow: 0 };
    seen.count += 1;
    if (txn.amount >= 0) {
      seen.inflow += txn.amount;
    } else {
      seen.outflow += Math.abs(txn.amount);
    }
    byInstitution.set(key, seen);
  }

  console.log("\nBY INSTITUTION");
  for (const [name, totals] of [...byInstitution].sort((a, b) => b[1].count - a[1].count)) {
    console.log(
      `  ${pad(name, 20)}${padStart(String(totals.count), 6)} movements   in ${padStart(money(totals.inflow), 14)}   out ${padStart(money(totals.outflow), 14)}`,
    );
  }

  console.log("\nNAME SPOT-CHECK");
  for (const name of SPOT_CHECK_MERCHANTS) {
    const needle = name.toLowerCase();
    const found = result.transactions.some(
      (txn) =>
        txn.merchant.toLowerCase().includes(needle) ||
        (txn.description ?? "").toLowerCase().includes(needle),
    );
    console.log(`  ${pad(name, 20)}${found ? "still read" : "MISSING"}`);
  }

  console.log("\nTOP CATEGORIES");
  for (const category of flow.categories.slice(0, 10)) {
    console.log(`  ${pad(category.name, 20)}${padStart(money(category.amount), 14)}${padStart(`${category.share}%`, 8)}`);
  }

  if (flow.insights.length > 0) {
    console.log("\nINSIGHTS");
    for (const insight of flow.insights) {
      console.log(`  ${insight}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
