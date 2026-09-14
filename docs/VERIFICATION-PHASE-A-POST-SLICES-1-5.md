# VERIFICATION REPORT — Phase A after Slices 1–5

**Date:** 2026-09-14  
**Mode:** Docs report only. No product fix PRs. Soft pools / Recurring / Budget out of scope. No Phase B.  
**Audited tip:** `cursor/spec-10-calc-truth-9284` / [PR #34](https://github.com/Cyphruszx/Bit-by-Bit/pull/34) @ `cd7c8f5` — *not* `main`.  
**Compare-from:** [PR #33](https://github.com/Cyphruszx/Bit-by-Bit/pull/33) Phase A RED against `main` @ `7e8ede4` (`docs/VERIFICATION-SPEC-6c-7-10.md`).

**SoT traps honoured (do not score against stale slices):**

- Spec 7 slice §7.3 “Spending reduced” is **STALE**. Master / Spec 10 overrule: month-freeze + Refund credits in Net, never rewrite prior-month Spending.
- Spec 9 “Budget = Spec 10” is **STALE**. Budget = Spec 11 (out of scope here).

Verdict vocabulary: **pass** / **fail** / **not-implemented** / **drift**. Residuals are listed under a pass when they do not change the assert.

---

## Phase A scoreboard (this tip)

| Spec | PR #33 (`main` @ `7e8ede4`) | PR #34 tip (`cd7c8f5`) |
| --- | --- | --- |
| **3** feeders | **drift** / **not-implemented** | **pass** (residuals below) |
| **6c** | **not-implemented** | **pass** |
| **7** | **not-implemented** | **pass** |
| **10** | **fail** / **not-implemented** | **pass** |

**Flip:** Phase A money-trust is no longer RED. Every Dev checklist assert that was `not-implemented` or `fail` on PR #33 is now **pass** on this tip.

---

## Flipped since PR #33

| Assert | #33 | #34 tip | What landed |
| --- | --- | --- | --- |
| Remap + recompute fingerprints on merge | not-implemented | **pass** | `mergeAccounts` remaps `accountId` and `fingerprintOf` |
| `canonical_account_id` walks `merged_into` | not-implemented | **pass** | `canonicalAccountId` + `mergedInto` on the ledger |
| No undo | not-implemented (name-merge reversible) | **pass** | Hard merge; clearing a display name does not unmerge |
| Same-account pair → `UNPAIRED_TRANSFER` | not-implemented | **pass** | Pair stripped; RQ opens `UNPAIRED_TRANSFER` |
| Collision → `DUPLICATE_HOLD` | not-implemented | **pass** | One CLEARED survivor + OPEN hold |
| Re-import after merge → no double `CLEARED` | not-implemented | **pass** | Re-import matches survivor fingerprint |
| Spec 10 recalc on merge | not-implemented | **pass** | `mergeAccount` → `commit` → `summarizePeriod` |
| Closed reason set | not-implemented | **pass** | All nine `REVIEW_REASONS` present |
| No-dismiss (only `INGEST_PARSE`) | not-implemented | **pass** | `canDismiss` + UI + throw |
| Badge = OPEN only | not-implemented | **pass** | `openReviewCount` filters `state === "OPEN"` |
| Exclusions while OPEN | not-implemented / fail | **pass** | `moneyTrustHoldIds` out of I/S/Refund/Net |
| RESOLVE writes ledger + Spec 10 recalc | not-implemented | **pass** | `confirmTransferPair` / `confirmRefundPair` + `recordReview` |
| No quota re-consume on RQ resolve | not-implemented | **pass** | Resolve is a ledger write; no ingest call |
| Core never auto-resolves money-trust | **fail** | **pass** | Ingest/`forgetAutoPairs`; Core does not write pairs |
| Σ `base_amount` CLEARED only | not-implemented | **pass** | `tileAmount` + `isCleared` in `countedMovements` |
| AU/Sydney month by row date | fail (UTC) | **pass** | `APP_TIME_ZONE = "Australia/Sydney"` |
| Month-freeze | fail (pairs reduced Spending) | **pass** | Refund pairs do not drop the spend |
| Refund credits never Income | fail | **pass** | Linked credits are Refund; unlinked stay out of Income |
| Net = Income − Spending + Refund credits | fail | **pass** | `net = income - spending + refunds` |
| Actual Savings = TRANSFER IN to SAVINGS / flagged | not-implemented | **pass** | `isActualSavings` inflow-only, pair required |
| One calc path | fail | **pass** | Tiles + charts share `countedMovements` / `isEarnings` / `isSpending` / `isRefundCredit` |
| `movement_kind` ENUM | drift | **pass** | Spec 3 kinds; legacy types still read |
| Fingerprint shape | drift | **pass** | canonical account + date + amount + hash(desc) + occurrence |
| Transfer / refund Spec-7 gated | drift | **pass** | Detect only; write is RESOLVE |
| Authority ladder | drift | **pass** | `user_overridden` > `user_rule` > Core > `UNREVIEWED` |

---

## Spec 6c asserts

| Assert | Verdict | Evidence |
| --- | --- | --- |
| Remap + recompute fingerprints on merge | **pass** | `mergeAccounts` walks each entry through `canonicalAccountId`, writes survivor `accountId`, and recomputes `fingerprintOf(..., occurrence, mergedInto)`. `src/lib/money-flow/ledger.ts`. Test: source row fingerprint no longer contains `···000`. `src/lib/money-flow/hard-merge.test.ts`. |
| `canonical_account_id` walks `merged_into` | **pass** | `canonicalAccountId` follows `mergedInto` and returns the id unchanged on a cycle. `accountIdOf` / `accountOf` / `fingerprintOf` all walk it. Cycle refused before write (`mergeWouldCycle`). `src/lib/money-flow/account-identity.ts`, `src/lib/money-flow/ledger.ts`. |
| No undo | **pass** | Comment and UI: “Merging cannot be undone.” `nameAccount` only edits display names and “never undoes a hard merge”; clearing a name keeps `mergedInto`. `parseLedger` has no unmerge field. `src/lib/money-flow/ledger.ts`, `src/app/(app)/accounts/accounts-view.tsx`, `src/lib/money-flow/hard-merge.test.ts`. |
| Same-account transfer pair → `UNPAIRED_TRANSFER` | **pass** | `breakSameAccountTransfer` strips `transferPair` when both legs walk to the same survivor. `buildReviewQueue` then opens `UNPAIRED_TRANSFER`. Test: after merge, no pair remains and the queue has OPEN `UNPAIRED_TRANSFER`. `src/lib/money-flow/ledger.ts`, `src/lib/money-flow/review-queue.ts`, `src/lib/money-flow/hard-merge.test.ts`. |
| Fingerprint collision → `DUPLICATE_HOLD` | **pass** | Collision group keeps one CLEARED winner (`pickCollisionWinner`); extras are dropped (import ids merged). OPEN `DUPLICATE_HOLD:${fingerprint}` is stored with **empty** `movementIds` so the survivor is **not** tile-held. Test: entries `1`, cashOut `86.4` not `172.8`. `src/lib/money-flow/ledger.ts`, `src/lib/money-flow/hard-merge.test.ts`. |
| Re-import after merge → no double `CLEARED` | **pass** | `appendToLedger` fingerprints with `mergedInto`, so a source-account re-upload hits the survivor key (`lookupHeld` also rewrites a wording-era fingerprint). Test: `added === 0`, `duplicates === 1`, Net unchanged. `src/lib/money-flow/ledger.ts`, `src/lib/money-flow/hard-merge.test.ts`. |
| Spec 10 recalc on merge | **pass** | `mergeAccount` commits the remapped ledger. Provider `useMemo` rebuilds the queue and runs `summarizePeriod` (Spec 10 `summarizeMoneyFlow`). Collision test asserts Spending/Net after merge. `src/components/money-flow-provider.tsx`, `src/lib/money-flow/period.ts`, `src/lib/money-flow/hard-merge.test.ts`. |

Soft pool: **out of scope**.

---

## Spec 7 asserts

Closed reason set (locked): `UNPAIRED_TRANSFER`, `PARTIAL_REFUND`, `FULL_REFUND_AMBIGUOUS`, `DUPLICATE_HOLD`, `UNREVIEWED_KIND`, `INGEST_PARSE`, `FINGERPRINT_CONFLICT`, `RULE_CONFLICT`, `AI_LOW_CONFIDENCE`.

| Assert | Verdict | Evidence |
| --- | --- | --- |
| Closed reason set | **pass** | `REVIEW_REASONS` is exactly that set. Unknown stored reasons are dropped. `src/lib/money-flow/review-queue.ts`. Test: `src/lib/money-flow/review-queue.test.ts`. Residual: `FINGERPRINT_CONFLICT` and `RULE_CONFLICT` have no live detector — they are replayed only if already stored OPEN. |
| No-dismiss money-trust set (only `INGEST_PARSE` may dismiss) | **pass** | `canDismiss` is `reason === "INGEST_PARSE"`. `dismissReviewItem` throws otherwise. UI shows Dismiss only when `canDismiss`; money-trust gets Confirm / Not that. Provider `dismissReviewItem` no-ops if `!canDismiss`. `src/lib/money-flow/review-queue.ts`, `src/components/review-queue.tsx`, `src/components/money-flow-provider.tsx`. |
| Badge = OPEN only | **pass** | `openReviewCount` counts `state === "OPEN"`. Nav badge on Transactions uses that count. Queue card filters OPEN and copy says “Everything is sorted” only when OPEN is zero. RESOLVED / DISMISSED do not badge. `src/lib/money-flow/review-queue.ts`, `src/components/app-nav.tsx`, `src/components/review-queue.tsx`. |
| Exclusions while OPEN | **pass** | `TILE_HOLD` = `UNPAIRED_TRANSFER`, `PARTIAL_REFUND`, `FULL_REFUND_AMBIGUOUS`, `DUPLICATE_HOLD`, `FINGERPRINT_CONFLICT`, `RULE_CONFLICT`. `countedMovements` drops those ids. Refund holds take the **credit only** (month-freeze). Unpaired $400 transfer: Income/Spending/Net `0`, cashIn/cashOut still `400`. `src/lib/money-flow/review-queue.ts`, `src/lib/money-flow/summary.ts`, `src/lib/money-flow/review-queue.test.ts`. Intentional: `UNREVIEWED_KIND`, `AI_LOW_CONFIDENCE`, `INGEST_PARSE` do **not** hold tiles (Master: do not HOLD `UNREVIEWED` out of tiles). |
| RESOLVE writes ledger + Spec 10 recalc | **pass** | `confirmReviewTransfer` / `confirmReviewRefund` write `TRANSFER`/`REFUND` + `user_overridden` pairs via `editWith` + `recordReview(resolveReviewItem)`. Provider then reruns `summarizePeriod`. Confirmed Save!! transfer: Income/Spending `0`, Actual Savings `$400`. Linked refund: Refund credits `$80`, Spending stays `$80`, Net `0`. `src/components/money-flow-provider.tsx`, `src/lib/money-flow/review-queue.ts`, `src/lib/money-flow/review-queue.test.ts`. |
| No quota re-consume on RQ resolve | **pass** | Resolve/decline/dismiss are `editWith` / `commit` / `recordReview` only. They do not call `interpretDocuments` or the upload action. File caps (`MAX_FILES = 8`, `MAX_FILE_BYTES`) live on ingest. There is still no Spec 2 weekly CSV/OCR quota object — resolve cannot re-consume what is not on this path. `src/components/money-flow-provider.tsx`, `src/lib/money-flow/interpret.ts`. |
| Core never auto-resolves money-trust | **pass** | Ingest runs `forgetAutoPairs` and does **not** call `markTransferLegs` / `markRefundLegs`. Provider classifies, forgets auto-pairs, then detects candidates for the queue/insight only. AI `applyTagSuggestions` does not write pairs. Household sample after ingest: every row `!transferPair && !refundPair && decidedBy !== "paired"`. `src/lib/money-flow/interpret.ts`, `src/components/money-flow-provider.tsx`, `src/lib/money-flow/auto-pairs.ts`, `src/lib/money-flow/interpret.test.ts`. Residual: `markTransferLegs` / `markRefundLegs` still exist as explicit write helpers (tests / RESOLVE-shaped callers). |

---

## Spec 10 asserts

Score month-freeze / Refund credits against **Master Spec 10**, not stale Spec 7 §7.3.

| Assert | Verdict | Evidence |
| --- | --- | --- |
| Σ `base_amount`, `CLEARED` only | **pass** | `countedMovements` keeps `isCleared` (missing status = CLEARED). Tiles sum `tileAmount` (`baseAmount ?? amount`). HOLD rows are excluded from I/S/Refund/Net; cash still uses statement `amount`. Interpret commits `baseAmount = amount`, `status = "CLEARED"`. `src/lib/money-flow/tile.ts`, `src/lib/money-flow/summary.ts`, `src/lib/money-flow/spec-10-calc.test.ts`. Spec 7 OPEN exclusion is a second filter on the same path, not a persisted HOLD. |
| AU/Sydney month by row date | **pass** | `APP_TIME_ZONE = "Australia/Sydney"`. Civil `YYYY-MM-DD` is left as printed (midnight UTC cannot slide the day). Instants convert with Sydney including DST (`2026-08-31T14:00:00.000Z` → `2026-09-01`). `monthKey` / `inPeriod` / `monthBounds` use that civil date. `src/lib/money-flow/period.ts`, `src/lib/money-flow/spec-10-calc.test.ts`. |
| Month-freeze (Master wins — ignore stale §7.3) | **pass** | Refund pairs are **not** removed from `countedMovements`. February −$100 spend + March +$100 refund: Feb Spending `100`, Mar Refund credits `100`, All Spending `100` + Refunds `100` + Net `0`. OPEN refund holds the credit only. `src/lib/money-flow/summary.ts`, `src/lib/money-flow/spec-10-calc.test.ts`, `src/lib/money-flow/review-queue.test.ts`. |
| Refund credits(P) never Income | **pass** | `isRefundCredit` = positive `tileAmount` + `refundPair`. `isEarnings` returns false for those. Unlinked refund-shaped credits (`isUnlinkedRefundShaped`) are neither Income nor Refund credits. Filed earnings the bank labelled Refund (Medicare / `other-income`) still count as Income. `src/lib/money-flow/summary.ts`, `src/lib/money-flow/taxonomy.ts` (`REFUND.income = false`), `src/lib/money-flow/spec-10-calc.test.ts`. |
| Net Money = Income − Spending + Refund credits | **pass** | `net = roundMoney(income - spending + refunds)`. Identity asserted in unit tests and on the household sample. Dashboard Net detail prints the addend when `flow.refunds > 0`. `src/lib/money-flow/summary.ts`, `src/app/(app)/dashboard/dashboard-view.tsx`. |
| Actual Savings = TRANSFER IN to SAVINGS / user-flagged only | **pass** | `isActualSavings`: CLEARED, `tileAmount > 0`, `transferPair` present, and (`userFlaggedSavings` or savings-like account nickname/key). Unmatched internals and HOLD credits do not count. After Core ingest, sample Actual Savings is `$0` (no auto-pair). After RESOLVE, Save!! IN is `$400`; settled Up year is `$5,800.40`. `src/lib/money-flow/tile.ts`, `src/lib/money-flow/spec-10-calc.test.ts`, `src/lib/money-flow/ledger.test.ts`. Residual: no UI setter for `userFlaggedSavings` (field is copied on merge/re-import). Soft pools out of scope. |
| One calc path | **pass** | Dashboard, transactions, accounts, and ingest all call `summarizeMoneyFlow` / `summarizePeriod`. Charts (`chartTagFlowSeries`, `tagFlowOverTime`, `flowTotals`) now use `countedMovements` + `isEarnings` / `isSpending` / `isRefundCredit` + `tileAmount` — the sign-only path from PR #33 is gone. `incomeSources` reads the same earnings set. `monthlyTransferSeries` uses `isActualSavings`. `src/lib/money-flow/summary.ts`, `src/lib/money-flow/period.ts`, `src/lib/money-flow/income.ts`, `src/lib/money-flow/savings.ts`. Residual: account cards still show **cashNet** (raw statement cash — a different identity, not a second I/S/Net). Dashboard labels remain “Money in / Money out”. No standalone Refund credits tile (addend is on Net). |

Budget tiles: **out of scope** (Spec 11, not Spec 10).

---

## Spec 3 engine bits (feeders only)

| Feeder | Verdict | Evidence |
| --- | --- | --- |
| `movement_kind` ENUM | **pass** | `MOVEMENT_KINDS`: `TRANSFER`, `SPENDING`, `INCOME`, `REFUND`, `DEBT_PRINCIPAL`, `DEBT_COST`, `INVESTMENT`, `ADJUSTMENT`, `UNREVIEWED`. Writers emit these (`typeForCategory`, ingest, classify, RESOLVE, verdicts). `kindOf` / `upgradeTransaction` map earned→INCOME, spent→SPENDING, moved→TRANSFER, returned→REFUND, borrowed/repaid→DEBT_PRINCIPAL. `src/lib/money-flow/movement-kind.ts`, `src/lib/money-flow/taxonomy.ts`, `src/lib/money-flow/spec-3.test.ts`. Residual: category table `inType`/`outType` still stored as earned/spent/… and migrated on the way out. `DEBT_COST` exists and tiles as spending, but charged interest still writes `SPENDING`. |
| Fingerprint shape | **pass** | `[acct:canonical \| file:source, dateIso, amount.toFixed(2), hash(raw_description), occurrence]`. Hash is FNV-1a 32-bit of the normalised description. `legacyFingerprintOf` still matches wording-era rows and rewrites them. Re-import: same fingerprint, `user_overridden` wins. `src/lib/money-flow/ledger.ts`, `src/lib/money-flow/spec-3.test.ts`. |
| Transfer / refund rules Spec-7 gated | **pass** | `matchTransfers` / `matchRefunds` detect only. Core ingest does not write `transferPair` / `refundPair`. CC repayment from CHECKING/SAVINGS → `TRANSFER` **without** a pair (RQ may hold it unpaired). RESOLVE is the write. `src/lib/money-flow/interpret.ts`, `src/lib/money-flow/auto-pairs.ts`, `src/lib/money-flow/classify.ts`, `src/lib/money-flow/spec-3.test.ts`. |
| Authority ladder | **pass** | Spec 3 collapse: `user_overridden` / `said` > `user_rule` / `learned` > Core (`paired`/`merchant`/`rules`/`bank`/`ai`) > `UNREVIEWED`. `outranks` refuses a merchant rule over a settled row (Master listed `user_rule` first; a rule must not wipe Spec 7 RESOLVE or Spec 6c overrides). `src/lib/money-flow/movement-kind.ts`, `src/lib/money-flow/classify.ts`, `src/lib/money-flow/spec-3.test.ts`. Residual: `DecidedBy` still stores the Core rungs; they collapse to Spec 3 “Core”. |

---

## Sample numbers (`public/samples/`)

Household (`nab-medicare.csv` + `nab-rent.csv` + `up-2025-07-to-2026-06.txt`) after Core ingest (no auto-pairs, OPEN holds):

| Figure | Value |
| --- | --- |
| Income | **$145,096.99** |
| Spending | **$89,913.17** |
| Refund credits | **$0** |
| Net | **$55,183.82** = 145096.99 − 89913.17 + 0 |
| cashNet | **−$507.51** (unchanged raw cash) |
| Actual Savings | **$0** (no Core pair) |
| transfers | **$0** |

NAB both accounts cashNet **$549.44**. Up year unpaired: Income **$70,120.77** / Spending **$71,631.34** / Net **−$1,510.57** / cashNet **−$1,056.95**. When pairs are written on purpose (RESOLVE-shaped helpers in `ledger.test.ts`): Up Refund credits **$448.89**, Actual Savings **$5,800.40**, Net **−$1,061.68**.

Quoted from `src/lib/money-flow/interpret.test.ts` and `src/lib/money-flow/ledger.test.ts` on this tip.

---

## Residuals (not Phase A fails)

These do not flip an assert to fail. They are the leftover interim bits PR #34 already named:

1. `FINGERPRINT_CONFLICT` / `RULE_CONFLICT` — in the closed set; no live detector yet.
2. Category book still stores earned/spent internally; `typeForCategory` migrates out.
3. `DEBT_COST` is not auto-typed from bank-fees / interest charged.
4. `DecidedBy` still has Core rungs (`paired`, `merchant`, `rules`, `bank`, `ai`).
5. Income-source card still splits earned / returned / arrived (bank-claim language).
6. Dashboard still says “Money in / Money out”; Refund credits are a Net addend, not their own card.
7. `userFlaggedSavings` has a calc path and no UI control.
8. `markTransferLegs` / `markRefundLegs` remain as explicit writers; Core ingest does not call them.
9. Spec 2 weekly quota object itself is still absent (resolve does not ingest).
10. Soft pools, Recurring, Budget / Spec 11, Spec 6b, Spec 8 full Permanent rewrite, Phase B/C — out of scope.

---

## Tests run on this tip

```
npx tsx --test \
  src/lib/money-flow/spec-10-calc.test.ts \
  src/lib/money-flow/spec-3.test.ts \
  src/lib/money-flow/hard-merge.test.ts \
  src/lib/money-flow/review-queue.test.ts \
  src/lib/money-flow/no-auto-pair.test.ts \
  src/lib/money-flow/ledger.test.ts \
  src/lib/money-flow/interpret.test.ts
# 147 pass / 0 fail
```

Full suite on this tip (`npm test`): **470 pass / 0 fail**. `npm run typecheck` and `npm run lint`: clean.

---

## What this run did not do

- No Phase B/C.
- No Soft pool / Recurring / Budget implementation.
- No product-code fixes. This file is the re-audit of Slices 1–5 already on PR #34.
