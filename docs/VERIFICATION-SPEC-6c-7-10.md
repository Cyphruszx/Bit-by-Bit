# VERIFICATION REPORT — Phase A (Dev checklist)

**Date:** 2026-09-14 (refined to Dev’s official asserts)
**Repo:** `Cyphruszx/Bit-by-Bit` @ `main` (`7e8ede4`) + this docs-only branch
**Mode:** Verification-first. Soft pools / Recurring / Budget **out of scope**. Phase B/C not this run. No money-trust code changes.

**SoT:** Notion [Master Product & Technical Spec](https://app.notion.com/p/3d8f61b9a34981e98e46e7c74efba409) (13 Sep 2026). Master wins.

**SoT traps honoured in this audit (do not score against stale slices):**

- Spec 7 slice §7.3 “Spending reduced” is **STALE**. Master / Spec 10 overrule: month-freeze + Refund credits in Net, never rewrite prior-month Spending.
- Spec 9 “Budget = Spec 10” label is **STALE**. Budget = Spec 11 (out of scope here).

Full Spec `.md` attachments were not readable via Notion MCP. Asserts below are Dev’s checklist + Master page summaries + Spec 3 feeder summary.

---

## Phase A scoreboard

| Spec | Overall |
| --- | --- |
| **3** engine bits that feed 6c/7/10 | **drift** / **not-implemented** |
| **6c** | **not-implemented** |
| **7** | **not-implemented** |
| **10** | **fail** / **not-implemented** |

Existing tests lock the **pre-Spec** model (91 pass). They are not Spec 6c/7/10 compliance tests.

---

## Highest-risk money-trust gaps

1. Unlinked refund-shaped credits sit in **Income** (`income.ts`, `taxonomy.ts` `returned.income = true`).
2. Merge does not remap fingerprints; overlap is a **read-time** fold (`nameAccount`, `uniqueTransactions`).
3. Core **auto-pairs** transfers and refunds (`markTransferLegs`, `markRefundLegs`) — Spec 7: Core never auto-resolves money-trust.
4. Paired refunds **reduce Spending** (stale §7.3 behaviour). Master Spec 10 forbids rewriting prior-month Spending.
5. Several calculators: `summarizeMoneyFlow`, chart `flowTotals` (sign-only), per-account `accountsFrom`, ingest-time `interpret.ts`.
6. No `CLEARED` / `DUPLICATE_HOLD` / `reason_code` / OPEN badge / `base_amount`.

---

## Spec 3 engine bits (feeders only)

Master summary: *`movement_kind` ENUM, fingerprint, transfer/refund rules, authority ladder. Actual Savings = Calculated `TRANSFER` IN to savings (inflow-only; Spec 10 edges).*

| Feeder | Verdict | Evidence |
| --- | --- | --- |
| `movement_kind` ENUM | **drift** | Repo has `TransactionType`: `earned` \| `returned` \| `borrowed` \| `moved` \| `spent` \| `repaid` \| `invested` \| `adjusted`. Not Spec 3 kinds (`TRANSFER`, `SPEND`, …). `src/lib/money-flow/taxonomy.ts`. |
| Fingerprint | **drift** | Exists: `[accountOf, dateIso, amount, wording, occurrence]`. `accountOf` is `acct:<accountKey>` or `file:<sourceFile>`, not canonical survivor id. `src/lib/money-flow/ledger.ts` `fingerprintOf` / `accountOf`. |
| Transfer / refund rules | **drift** | Pair-on-amount+account+window. Transfers auto-write `type: "moved"`. Refunds auto-write `type: "returned"` on the credit. `src/lib/money-flow/transfers.ts`, `refunds.ts`. |
| Authority ladder | **drift** | `DecidedBy`: said > learned > paired > merchant > rules > bank > ai > unreviewed. `src/lib/money-flow/classify.ts`. |
| Actual Savings = TRANSFER IN to savings | **not-implemented** | See Spec 10 assert. |

---

## Spec 6c asserts

| Assert | Verdict | Evidence |
| --- | --- | --- |
| Remap + recompute fingerprints on merge | **not-implemented** | Merge = copy survivor **display name** onto source keys. `nameAccount` does not touch `entries` or fingerprints. Test: after naming two keys “Spending”, stored rows stay **2**, visible **1**. `ledger.ts` 277–283; `ledger.test.ts` 153–165; `accounts-view.tsx` 45–48. |
| `canonical_account_id` walks `merged_into` | **not-implemented** | No `canonical_account_id`, no `merged_into`, no cycle hard-error. Runtime id is `institution · named` via `accountIdOf`. `account-identity.ts` 151–156. (Payer `throughMerges` silently stops on a loop — not this assert.) |
| No undo | **not-implemented** (current name-merge is **reversible**) | Spec 6c hard merge with no undo is absent. The name-merge **is** undone by empty name: “an empty name forgets the naming”. `ledger.ts` 273–282. Rename UI can clear it. `accounts-view.tsx` `InlineName`. |
| Same-account transfer pair → `UNPAIRED_TRANSFER` | **not-implemented** | Matcher skips same-account (`transfers.ts` 87–88; test “will not pair money with itself”). After a name-merge, `accountIdOf` collapses two keys, so a former pair **unpairs** on next `markTransferLegs` and returns to income/spending. No `UNPAIRED_TRANSFER` reason. Partial safety: does not emit illegal same-account `TRANSFER`. |
| Fingerprint collision → `DUPLICATE_HOLD` | **not-implemented** | No status. Import: keep first, `duplicates++`. `ledger.ts` 158–164. Display fold: `uniqueTransactions` drops extras with no hold. `summary.ts` 404–433. |
| Re-import after merge → no double `CLEARED` | **not-implemented** | No `CLEARED`. Re-import still fingerprints with original `accountKey`/`sourceFile`, so a second stored row can be added. View may hide it. `appendToLedger` + `fingerprintOf`. |
| Spec 10 recalc on merge | **not-implemented** | `setAccountName` → `commit` → provider `useMemo` reruns `visibleTransactions` + `summarizePeriod`. That is a live recalc of the **current** calculator, not Spec 10 (no `base_amount`, CLEARED filter, month-freeze, Refund credits). `money-flow-provider.tsx` 130–166, 301–303. |

Soft pool: **out of scope**.

---

## Spec 7 asserts

Closed reason set (locked): `INGEST_PARSE`, `DUPLICATE_HOLD`, `UNPAIRED_TRANSFER`, `PARTIAL_REFUND`, `FULL_REFUND_AMBIGUOUS`, `UNREVIEWED_KIND`, `FINGERPRINT_CONFLICT`, `RULE_CONFLICT`, `AI_LOW_CONFIDENCE`.

| Assert | Verdict | Evidence |
| --- | --- | --- |
| Closed reason set | **not-implemented** | None of those strings exist in source. Queue key = merchant; membership = `categoryKey === uncategorised` after `countedMovements`. `review.ts`, `classify.ts` `needsReview`. |
| No-dismiss money-trust set (only `INGEST_PARSE` may dismiss) | **not-implemented** | Category `<select>` only. No dismiss / resolve / parse-repair item. Parse errors are file `processingError`. `review-queue.tsx`, `interpret.ts`. |
| Badge = OPEN only | **not-implemented** | `AppNav` has no badge / count. `app-nav.tsx`. |
| Exclusions while OPEN | **not-implemented** / **fail** vs Spec 7 | Uncategorised rows **count** in Income/Spending (`UNCATEGORISED` `inType: earned`, `outType: spent`). Unlinked refund-shaped credits **count** in Income (`income.ts`). Spec 7: money-trust OPEN rows stay out of calc until resolved. |
| RESOLVE writes ledger + Spec 10 recalc | **not-implemented** | Category choice → `setMerchantCategory` / `recordCorrection` (Spec 8-adjacent learn). No `RESOLVED` / `CLEARED` write. Provider does rerun `summarizePeriod`, but that is not Spec 10. `money-flow-provider.tsx`, `review-queue.tsx`. |
| No quota re-consume on RQ resolve | **not-implemented** | No Spec 2 weekly CSV/OCR quota. Caps: `MAX_FILES = 8`, 12MB. Category write does not re-call ingest. `interpret.ts`, `interpret-documents.ts`. |
| Core never auto-resolves money-trust | **fail** | Core auto-writes transfer/refund pairs and removes them from totals with no queue. `markTransferLegs` / `markRefundLegs` in `interpret.ts` 102–105 and `money-flow-provider.tsx` 156–157. AI may auto-set category (`ai.ts` `applyTagSuggestions`, `decidedBy: "ai"`). Contested transfers are skipped, not queued as `UNPAIRED_TRANSFER`. |

Current “Needs a category” UI is a merchant categoriser, not Spec 7.

---

## Spec 10 asserts

Score month-freeze / Refund credits against **Master Spec 10**, not stale Spec 7 §7.3 “Spending reduced”. Current pairing **does** reduce Spending — that matches the stale slice and **fails** Master.

| Assert | Verdict | Evidence |
| --- | --- | --- |
| Σ `base_amount`, `CLEARED` only | **not-implemented** | No `base_amount`, no `CLEARED`. Tiles sum `txn.amount` on `countedMovements` via `isEarnings` / `isSpending`. `summary.ts` 54–93; `dashboard-view.tsx` Money in / out / Net. |
| AU/Sydney month by row date | **fail** | Month = `dateIso.slice(0, 7)`. Bounds/`formatMonthLabel` use `Date.UTC` / `timeZone: "UTC"`. `period.ts` 12–45. Display: `en-AU` + UTC in `parse-values.ts`. Not `Australia/Sydney`. |
| Month-freeze (refunds don’t rewrite prior-month Spending) | **fail** | Proved pair drops **both** legs from `countedMovements` → all-period Spending falls. Test: pizza −100 + refund +100 leaves spending 40. `refunds.test.ts` 63–75; `summary.ts` `countedMovements`. February spend refunded in March: All view rewrites February; month filter with one leg can count the credit as Income. |
| Refund credits(P) never Income | **fail** | `returned.income = true`. Unpaired bank-“Refund” credits are a slice **of** the Income tile. Paired refunds are excluded from Income **and** Spending (not a Refund-credits addend). `taxonomy.ts` 65; `income.ts`; `summary.ts` 90–93. |
| Net Money = Income − Spending + Refund credits | **fail** | `net = roundMoney(income - spending)`. `summary.ts` 93. `flow.refunds` exists and is unused in Net. NAB medicare+rent cashNet **$549.44** is raw cash (`merge.test.ts`). Up shown year: **$70,125.50 − $71,182.45 = −$1,056.95** with reversals stripped from both sides (`ledger.test.ts` 461–465) — stale “Spending reduced”, not Master Net. |
| Actual Savings = TRANSFER IN to SAVINGS / user-flagged only | **not-implemented** | No `user_flagged_savings`, no savings-account type. Pots are typed `saved`/`target`. “Set aside this period” = `flow.transfers` (debit legs of **any** matched pair) or `monthlyTransferSeries` over every `type === "moved"`. `savings-view.tsx` 52–54; `summary.ts` 75–79; `savings.ts` 155–161. |
| One calc path | **fail** | Paths that disagree: (1) `summarizeMoneyFlow` / `summarizePeriod` (type-aware, pair-aware) — dashboard. (2) `flowTotals` / `tagFlowOverTime` — **sign of amount only**, ignores type. `summary.ts` 335–340. (3) `accountsFrom` per-account `summarizeMoneyFlow`; account cards show **cashNet**. `accounts.ts` 92, `accounts-view.tsx` 218–221. (4) Transactions scope re-summarises. `transactions-view.tsx` 49–53. (5) Ingest-time `summarizeMoneyFlow` before ledger fold. `interpret.ts` 107. |

Budget tiles: **out of scope** (Spec 11, not Spec 10).

---

## What this run did not do

- No Phase B/C.
- No Soft pool / Recurring / Budget implementation.
- No remap, `DUPLICATE_HOLD`, reason-code queue, or Spec 10 calculator rewrite.

Those are locked by the specs and are not small patches.

---

## Tests (current model, not Spec compliance)

```
npx tsx --test src/lib/money-flow/{ledger,transfers,refunds,review,merge,period,income}.test.ts
# 91 pass / 0 fail
```
