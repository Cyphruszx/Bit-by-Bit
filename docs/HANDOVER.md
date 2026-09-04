# BitbyBit handover

Rewritten 4 September 2026. Read this before touching the money-flow code. Everything below was
checked against the code and the samples on the day it was written; where a figure is quoted, it is
measured.

## What the product is trying to do

BitbyBit reads bank statements a person uploads and tells them where their money went. The owner's
words: data interpretation is the core function of the app. The thing that matters most is that
**money is never counted twice** — not when the same statement is uploaded again, and not when the
person moves their own money between their own accounts.

A second rule now sits beside it, because the app is about numbers a person can trust: **the app
never shows a figure that is not the person's own.** There is no sample data anywhere in `src/`. An
empty ledger renders an empty state, never a plausible number.

## Ground truth you can rely on

Three anonymised statements live in `public/samples/`. They are fixtures for the tests and for the
"try a sample" buttons on the upload page — a person has to ask for them, and they arrive through the
real import path as real statements they can then remove.

| Sample | Account | Covers | Movements |
|---|---|---|---|
| `nab-medicare.csv` | NAB everyday, `100200300` | 1 Jul 2025 – 30 Jun 2026 | 378 |
| `nab-rent.csv` | NAB rent/offset, `400500600` | 2 Jul 2025 – 30 Jun 2026 | 59 |
| `up-2025-07-to-2026-06.txt` | Up transaction account plus 8 savers | 1 Jul 2025 – 30 Jun 2026 | 1267 |

The NAB pair reconciles: money in **$204,214.49**, money out **$203,665.05**, net **$549.44**.
Everyday alone is $164,344.90 / $160,675.88 / $3,669.02; rent alone is $39,869.59 / $42,989.17 /
−$3,119.58. The Up file heads itself **Money In $70,574.39, Money Out $71,631.34** and the reader
produces exactly that across 1267 movements. All asserted in `ledger.test.ts` and `interpret.test.ts`.
Break these and you have broken the reader.

Across all three, read together: income **$167,796.02**, spending **$168,303.53**, net **−$507.51**,
with **$118,183.87** of it being the person's own money moving between their own accounts —
$41,842.82 NAB↔NAB across 27 transfers, $61,894.45 NAB↔Up across 100, and $14,446.60 inside Up
across 42. That is **169 pairs, 338 legs, and nothing contested**: an earlier measurement found 18
cross-bank debits with more than one equal-amount candidate, and scoring plus the wording tie-break
now resolves every one of them. `interpret.test.ts` asserts the zero, so if a change starts making
the matcher guess, that test says so.

The samples are anonymised with a shared pseudonym: the account holder is **Jordan Lee** in all three
files, so the transfers between banks still line up. Never commit a real statement.
`interpret.test.ts` fails if personal detail reappears in a sample.

## Where the work has got to

Everything below is on `claude/app-feature-prioritization-j74puw`, which is 30+ commits ahead of
`main` and has no PR open. `npm run typecheck`, `npm run lint`, `npm test` (**287 tests, 61 suites,
none skipped**) and `npm run build` are all clean.

Of the six stages the owner agreed to, **five are built**:

1. **Ledger accumulation** — done. `ledger.ts` fingerprints each movement as
   `account | dateIso | amount | normalised description | occurrence-within-file`, so a genuine
   same-day repeat survives while a re-uploaded file collapses. `ledger-store.ts` holds it in
   IndexedDB behind a three-call interface.
2. **Account identity** — done. `institution.ts` names the bank from the statement's own wording,
   `account-identity.ts` reads an account ref from the letterhead (number beats masked tail beats
   name), `accounts.ts` groups by account and bank, and the Up savers each get an account of their
   own. A shared number merges; a shared last-four is only ever *offered*.
3. **Bank profiles** — **not started.** This is the one gap. See below.
4. **The transfer matcher** — done in `transfers.ts`. Pairs a debit with a credit of equal cent in a
   different account, within 1 business day same-bank or 2 cross-bank, credit not before debit,
   nearest calendar day wins. Genuinely tied candidates are recorded as `contested` and left counted
   rather than guessed. Idempotent over the whole ledger. The bank's own wording is deliberately not
   trusted — NAB calls 212 movements a transfer and only 54 of them are.
5. **Confidence tiers** — done via `verdicts.ts`. Six reasons (earned / money-back / own-account /
   borrowed / spent / not-mine), keyed by **wording rather than by row**, so settling a payer settles
   all 172 of its movements at once and survives a re-import. Every verdict can be taken back, and
   `counts` is always recomputed from the reason rather than trusted from storage.
6. **Totals that cannot double count** — done in `summary.ts`. `income`/`spending`/`net` exclude a
   transfer pair only when **both** legs are in the set being summarised, so scoping to one bank
   produces that bank's own figures rather than a subset of the household's. `cashIn`/`cashOut` stay
   raw so a single account still ties to its statement.

Built beyond the plan: **refund pairing** (`refunds.ts` — only ever by finding the payment a credit
reverses, because NAB files a year of Medicare benefits under the category "Refund"), **payer name
merging** (`payers.ts`), **income rhythm** (`rhythm.ts` — what a stream is worth a week, with breaks
set aside), **income composition** (`income.ts`), **scoping** (`scope.ts`), and a **balance-chain
statement reader** (`text-lines.ts`) that recovers each amount's direction from the running balance
and refuses to publish a reading that does not reconcile.

