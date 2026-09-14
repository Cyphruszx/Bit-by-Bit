# VERIFICATION REPORT — Spec 6c / 7 / 10

**Date:** 2026-09-14
**Repo:** `Cyphruszx/Bit-by-Bit` @ `main` (`7e8ede4`)
**Mode:** Audit only. No Soft pool / Recurring / Budget work. No money-trust code changes.

**Spec source of truth:** Notion [BitbyBit — Master Product & Technical Spec](https://app.notion.com/p/3d8f61b9a34981e98e46e7c74efba409) (Consolidated Master, 13 September 2026 — Specs 2–10 + Spec 6c locked). Decisions there overrule the repo.

The full Spec `.md` attachments on that page were not readable through Notion MCP (`download-attachment` 404; file blocks are empty). This audit uses:

1. The locked must-check list in the verification prompt (Spec Lead language).
2. Notion page summaries for Specs 6c, 7, and 10.
3. Research notes that cite Spec 7 (`Notes — Confirm-queue session-1 spec`, `Notes — Duplicate hold UX`).

**Current product shape:** a client ledger MVP. Movements have `amount` + `type`. Identity is a string fingerprint at import. Review is “Needs a category” by merchant. Totals are `summarizeMoneyFlow` over `countedMovements`. There is no `CLEARED` / `DUPLICATE_HOLD` status, no `reason_code`, no `base_amount`, no `merged_into`, no weekly CSV/OCR quota.

Existing unit tests for the current model: **91 pass / 0 fail** (`ledger`, `transfers`, `refunds`, `review`, `merge`, `period`, `income`).

---

## Overall matrix

| Spec | Verdict | One-line why |
| --- | --- | --- |
| **6c Merge × fingerprint** | **not-implemented** (local **drift** on display-time overlap) | No `canonical_account_id` / `merged_into` remap. Merge is “give two keys the same display name.” Fingerprints stay as imported. |
| **7 Review Queue** | **not-implemented** | Queue is uncategorised merchants. No closed `reason_code` list, no-dismiss set, OPEN badge, or resolve-vs-dismiss. |
| **10 Calculated numbers** | **fail** / **drift** | Tiles exist, but they are not Σ `base_amount` of `CLEARED` rows, not Australia/Sydney, not month-frozen, and Net is `income − spending` with no Refund-credits line. Actual Savings is not TRANSFER IN to SAVINGS. |

---

## Highest-risk money-trust gaps (first)

1. **Unlinked bank-“Refund” credits sit in Income.** Spec 7 + 10: unlinked `REFUND` stays out of Income / Spending and grants no Refund credits until linked. Repo: unmatched refund-shaped credits are `earned` and `countsAsIncome`. On NAB Medicare samples this is the known $120,844.20 class of error the matcher tries to avoid — but only when a same-account payment pair is found. (`src/lib/money-flow/income.ts`, `taxonomy.ts` `returned.income = true`, `income.test.ts`.)

2. **Account merge does not rewrite fingerprints.** Spec 6c: remap source rows to survivor and recompute fingerprints with survivor `account_id`. Repo: `nameAccount` only writes `ledger.accounts`; stored `fingerprint` / `accountOf()` stay on the original key or filename. Overlap is folded at **read** time by `uniqueTransactions`. Re-import after merge can still insert a second stored row. (`ledger.ts` `nameAccount`, `fingerprintOf`, `appendToLedger`; `summary.ts` `uniqueTransactions`; `ledger.test.ts` “naming an account moves no stored row”.)

3. **No `DUPLICATE_HOLD` — collisions are silent.** Spec 6c/7: fingerprint collision → `DUPLICATE_HOLD`, never a second `CLEARED`. Repo: `appendToLedger` increments `duplicates` and keeps the held row. Display-time overlap uses a different key (`accountIdOf` after naming). Nothing is queued. (`ledger.ts` 158–164; review queue ignores this.)

4. **Same-account legs after merge never become `UNPAIRED_TRANSFER`.** Spec 6c: collapsed same-account transfer pairs → `UNPAIRED_TRANSFER` (never illegal same-account `TRANSFER`). Repo: matcher refuses same-account pairs (`transfers.ts` 87–88) — so it does **not** emit illegal `TRANSFER` — but it also does **not** raise a review item. Both legs can remain Income/Spending.

5. **Cross-month refunds rewrite Spending in the all-period view.** Spec 10 month-freeze: a later refund must not change prior-month Spending; Refund credits belong in Net, never Income. Repo: a proved pair drops **both** legs from `countedMovements` for any view that contains both, so all-activity Spending falls. A month filter that contains only one leg counts the remaining leg (refund → Income if `returned`/`earned`). (`summary.ts` `countedMovements`; `period.ts` `summarizePeriod`; `refunds.test.ts` “takes both the refund and the payment out of the totals”.)

6. **Net Money formula is wrong vs Spec 10.** Spec: Income − Spending + Refund credits. Repo: `net = income - spending`. Paired refunds vanish from both sides; there is no Refund-credits addend. (`summary.ts` 90–93, dashboard “Net” tile.)

7. **Actual Savings is not calculated.** Spec 10: TRANSFER IN to SAVINGS / `user_flagged_savings` only. Repo: Savings pots are manual `localStorage` numbers. “Set aside this period” is **all** matched `moved` transfers (`flow.transfers`), not inflows to a savings account. (`savings-view.tsx`, `savings.ts` `monthlyTransferSeries`.)

8. **Review Queue cannot protect the badge.** Spec 7: badge = OPEN only; dismiss never clears badge while calc still excludes money; only `INGEST_PARSE` may dismiss. Repo: no badge, no dismiss, no statuses. Nav has no count. (`app-nav.tsx`, `review.ts`, `review-queue.tsx`.)

---

## Spec 6c — Merge × fingerprint

Notion summary: *On merge: remap rows to survivor + rewrite fingerprints. Same-account transfer pairs → `UNPAIRED_TRANSFER`; collisions → `DUPLICATE_HOLD`. No undo; opening balances parked. Soft pool not in scope.*

| Must-check | Verdict | Evidence |
| --- | --- | --- |
| `canonical_account_id` walks `merged_into`; cycles = hard error | **not-implemented** | No `canonical_account_id` / `merged_into` field. Merge is shared display name: `accountIdOf` returns `institution · named`. (`account-identity.ts` 151–156, `ledger.ts` 277–283, `accounts-view.tsx` 45–48.) Payer merges walk a map and **silently stop** on a cycle (`verdicts.ts` `throughMerges`) — not an account-merge hard error. |
| On merge: remap source rows → survivor; recompute fingerprints with survivor `account_id` | **not-implemented** | `nameAccount` does not touch entries. Fingerprint is `[accountOf(txn), date, amount, wording, occurrence]` where `accountOf` is `acct:<accountKey>` or `file:<sourceFile>` — **not** the named survivor. (`ledger.ts` 99–107, 277–283.) Test lock: after naming two keys “Spending”, `ledgerTransactions` still has 2 rows; `visibleTransactions` has 1. (`ledger.test.ts` 153–165.) |
| Same-account transfer pairs collapse → `UNPAIRED_TRANSFER` (never illegal same-account TRANSFER) | **not-implemented** (partial safety) | Matcher skips same-account: `if (account.get(credit.id) === account.get(debit.id)) return false`. Test: “will not pair money with itself inside one account.” (`transfers.ts` 87–88, `transfers.test.ts` 46–53.) After a name-merge, `accountIdOf` makes former A/B the same id, so previously pairable legs **unpair** on next `markTransferLegs` — they return to income/spending, with no `UNPAIRED_TRANSFER` reason. |
| Fingerprint collision → `DUPLICATE_HOLD` (not second `CLEARED`) | **not-implemented** | No status enum. Exact fingerprint at import: keep first, `duplicates++`. (`ledger.ts` 158–164.) Display-time overlap uses a different key and drops the extra row from view without hold. (`summary.ts` 404–433.) |
| Re-import after merge uses canonical account — no silent double `CLEARED` | **drift** / **fail** | Re-import fingerprints with original `accountKey`/`sourceFile`, so a second stored entry can be added. View may still fold via `uniqueTransactions` **if** both rows `namesItsOwnAccount()`. File-keyed rows (`accountOf` = `file:…`) plus a later named account do not share a stored fingerprint. There is no `CLEARED` flag to double. |
| Soft pool | **out of scope** | Not audited; not present as a ledger object. |

**Closest current behaviour (drift, not 6c):** two overlapping Up exports of one named account are held twice (1549 stored) and shown once (1267). Settled totals on the shown set: income **$70,125.50**, spending **$71,182.45**, net **−$1,056.95**. Counting stored rows without the fold would read income **$94,912.46**. (`ledger.test.ts` 419–468.) That is a display-time uniquifier, not Spec 6c remap + hold.

---

## Spec 7 — Review Queue

Notion summary: *Closed `reason_code` list; no-dismiss money-trust set. Unlinked `REFUND` stays out of Income / Spending (and grants no Refund credits) until linked.*

Research note (`Notes — Confirm-queue session-1 spec`) restates: dismiss never clears badge while calc still excludes the row; resolving 1–7 must follow Spec 7; Skip is disabled on no-dismiss types.

| Must-check | Verdict | Evidence |
| --- | --- | --- |
| Closed `reason_code` list: `INGEST_PARSE`, `DUPLICATE_HOLD`, `UNPAIRED_TRANSFER`, `PARTIAL_REFUND`, `FULL_REFUND_AMBIGUOUS`, `UNREVIEWED_KIND`, `FINGERPRINT_CONFLICT`, `RULE_CONFLICT`, `AI_LOW_CONFIDENCE` | **not-implemented** | Grep: none of these strings exist in the repo. Review grouping key is `merchantKey`; membership is `categoryKey === uncategorised` after `countedMovements`. (`review.ts`, `classify.ts` `needsReview`.) |
| No-dismiss set: only `INGEST_PARSE` may dismiss; all other money-trust types must resolve | **not-implemented** | UI is a category `<select>`. No dismiss control, no resolve-vs-dismiss, no parse-repair path. (`review-queue.tsx`.) Parse failures are file-level `processingError`, not queue items. (`interpret.ts`, `ledger.ts` imports.) |
| Badge = OPEN only; dismiss must never clear badge while calc still excludes money | **not-implemented** | `AppNav` has no badge. (`app-nav.tsx`.) Uncategorised rows **still count** in Income/Spending (`taxonomy.ts` UNCATEGORISED `inType: earned`, `outType: spent`). Opposite of Spec 7 “excluded until resolved.” |
| RQ resolve never re-consumes CSV/OCR quota | **not-implemented** | No weekly 5 CSV / 20 OCR quota (that is Spec 2). Caps are `MAX_FILES = 8` and 12MB. (`interpret.ts`, `interpret-documents.ts`.) Category resolve is local `learn()` / `setMerchantCategory` — it does not re-call ingest, so it cannot re-consume a quota that does not exist. |

**What the current “Needs a category” queue actually does**

- Asks once per merchant, biggest absolute amount first. (`review.test.ts`.)
- Omits settled transfer/refund pairs because they are not in `countedMovements`. (`review.ts` 37–43.)
- Assigning a category learns a merchant rule. That is Spec 8-adjacent, not Spec 7 money-trust.

Unlinked refunds/transfers that still sit in Income are a **separate** list (`unsettled-money.tsx` / `income.ts` `unsettledGroups`), not the Review Queue, and they remain in the Income tile until a verdict.

---

## Spec 10 — Calculated numbers

Notion summary: *Tiles Σ `base_amount`; Australia/Sydney periods. Month-freeze + Refund credits in Net Money (not Income). Budget = Spec 11 (out of scope).*

| Must-check | Verdict | Evidence |
| --- | --- | --- |
| Tiles Σ `base_amount`, `CLEARED` only | **not-implemented** | No `base_amount`, no `CLEARED`. Tiles sum `txn.amount` for `countedMovements` filtered by `isEarnings` / `isSpending`. (`summary.ts` 54–93; `dashboard-view.tsx` “Money in / Money out / Net”.) |
| Australia/Sydney month boundaries | **fail** | Month key is `dateIso.slice(0, 7)`. Bounds use `Date.UTC`. Labels use `timeZone: "UTC"`. Display dates: `en-AU` + `UTC`. (`period.ts` 12–45, `parse-values.ts` 125.) A Sydney evening timestamp encoded as UTC next-day would land in the wrong month. Parsed statement dates are calendar strings, so AU CSV days usually match — still not the locked TZ. |
| Month-freeze: refunds do not rewrite prior-month Spending | **fail** | All-activity: paired refund removes the original debit from spending (`refunds.test.ts` 63–75: spending drops from 100+40 to 40). Period filter runs **after** pairing on the full ledger (`money-flow-provider` + `summarizePeriod` on already-marked rows). A February spend refunded in March: **All** view loses February spend; **February** view still has one leg of the pair (count 1) so spend remains; **March** view can count the credit as income. Spec wants February frozen and March Refund credits, not Income. |
| Refund credits(P) in Net Money; **never** in Income | **fail** | `returned` type has `income: true`. (`taxonomy.ts` 65.) Unpaired refund-shaped credits are split **inside** the Income figure (`income.ts` “Called a refund by the bank”). Paired refunds are excluded from both Income and Spending (not added as Refund credits). Dashboard has no Refund-credits tile. `flow.refunds` exists but is not in Net. |
| Net Money = Income − Spending + Refund credits | **fail** | `const net = roundMoney(income - spending)`. (`summary.ts` 93.) Sample NAB medicare+rent, merged two-device: cashIn **$204,214.49**, cashOut **$203,665.05**, cashNet **$549.44** — raw cash, not Spec 10 Net. (`merge.test.ts` 187–199.) Up year shown set: income **$70,125.50** − spending **$71,182.45** = net **−$1,056.95** with reversed charges already stripped from both sides (`ledger.test.ts` 461–465). |
| Actual Savings = TRANSFER IN to SAVINGS / `user_flagged_savings` only | **not-implemented** | No `user_flagged_savings`. Savings UI: user-typed `saved` / `target` / `monthlyContribution`. “Set aside this period” = `flow.transfers` = absolute value of **debit** legs of matched pairs, any destination. (`savings-view.tsx` 52–54, `summary.ts` 75–79, `savings.ts` 155–161 counts every `type === "moved"`.) Spec 9 linked balances / “Not Actual Savings” also absent. |

**Tile mapping (current vs Spec 10)**

| UI label | Current formula | Spec 10 |
| --- | --- | --- |
| Money in | Σ credits with `countsAsIncome(type)` among unpaired counted rows | Σ `base_amount` Income, `CLEARED` only; no refund credits |
| Money out | Σ abs(debits) with `countsAsSpending(type)` | Σ `base_amount` Spending, month-frozen |
| Net | income − spending | Income − Spending + Refund credits |
| Set aside / transfers | matched inter-account moves, counted once | Actual Savings = TRANSFER IN to savings accounts only |

---

## What this pass did not change

- No Soft pool, Recurring, or Budget implementation.
- No Spec 6c remap / `DUPLICATE_HOLD` / `UNPAIRED_TRANSFER` pipeline (that is a feature slice, not a one-line fix).
- No Spec 7 reason-code queue (would replace the merchant category UI).
- No Spec 10 calculator rewrite.

Those gaps are locked by the specs but are **not small**. Wiring `DUPLICATE_HOLD` or Refund-credits without the status/kind model would create a second, half-true calculator beside the current one.

---

## Tests run

```
npx tsx --test \
  src/lib/money-flow/ledger.test.ts \
  src/lib/money-flow/transfers.test.ts \
  src/lib/money-flow/refunds.test.ts \
  src/lib/money-flow/review.test.ts \
  src/lib/money-flow/merge.test.ts \
  src/lib/money-flow/period.test.ts \
  src/lib/money-flow/income.test.ts
# tests 91  pass 91  fail 0
```

These tests lock the **current** (pre-Spec) money model. They are evidence of drift, not of Spec 6c/7/10 compliance.
