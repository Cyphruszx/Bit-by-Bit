# BitbyBit handover

Written 1 September 2026, at the end of the session that built the ledger. Read this before touching the money-flow code.

## What the product is trying to do

BitbyBit reads bank statements a person uploads and tells them where their money went. The owner's words: data interpretation is the core function of the app. The thing that matters most to them is that **money is never counted twice** — not when the same statement is uploaded again, and not when they move their own money between their own accounts.

## Ground truth you can rely on

Three anonymised statements live in `public/samples/`. Every number below is measured, not estimated, and any change to the interpretation should be checked against them.

| Sample | Account | Covers | Movements |
|---|---|---|---|
| `nab-medicare.csv` | NAB everyday, `100200300` | 1 Jul 2025 – 30 Jun 2026 | 378 |
| `nab-rent.csv` | NAB rent/offset, `400500600` | 2 Jul 2025 – 30 Jun 2026 | 59 |
| `up-2025-07-to-2026-06.txt` | Up transaction account plus 8 savers | 1 Jul 2025 – 30 Jun 2026 | 1267 |

The NAB pair reads correctly and reconciles: money in **$204,214.49**, money out **$203,665.05**, net **$549.44**. Everyday alone is $164,344.90 / $160,675.88 / $3,669.02; rent alone is $39,869.59 / $42,989.17 / −$3,119.58. These are asserted in `ledger.test.ts` and `interpret.test.ts`. If you break them, you have broken the reader.

Two measurements drive the whole roadmap:

- **Between the two NAB accounts**: 27 transfers, **$41,842.82 on each side**, every one same-day with no ambiguity. That is a fifth of the reported money in and out being the same dollars counted twice.
- **Between NAB and Up**: 91 transfers, **$52,440.06 on each side**, matching on equal amount within two business days with the credit not preceding the debit. **12 of those had more than one candidate**, which is why the matcher must score candidates and refuse to guess rather than take the first match.

The samples are anonymised with a shared pseudonym: the account holder is **Jordan Lee** in all three files, so the transfers between banks still line up. Never commit a real statement. `interpret.test.ts` has a test that fails if personal detail reappears in a sample.

## Where the work has got to

