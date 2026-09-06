# Bank adapters: finishing the two-stage reader

Written 6 September 2026, on `claude/bank-adapter-names-and-cells` (two commits on top of
`origin/main` at `cd2de60`). Read this before touching `display-name.ts`, `upgrade.ts`, or
any reader that emits a `RawMovement`.

Every figure quoted here was measured against `public/samples/` on the day it was written.

## Why this work happened

The owner asked for a reader in two stages: a per-bank filter at the front door that maps a
statement onto its own cells, then shared interpretation working from standard columns —
"like an Excel table where the bank data prefills our own ledger, keeping a column that
retains the bank transaction details."

That landed in PR #26 and it was sound. `bank-filter.ts` dispatches to `nab-statement.ts` or
`up-statement.ts`, each emits a `RawMovement` plus a `SourceRow` of the bank's own cells, and
`interpretMovement` fills the working columns. Two gaps stopped it meeting its own goal, and
this branch closes them.

## The invariant. Read this before changing any reader.

`fingerprintOf` (`ledger.ts`) is:

```
accountOf | dateIso | amount | normalize(description || merchant) | occurrence
```

`description` is optional. **Three readers set none — `text-lines.ts` (PDF, text, docx, OCR),
and the OFX and QIF builders in `parsers.ts` — so a movement from those files is identified
by its `merchant`.**

That means:

- **Adding a `description` to those readers re-keys every movement already stored**, and the
  next import of the same file adds it all a second time.
- **Changing how those readers derive `merchant` does the same thing.**

NAB and Up are safe: all 1,704 sample movements from those two carry a `description`, so
their fingerprints do not depend on `merchant` at all.

The rule this branch follows, and that anything after it should follow: **add evidence, never
move identity.** New cells and new bank wording, yes. Renaming a movement on a reader that is
identified by its name, no.