## What was just removed, and why

The app used to substitute `src/lib/demo-data.ts` whenever the ledger was empty. Dashboard,
Transactions and Recurring showed sample money with only their prose hinting at it; Savings seeded
itself from the same file's goals, so a new user saw "Emergency fund $8,400 / $12,000" and "Japan
trip" as if they were their own, with no label anywhere; and the tag chart's `fallbackSeries` negated
every category, drawing income as spending.

`demo-data.ts` is **deleted**, along with `usingDemo`, the `bitbybit.demo-tags-v1` store, and
`seedSavingsPots()`. Dashboard, Transactions and Accounts now render `components/empty-ledger.tsx`
until a statement exists; Savings starts with no pots; Recurring keeps its manual add form, which
works without any upload. The header pill reads "No statements yet" instead of "Demo data".

## The one stage still open

**Bank profiles.** Per-bank handling is spread across at least five files with no shared shape:
`up-statement.ts` (Up's whole layout), a hardcoded `looksLikeUpStatement` branch in `parsers.ts`, a
NAB header-triple note in `statement-category.ts`, nine pooled header vocabularies in `tabular.ts`,
and merchant rules in `categorize.ts` visibly seeded from the samples. `institution.ts` has a
`PROFILES` list, but it only *names* the bank — no parser, no fixture, no golden totals. Adding a
third bank today means editing four files separately.

## Other known gaps

- **Goals does not exist.** `app/(app)/goals/page.tsx` is a five-line redirect to `/savings` and is
  not in the nav. Savings pots are hand-typed; nothing derives a pot from a statement, though the
  engine now computes everything a real goal projection would need.
- **Destructive actions are unconfirmed.** "Clear uploads" wipes the ledger with no dialog and there
  is no backup anywhere. Same for tag Remove, pot Remove, and Stop tracking.
- **Test coverage holes.** The `.docx` (mammoth), JSON and HTML read paths have no tests; the live
  `tesseract.js` call is never exercised (`ai.test.ts` injects a stub); `ledger-store.ts` is untested.
- **`accept.ts` has drifted from `detect.ts`.** `.bmp` and `.xlsm` are detected but not offered in the
  file picker.
- **The transfer matcher is missing two agreed requirements**: matching a recurring *series* rather
  than single legs, and collapsing pending-then-settled duplicates within one account.
- **AI is off by default and is OpenAI.** `ai.ts` calls the Chat Completions API (`gpt-4o-mini` by
  default) for photo extraction and tag suggestions, gated on `OPENAI_API_KEY`. Without a key, photos
  fall back to on-device OCR and the upload page says so.

## Decisions already taken with the owner

- **Storage is local-first for now.** IndexedDB, no sign-in. `supabase/migrations/` carries a full
  multi-tenant schema with RLS, but **no code reads or writes Supabase and there is no `@supabase/*`
  dependency**. The owner wants sign-in made mandatory later, once everything is set up.
- When Supabase lands, **never store raw account numbers** — a salted hash plus a friendly label.
- Unmatched transfer legs count as spending **with a flag**, not quarantined.
- Still unanswered: whether "Casey Lee Offset", which receives $35,500 across 11 payments from the NAB
  everyday account, is the owner's own account or another person's.

## How to work in this repo

`AGENTS.md` is short and binding. Two rules matter most:

- **Ask first.** Do not start a feature, architecture change or extra slice until the owner confirms.
- **Skip screenshots and screen recordings.** The owner verifies on the Vercel preview. Run
  `npm run typecheck`, `npm run lint` and `npm test`, then commit and push. When a change affects how
  a statement is read, verify it against a file in `public/samples/` and quote the numbers.

Commits are small and single-purpose, with a plain-English subject in the imperative and a body
explaining why, not what. Never merge a PR — the owner does that.

## Where the code lives

`src/lib/money-flow/` holds the interpretation. `interpret.ts` orchestrates a batch (8 files, 12 MB
each); `parsers.ts` dispatches by file kind; `detect.ts` sniffs that kind from magic bytes, extension,
MIME and content shape; `tabular.ts` reads CSV and spreadsheet tables; `up-statement.ts` reads Up's
layout; `text-lines.ts` reads loose text and PDF text by the balance chain; `parse-values.ts` turns
strings into money and dates; `interpret-row.ts` signs, types and tags one movement; `categorize.ts`
and `statement-category.ts` label it; `ledger.ts` accumulates; `summary.ts` totals; `period.ts` filters
by month or range; and `accounts.ts`, `institution.ts`, `account-identity.ts`, `transfers.ts`,
`refunds.ts`, `verdicts.ts`, `payers.ts`, `rhythm.ts`, `income.ts`, `scope.ts`, `recurring.ts`,
`savings.ts`, `tags.ts` and `tag-charts.ts` do the jobs their names suggest.

`src/components/money-flow-provider.tsx` is the single client-side store: it holds the ledger,
hydrates it from IndexedDB, and exposes imports, statements, verdicts, payer merges and tag edits.

Note there is no `documents.ts` — an earlier draft of this file claimed one. `heldStatements()` and
`importedFiles()` in `ledger.ts` do that job.