`main` has the interpretation module, the dashboard cash totals, the Together/Separate document view, and the compact transactions UI — [#15](https://github.com/Cyphruszx/Bit-by-Bit/pull/15), [#16](https://github.com/Cyphruszx/Bit-by-Bit/pull/16).

[#17](https://github.com/Cyphruszx/Bit-by-Bit/pull/17) on `cursor/ledger-accumulation-c20d` is open and is the first slice of the interpretation plan. It adds:

- `src/lib/money-flow/ledger.ts` — movement fingerprints, append-and-merge, import records, statement grouping, removal.
- `src/lib/store/ledger-store.ts` — IndexedDB behind a three-call interface, migrating the old localStorage blob.
- Account capture in `tabular.ts` / `interpret-row.ts`, so a movement knows which account it came from.
- The Up sample and the year fix described below.

Verified in a browser: uploading one NAB account then both accumulates to the combined totals, a deliberate duplicate upload reports "Nothing new" and moves nothing, the ledger survives a reload, and removing a statement takes its movements with it.

## The Up statement bug, now fixed

`up-2025-07-to-2026-06.txt` reconciles. The statement heads itself **Money In $70,574.39, Money Out $71,631.34**, and the reader now produces exactly that across **1267 movements**.

The diagnosis in the first draft of this handover was wrong on both counts, so do not build on it:

- **The amounts were never over-read.** Every Up line carries an amount followed by a running balance, and those balances form an unbroken chain within each account. Walking each chain from its opening to its closing balance reproduces all 1267 stated amounts to the cent, with no mismatches, so `transactionFromBlock` was taking the right value all along.
- **The reader was losing movements, not inventing them.** The 1247 figure was the count *after* the pipeline had silently deleted 20 rows.

What was actually wrong:

- **`uniqueTransactions` in `summary.ts` keyed on date, amount and merchant alone**, so a movement that legitimately repeats was discarded — 20 rows carrying $2,184.45 in and $501.05 out. The savers show it most plainly: several are paid a cent of interest on the same morning under an identical description, and only the first cent survived. It now counts how often a description has already appeared *within its own file*, the same occurrence rule `fingerprintOf` uses in `ledger.ts`, so a re-uploaded file still collapses while a genuine repeat is kept.
- **Up's Money In and Money Out exclude the holder's own internal transfers.** The file holds nine accounts — the Spending account and eight savers — and 84 rows move money between them, $14,446.60 in each direction, every leg written twice. `inferType` already types these as `transfer` and `income`/`spending` already exclude transfers, so once the dropped rows came back the totals landed on the statement's own figures with no further change.

The arithmetic closes end to end: opening $398.25 + $70,574.39 in − $71,631.34 out + $836.34 drawn down out of the savers = the closing balance of $177.64, and the savers' own balances fall by exactly that $836.34.

Two tests in `interpret.test.ts` pin the reconciliation and the mirrored transfer legs, so this cannot drift again unnoticed.

Note that the savers are still merged into one file's worth of movements rather than carrying an account of their own. That is stage 2 below, and it is unfinished — the totals are right, but the app cannot yet say which account a saver movement belongs to.

## The plan the owner agreed to

Stages, in order. Only the ledger is done.

1. **Ledger accumulation** — done in #17.
2. **Account identity** — give every movement an `accountId` with an institution and a display label, group by account rather than by file, and split the Up savers into their own accounts. `accountKey` already exists on `InterpretedTransaction` and is populated for NAB; this stage builds on it. Nothing else can be correct before this.
3. **Bank profiles** — turn the ad-hoc handling into a profile per bank and format, each with a fixture and golden totals. NAB and Up already have bespoke pieces in `statement-category.ts` and `up-statement.ts`; today's heuristics become the fallback profile.
4. **The transfer matcher** — pair a debit with a credit of equal amount in a different account. Requirements the owner asked for explicitly, and the measurements that justify them:
   - Count **business days, not calendar days**. All 446 NAB movements fall Monday to Friday, so a Friday transfer landing Monday is one business day, not three.
   - Size the window to the route: same bank stays at one business day, cross-institution gets two or three, slower rails get more but demand corroboration.
   - **Respect the arrow of time** — a credit may lag the debit by the whole window but lead it by at most a day.
   - **Score candidates and require a clear winner**, because $500 appears 25 times as an outgoing amount, $300 twenty times and $200 seventeen times. Where two candidates tie, leave it unmatched and ask. 12 of the 91 cross-bank pairs are in this position.
   - **Match recurring series** rather than single legs where a repeated amount runs on a cadence.
   - **Re-match when new statements arrive**, over the whole ledger, idempotently — a transfer sent at the end of one statement lands in the next.
   - Also collapse **pending-then-settled** duplicates within one account, which is the other face of delay.
5. **Confidence tiers** — a matched pair between two accounts we hold is certain and both legs leave income and spending. A leg the bank labels internal whose partner is missing stays in the totals but is flagged. A counterparty the user confirms is their own account elsewhere is treated as a transfer on their say-so and remembered, which is how the 119 payments to "Jordan Lee" get resolved before the Up statement is uploaded.
6. **Totals that cannot double count** — add true income, true spending and internal transfers to `MoneyFlowSummary`, keeping `cashIn`/`cashOut` for per-account reconciliation. Any figure spanning more than one account excludes matched legs; any single-account figure keeps them so it still ties to the bank. Assert three invariants: per-account nets sum to the household net, matched legs sum to zero, and true income minus true spending equals net.

## Decisions already taken with the owner

- **Storage is local-first for now.** IndexedDB, no sign-in. Supabase is the agreed destination and `main` already carries `supabase/migrations/202608210001_initial_finance_schema.sql` with an `accounts` table and RLS. [#9](https://github.com/Cyphruszx/Bit-by-Bit/pull/9) has the client, cookie auth and a `unique (user_id, client_key)` constraint that suits idempotent import; it is behind `main` and conflicts only in `AGENTS.md`. The owner wants sign-in made mandatory **later**, once everything is set up.
- When Supabase does land, **never store raw account numbers** — a salted hash plus a friendly label. `src/lib/persist/redact.ts` on #9 already masks identifiers in descriptions.
- Unmatched transfer legs count as spending **with a flag**, not quarantined, unless the owner revisits it.
- Still unanswered: whether "Casey Lee Offset", which receives $35,500 across 11 payments from the NAB everyday account, is the owner's own account or another person's.

## How to work in this repo

`AGENTS.md` is short and binding. Two rules matter most:

- **Ask first.** Do not start a feature, architecture change or extra slice until the owner confirms. They are specific about scope and will say no.
- **Skip screenshots and screen recordings.** The owner verifies on the Vercel preview. Run `npm run typecheck`, `npm run lint` and `npm test`, then commit and push. When a change affects how a statement is read, verify against a file in `public/samples/` and quote the numbers.

Everything is currently green: **112 tests, none skipped**, lint, typecheck and build clean.

Commits are small and single-purpose, with a plain-English subject in the imperative and a body explaining why, not what. Branches are `cursor/<name>-c20d`. Never merge a PR — the owner does that. Stacked PRs need their base retargeted by hand before merging, because the repo does not delete head branches on merge; that mistake already sent one PR into the wrong branch and needed [#16](https://github.com/Cyphruszx/Bit-by-Bit/pull/16) to fix.

For manual checks, the dev server runs from `/workspace` in the tmux session `bitbybit-dev` on port 3000. Use `http://localhost:3000`, never `127.0.0.1` — the dev server blocks cross-origin dev resources from that host and the JavaScript silently fails to load.

## Where the code lives

`src/lib/money-flow/` holds the interpretation: `interpret.ts` orchestrates, `parsers.ts` dispatches by file kind, `tabular.ts` reads CSV and spreadsheet tables, `up-statement.ts` reads Up's layout, `text-lines.ts` handles loose text, `interpret-row.ts` turns a raw row into a signed, typed, tagged movement, `categorize.ts` and `statement-category.ts` do the labelling, `summary.ts` totals everything, `ledger.ts` accumulates, `documents.ts` groups by file for the dashboard, and `period.ts` filters by month or range.

`src/components/money-flow-provider.tsx` is the single client-side store: it holds the ledger, hydrates it from IndexedDB, and exposes imports, statements and tag edits. Sample-data tag edits deliberately live in their own localStorage key so the ledger only ever holds real statements.