`upgrade.ts` enforces the same rule in code — `printedName()` returns early for any row with
no `description`, and `upgrade.test.ts` pins both halves ("leaves a movement identified by its
name alone completely alone", "keeps the fingerprint where it was for every row it does
rename").

## What changed

### 1. Each bank names its own movements (`74880bf`)

`display-name.ts` used to ask the stored cells for `"Merchant Name"`, `"Lines"` and
`"Transaction Details"` — NAB's and Up's vocabularies sitting in shared code that every row
passes through. Adding a third bank meant editing it again, which is the coupling the
adapters exist to remove.

- **`display-name.ts`** is now the generic fallback only: `bank?.merchant || merchant ||
  description`, collapsed, `"Unknown"` when empty. It reads no source cells. A test asserts
  this by inspection so the lookups cannot quietly come back.
- **`up-statement.ts`** absorbed `nameFromPrintedLines` and exports it. It reads Up's block
  layout — the time line, and the counterparty printed in front of the rail on the next line
  — and belongs with the rest of Up's format.
- **`interpret-row.ts`** no longer passes `source` into `displayName`. Nothing else changed:
  each adapter already put the printed name in the movement's own `merchant` or
  `description`, so the fallback reaches the same answer it did before.
- **`upgrade.ts`** gained `printedName()` and `fromPrintedCells()`, which recover the name on
  rows stored before the adapters settled one. This is where the two banks' name cells now
  live, deliberately: a migration is allowed to know history, and **a bank added from here on
  never needs an entry there** because its rows are born with the right name.
- **`storedInCurrentModel()`** now compares `merchant`, so `persistTaxonomy` writes a
  recovered name back once on load rather than recomputing it per render.
- **`transaction-table.tsx`, `unsettled-money.tsx`, `upload-studio.tsx`** read `txn.merchant`
  directly. They were calling `displayName(txn)` per row per keystroke to recompute what was
  already stored.

### 2. Every reader records the cells it read (`452adc4`)

Only the two table readers kept source cells, so the "Show statement" panel was full for a
spreadsheet and **empty for a PDF** — a feature that reads as broken rather than absent.

- **`text-lines.ts`** emits `source` (`Date`, `Description`, `Amount`, `Balance`) and
  `bank: { type: row.description }`. It already held all of it and was discarding it.
- **`parsers.ts` (OFX)** emits `source` (`Type`, `Date posted`, `Amount`, `Name`, `Memo`,
  `Reference`) and `bank: { type: TRNTYPE }`. **Only the transaction block is read** — the
  account and routing numbers sit in the header above it and are never captured.
- **`parsers.ts` (QIF)** emits `source` (`Date`, `Amount`, `Payee`, `Memo`, `Number`,
  `Category`) and `bank: { type: N, category: L }`.
- **None of them gains a `description`.** See the invariant above.

The bank wording is the part that is not cosmetic. `looksInternal` and `looksReturned`
(`statement-category.ts`) read only `bank` plus `description`/`merchant`, so a PDF saying
`TRANSFER TO SAVINGS` or a QIF filing a movement under `Transfer` was invisible to both.
`unmatchedInternal` therefore only ever counted on spreadsheets.

## Verifying a change here

`npm run typecheck`, `npm run lint`, `npm test` — **414 tests, 86 suites, none skipped.**

Then, because this touches how a statement is read, check it against `public/samples/`.
Import all three files, then `markTransferLegs` → `markRefundLegs` → `summarizeMoneyFlow`:

| | Expected |
|---|---|
| Income | $142,796.02 |
| Spending | $168,303.53 |
| Own-money transfers | $118,183.87 |
| Movements | 1,704 |
| Transfer pairs | 169, contested 0 |
| NAB cash in / out | $204,214.49 / $203,665.05 |
| Up cash in / out | $85,020.99 / $86,077.94 |

Names must still read `KFC`, `Grill'd`, `PayPal`, `JORDAN LEE` — not `Kfc`, `Grill'D`,
`Paypal`, `Osko Payment Received`.

**The migration check is the one that matters.** Build a ledger from the samples, strip
`source` and `bank` from every entry and re-tidy `merchant` to simulate a pre-adapter store,
then `appendToLedger` the same import again. Expect **0 added, 1,704 duplicates**, totals
unchanged, and the names recovered. Any non-zero `added` is double-counting and blocks the
change.

## Judgement calls made here, open to reversal

- **PDF and text statements store the running balance.** The owner had not settled this. It
  is stored for consistency with NAB, whose `Balance` column was already kept. It is one line
  in `text-lines.ts` to remove, and it does mean every PDF row now carries a wealth figure
  that syncs to the cloud.
- **`ai.ts` was left alone.** A model's answer is not a statement cell, and putting it in the
  same field would turn a guess into evidence.

## Not done, and why

- **Account numbers still reach the cloud.** `docs/HANDOVER.md` records the decision "never
  store raw account numbers — a salted hash plus a friendly label". Supabase has landed,
  `accountKey` holds `100200300` verbatim, the source cells hold it again, and the whole
  ledger is uploaded unfiltered — `redact.ts` guards the AI path only. This predates the
  adapter work. It needs its own change: account identity feeds transfer matching and the
  duplicate check, so it carries real migration risk.
- **Up's `Lines` cell (~129 KB of a 1,676 KB ledger).** Now safe to drop — nothing reads it
  for names any more, only `upgrade.ts` for historical rows. Owner's call, since it is the
  most faithful record of what a text statement printed.
- **Photocopies still sync.** The owner chose this deliberately. Stripping them from the
  cloud push would save ~25%, but a second device would show empty statement panels for every
  statement it did not import itself, and the fix would have to be applied *only* to the value
  handed to `rows.insert`/`rows.update` — stripping earlier in `push()` would let
  `local.save(merged)` destroy the local cells on a revision conflict.

## Corrections to `docs/HANDOVER.md`

That file is stale as of 4 September 2026 in two places worth knowing:

- It states income of **$167,796.02**. The measured figure is **$142,796.02** — the $25,000
  SocietyOne drawdown now types as `borrowed` and sits outside income. `income.test.ts`,
  `interpret.test.ts` and `taxonomy.test.ts` all assert the lower figure.
- It states "no code reads or writes Supabase and there is no `@supabase/*` dependency". Both
  halves are now false: nine files under `src/` import Supabase and `cloud-rows.ts` reads and
  writes the `ledgers` table.
