# VERIFICATION REPORT — Phase B Specs 2–6 (post Slices 1–5)

**Date:** 2026-09-14  
**Mode:** Docs report only. No product fix PRs. No Phase C. Soft pools / Recurring / Budget / Spec 11 / Spec 6b / opening balances / Excel OFX QIF **implementation** are out of scope.  
**Audited tip:** `cursor/spec-10-calc-truth-9284` / [PR #34](https://github.com/Cyphruszx/Bit-by-Bit/pull/34) @ `cd7c8f5` — *not* `main`.  
**Compare-from:** [PR #35](https://github.com/Cyphruszx/Bit-by-Bit/pull/35) Phase A GREEN on this same tip (`docs/VERIFICATION-PHASE-A-POST-SLICES-1-5.md`).

**SoT:** Notion Master Product & Technical Spec (consolidated 13 September 2026) — Amendments locked through Specs 2–10 + Spec 6c. Master page lock summaries + this Phase B lock list. Master overrules notion-spec-splits and research notes (01–37). Full per-Spec `.md` attachments are filed on the Master page; Notion MCP returns those file blocks as empty (not `file_upload` objects), so lock language is taken from the Master page summaries plus the Phase B checklist.

Verdict vocabulary: **pass** / **fail** / **not-implemented** / **drift**. Residuals are listed under a pass when they do not change the assert.

---

## Phase B scoreboard (this tip)

| Spec | Overall | What that means |
| --- | --- | --- |
| **2** Free ingest | **fail** / **not-implemented** | Formats still accept Excel/OFX/QIF/PDF; weekly quotas, mapper, Confirm slot, and 1-file/attempt are absent. |
| **3** movement_kind + interpretation | **pass** (residuals) | Phase A feeders still hold. Status model and conflict detectors lag. |
| **4** Guest → account | **not-implemented** | Empty-cloud copy works. No Merge/Keep/Replace, no conflict → RQ, no quota `max()`, no layout/themes/goals migrate. |
| **5** Feature toggles + dashboard | **not-implemented** | Empty dashboard OK. No toggles, rearrange, themes, or enable-offer hygiene. Recurring is always in nav. |
| **6** Rename / merge eligibility | **pass** (type-change NI) | Rename is display-only. Currency + CREDIT/LOAN/MORTGAGE ↔ CHECKING/SAVINGS blocks exist. Spec 6c remap already **pass**. Soft pool not designed. |

**Flip vs Phase A:** Phase A scored Spec 3 feeders + 6c / 7 / 10 as **pass**. This audit does **not** reopen those money-trust calc asserts. It scores the rest of Specs 2–6. Spec 2 and Spec 4/5 are the uncovered Core product surface.

---

## Spec 2 — Free ingest

Master summary: Core ingest = CSV + OCR only (5 CSV / 20 OCR pages per AU week). Launch AU bank presets; uploads land as `CLEARED` or `DUPLICATE_HOLD`.

| Lock | Verdict | Evidence |
| --- | --- | --- |
| Free = CSV + OCR only; reject Excel / OFX / QIF | **fail** | `acceptedDropTypes()` lists `.xlsx`, `.xls`, `.ofx`, `.qfx`, `.qif`, plus PDF/Word/HTML/JSON. `src/lib/money-flow/accept.ts`. `parseDocument` routes OFX/QIF/xlsx to transactions. `src/lib/money-flow/parsers.ts`. Upload copy advertises them. `src/components/upload-studio.tsx`. Tests assert Excel/OFX/QIF succeed (`src/lib/money-flow/interpret.test.ts`). **Not a product-fix ask** — scored because the lock is “reject”. |
| Quotas: 5 CSV/week, 20 OCR pages/week; AEST/AEDT week | **not-implemented** | No quota type, counter, week bucket, or store field in `src/` or `supabase/migrations/`. `APP_TIME_ZONE = "Australia/Sydney"` is Spec 10 month math only. `src/lib/money-flow/period.ts`. |
| 1 file / attempt | **fail** | `MAX_FILES = 8`. File input is `multiple`. Sample “NAB both accounts” loads two CSVs in one interpret. `src/lib/money-flow/interpret.ts`, `src/app/actions/interpret-documents.ts`, `src/components/upload-studio.tsx`. |
| Size limits | **drift** | `MAX_FILE_BYTES = 12 * 1024 * 1024` exists and is enforced on interpret + the server action. There is no Spec 2 weekly object or per-kind cap beside this 12MB / 8-file burst. `src/lib/money-flow/interpret.ts`. |
| OCR charge N pages at intake, including failures | **not-implemented** | Images run Tesseract once with no page count and no debit. Failed OCR returns empty transactions and does not decrement anything. PDF uses `unpdf` text extract, not an OCR page charge. `src/lib/money-flow/parsers.ts`. |
| CSV slot only on Confirm; abandon mapper free; wrong bank → remap escape | **not-implemented** | No mapper UI, no Confirm step, no CSV slot. Upload → `interpretDocuments` → `appendToLedger` → `commit` in one shot. `src/components/money-flow-provider.tsx` `importDocuments`. `setStatementInstitution` / `nameInstitution` relabel a bank **after** commit; they are not a slot-free remap escape. |
| Single-account row-by-row vs multi-account buffer until assigned | **not-implemented** | `identifyAccounts` stamps `accountId` at parse; `appendToLedger` writes every row in the file immediately. No buffer-until-assigned, no per-row commit gate. `src/lib/money-flow/ledger.ts`. |
| RQ resolve does not re-consume quota | **pass** | Resolve / decline / dismiss are `editWith` / `recordReview` / pair writers only. They do not call `interpretDocuments`. Same path Phase A already scored. Residual: the weekly quota object itself is still absent, so this cannot re-consume what is not on this path. `src/components/money-flow-provider.tsx`, `src/lib/money-flow/review-queue.ts`. |
| Upload statuses `CLEARED` \| `DUPLICATE_HOLD` only (`PENDING` reserved for OB) | **drift** | New rows commit `status: "CLEARED"`. `src/lib/money-flow/interpret-row.ts`. Row type is `"CLEARED" \| "HOLD"` — `HOLD` is a Spec 10 tile stub, not `DUPLICATE_HOLD`. `src/lib/money-flow/types.ts`. `DUPLICATE_HOLD` is a Review Queue **reason**, not a row status. File layer uses `processingStatus: "pending" \| "processing" \| "completed" \| "failed"` — `pending` is used here, not reserved. |
| Launch AU bank presets | **pass** | `PROFILES`: Up, NAB, Commonwealth Bank, ANZ, Westpac, Bendigo Bank, ING, Macquarie. `src/lib/money-flow/institution.ts`. Shown in the Accounts bank datalist. |

**Spec 2 overall:** **fail** / **not-implemented**. Adjacent parse/ledger primitives exist. Gated free ingest (allowlist, week, Confirm, slot) is greenfield.

---

## Spec 3 — `movement_kind` + interpretation

Master summary: `movement_kind` ENUM, fingerprint, transfer/refund rules, authority ladder. Actual Savings is Spec 10 (already Phase A **pass**). Phase A already scored feeders; residuals are re-scored here.

| Lock | Verdict | Evidence |
| --- | --- | --- |
| `movement_kind` ENUM | **pass** | `MOVEMENT_KINDS`: `TRANSFER`, `SPENDING`, `INCOME`, `REFUND`, `DEBT_PRINCIPAL`, `DEBT_COST`, `INVESTMENT`, `ADJUSTMENT`, `UNREVIEWED`. Writers emit these. `kindOf` / `migrateStoredType` map earned/spent/…. `src/lib/money-flow/movement-kind.ts`, `src/lib/money-flow/spec-3.test.ts`. Residual: category book still stores `inType`/`outType` as earned/spent. `DEBT_COST` exists and tiles as spending; charged interest still writes `SPENDING`. |
| Status `PENDING` \| `CLEARED` \| `DUPLICATE_HOLD` | **drift** | Row status is `"CLEARED" \| "HOLD"`. Missing status reads as CLEARED (Phase A / Spec 10). `DUPLICATE_HOLD` is RQ reason + tile hold, not a persisted row status. `PENDING` is unused on movements (reserved for OB in comments) but **is** used on `FileInterpretation.processingStatus`. `src/lib/money-flow/types.ts`. |
| Fingerprint | **pass** | `[acct:canonical \| file:source, dateIso, amount.toFixed(2), hash(raw_description), occurrence]`. FNV-1a 32-bit of the normalised description. Legacy wording fingerprints still match and rewrite. `src/lib/money-flow/ledger.ts` `fingerprintOf`. `src/lib/money-flow/spec-3.test.ts`. |
| Authority ladder | **pass** | Collapse: `user_overridden` / `said` > `user_rule` / `learned` > Core (`paired`/`merchant`/`rules`/`bank`/`ai`) > `UNREVIEWED`. `outranks` refuses a merchant rule over a settled row. `src/lib/money-flow/movement-kind.ts`, `src/lib/money-flow/classify.ts`. Residual: `DecidedBy` still stores Core rungs; they collapse to “Core”. |
| Transfer / refund Spec-7 gated | **pass** | Detect only (`matchTransfers` / `matchRefunds`). Ingest runs `forgetAutoPairs`. CC repayment from CHECKING/SAVINGS → `TRANSFER` without a pair. RESOLVE is the write. `src/lib/money-flow/interpret.ts`, `src/lib/money-flow/auto-pairs.ts`, `src/lib/money-flow/classify.ts`. |
| `UNREVIEWED` kind path | **pass** | Unsorted → `UNREVIEWED`; queue reason `UNREVIEWED_KIND`. `typeForCategory`, `src/lib/money-flow/review-queue.ts`. |
| `FINGERPRINT_CONFLICT` / `RULE_CONFLICT` live detectors | **not-implemented** | Reasons are in `REVIEW_REASONS` and `TILE_HOLD`. `detectReviewItems` only **replays stored** OPEN items for those two reasons. Re-import on the same fingerprint calls `applyReimportOverride` (user override wins silently) and does **not** open RQ. `src/lib/money-flow/review-queue.ts`, `src/lib/money-flow/ledger.ts`. |

**Spec 3 overall:** **pass** with residuals. Money-trust feeders from Phase A still hold. The leftover that matters for Phase B is the missing conflict detectors (shared with Spec 4).

---

## Spec 4 — Guest → account migration

Master summary: Empty cloud → copy guest; both have data → Merge / Keep / Replace (scary). Quotas `max(guest, user)`; copy includes layout, themes, goals, linked balance views. Fingerprint / rule conflict → RQ.

| Lock | Verdict | Evidence |
| --- | --- | --- |
| Empty cloud → copy guest | **pass** | `there === "absent"` + `holdsAnything(mine)` → `push(mine)` then `claim()`. Inherited (other user's) browser copy is discarded. `src/lib/store/cloud-ledger-store.ts`. Tests in `src/lib/store/cloud-ledger-store.test.ts`. |
| Both have data → Merge / Keep / Replace | **not-implemented** | Always `mergeLedgers(mine, there.ledger)` — silent fingerprint union. Comment: “Nothing is ever replaced.” No UI or API for Keep / Replace. `src/lib/store/cloud-ledger-store.ts`, `src/lib/money-flow/ledger.ts`. |
| Fingerprint conflict → RQ | **not-implemented** | Same-fingerprint guest vs cloud: local row wins (`...entry` from `mine`), import ids unioned. No `FINGERPRINT_CONFLICT` item is opened. `mergeLedgers`. Re-import path also silent (`applyReimportOverride`). |
| Rule conflict → RQ | **not-implemented** | `mergedRules` is `{ ...theirs, ...mine }` — last-write local wins, no `RULE_CONFLICT`. |
| Migrate ledger | **pass** (auto-union) | Ledger entries, imports, names, `mergedInto`, verdicts, rules union. This is not the specified Merge / Keep / Replace choice. |
| Migrate layout / themes | **not-implemented** | No layout or theme fields on `Ledger`. `pickedTaxonomy(mine, theirs)` = `mine ?? theirs` (one book, not a merge). `src/lib/money-flow/ledger.ts`. |
| Migrate goals / linked balances | **not-implemented** | Savings pots live in `localStorage` key `bitbybit.savings-v1`, not the cloud ledger. `/goals` redirects to `/savings`. Recurring is a separate local store. `src/components/savings-store.tsx`, `src/app/(app)/goals/page.tsx`. |
| Quotas `max(guest, user)` | **not-implemented** | No quota object exists (see Spec 2). |

**Spec 4 overall:** **not-implemented**. The one working path is “empty cloud copies the guest ledger.” Conflict and choice locks that protect money-trust on sign-in are absent.

---

## Spec 5 — Feature toggles + dashboard

Master summary: Core-only day-one defaults; empty dashboard OK. After first `CLEARED`, offer Budget (Spec 11) / Goals / Linked balances; omit Cash Flow / Recurring until specified.

| Lock | Verdict | Evidence |
| --- | --- | --- |
| Feature toggles hide UI | **not-implemented** | No feature-flag / enable store in `src/`. Nav is a fixed list. |
| Dashboard rearrange | **not-implemented** | `DashboardView` is a fixed section order (tiles → income → accounts → charts). `src/app/(app)/dashboard/dashboard-view.tsx`. |
| Dashboard themes | **not-implemented** | Single theme in `src/app/globals.css`. No per-user theme preference on the ledger or a settings store. |
| Offer hygiene: omit Cash Flow / Recurring from enable offer | **not-implemented** | There is no enable offer. Recurring is a first-class nav item from day one. `src/components/app-nav.tsx`: Upload, Dashboard, Transactions, Categories, **Recurring**, Savings, Accounts. |
| After first `CLEARED`, offer Budget / Goals / Linked balances | **not-implemented** | No first-CLEARED gate. Budget (Spec 11) is out of scope and absent. Goals route redirects to Savings. No Linked balances surface. |
| Core-only day-one defaults | **drift** | Empty dashboard is Core-shaped, but Recurring / Savings / Categories are already in chrome before any upload. |
| Empty dashboard OK | **pass** | `!hasUploads` → `EmptyLedger`. `src/app/(app)/dashboard/dashboard-view.tsx`. |

**Spec 5 overall:** **not-implemented**. Empty dashboard is the only lock that holds. Recurring-in-nav is the offer-hygiene miss (Recurring product itself remains out of Phase B scope).

---

## Spec 6 — Accounts rename / merge eligibility

Master summary: Rename = display only. Hard-block cross-family merges; hard merge only for true duplicate bank products. Amended by Spec 6c (already **pass** on this tip). Soft pool not designed — out.

| Lock | Verdict | Evidence |
| --- | --- | --- |
| Rename = display only | **pass** | `nameAccount` writes `ledger.accounts[key]` only. “Naming never merges two accounts and never undoes a hard merge.” `src/lib/money-flow/ledger.ts`. `accountCaption` uses the label; `canonicalAccountId` does not. `src/lib/money-flow/account-identity.ts`. UI: `InlineName` → `setAccountName`. `src/app/(app)/accounts/accounts-view.tsx`. Test: clearing a name keeps `mergedInto`. `src/lib/money-flow/hard-merge.test.ts`. |
| Type change confirms | **not-implemented** | `AccountMeta.kind` and `inferAccountKind` exist. No Accounts UI to change type and no confirm dialog. Kind is inferred from the id string (mortgage/loan/credit/savings) unless stored on `accountMeta`. `src/lib/money-flow/account-identity.ts`, `src/app/(app)/accounts/accounts-view.tsx`. |
| Hard merge: currency block | **pass** | `mergeBlockedReason` refuses mismatched `accountMeta.currency` (default AUD). `src/lib/money-flow/account-identity.ts`. Covered in `src/lib/money-flow/hard-merge.test.ts`. |
| Hard merge: CREDIT / LOAN / MORTGAGE ↔ CHECKING / SAVINGS | **pass** | Same function: `DEBT_KINDS` vs `ASSET_KINDS`. UI surfaces `mergeError`. `src/app/(app)/accounts/accounts-view.tsx`. |
| Path B = duplicates-only framing | **pass** (residual) | `mergeSuggestions()` only offers full-number ↔ masked-tail, same institution. Copy: “These might be the same account.” Residual: any sibling in the same institution group can still be merged from the “Same as” `<select>` — eligibility blocks still apply, but the picker is not limited to Path B suggestions. Soft pool **not designed** (out). |
| Spec 6c remap (already on tip) | **pass** | `mergeAccounts` remaps `accountId`, recomputes `fingerprintOf`, collision → one CLEARED + OPEN `DUPLICATE_HOLD`, same-account pair → `UNPAIRED_TRANSFER`, no undo. See Phase A / `src/lib/money-flow/hard-merge.test.ts`. |

**Spec 6 overall:** **pass** on eligibility + rename + 6c. Type-change confirm is the open lock. Soft pool remains undesigned.

---

## Money-trust residuals that matter

These are the leftovers that can still lie about money or silently fuse ledgers. Not Phase C. Not Soft pools.

1. **Free ingest is ungated.** Excel / OFX / QIF / PDF / Word / HTML / JSON all parse. Eight files per attempt. No weekly CSV/OCR quota. Anyone on Core can flood the ledger. `src/lib/money-flow/accept.ts`, `src/lib/money-flow/interpret.ts`.
2. **Immediate commit — no Confirm slot.** A dropped file writes CLEARED rows before a person maps columns or assigns a multi-account buffer. Wrong-bank remap is post-hoc and already consumed the (non-existent) slot. `src/components/money-flow-provider.tsx`.
3. **Status model drift.** Tiles key off `CLEARED` (missing = CLEARED). Duplicates are an RQ reason, not `status: DUPLICATE_HOLD`. File `processingStatus` uses `pending`. A later PENDING-for-OB / opening-balance path has no reserved row status. `src/lib/money-flow/types.ts`.
4. **No live `FINGERPRINT_CONFLICT` / `RULE_CONFLICT`.** Re-import and guest↔cloud union settle same-fingerprint / same-rule clashes silently. RQ will hold those reasons **if stored**, but nothing creates them. Shared Spec 3 + Spec 4 hole. `src/lib/money-flow/ledger.ts` `applyReimportOverride`, `mergeLedgers`.
5. **Guest sign-in always unions.** Two ledgers become one without Merge / Keep / Replace. Local tags win; the other copy’s import ids are kept. That can hide a conflict the person never saw. `src/lib/store/cloud-ledger-store.ts`.
6. **Goals / linked / themes do not migrate.** Savings pots stay in `localStorage`. A guest who set pots then signed in loses them on another device. Not a tile lie; it is a migration lie next to Spec 4.
7. **Recurring is always in chrome.** Offer hygiene (omit Recurring / Cash Flow) is not implemented. Recurring product remains out of scope; the nav leak is the Spec 5 miss.

Does **not** flip Phase A: Spec 10 tiles, Spec 7 OPEN holds, Spec 6c remap, Core-does-not-auto-pair.

---

## Sample numbers (`public/samples/`) — unchanged from Phase A

Household (`nab-medicare.csv` + `nab-rent.csv` + `up-2025-07-to-2026-06.txt`) after Core ingest (no auto-pairs):

| Figure | Value |
| --- | --- |
| Income | **$145,096.99** |
| Spending | **$89,913.17** |
| Refund credits | **$0** |
| Net | **$55,183.82** |
| cashNet | **−$507.51** |
| Actual Savings | **$0** |

Quoted from `src/lib/money-flow/interpret.test.ts` on this tip. Phase B does not change how a statement is read.

---

## Out of scope (do not treat as fails)

- Soft pools / Spec 6b
- Recurring product behaviour (nav presence is scored under Spec 5 offer hygiene only)
- Budget / Spec 11
- Opening balances / OB `PENDING`
- Excel / OFX / QIF as a **feature to build** (only scored as “must reject”)
- Phase C
- Product-code fixes

---

## Tests run on this tip

Docs-only. No product files changed. Tip suite at `cd7c8f5` (Phase A): `npm test` **470 pass / 0 fail**. Re-run on this docs branch recorded in the PR.

---

## What this run did not do

- No Phase C.
- No Soft pool / Recurring / Budget / Spec 11 / Spec 6b / opening-balance implementation.
- No product-code fixes. This file is the Phase B coverage audit of Specs 2–6 on the Slices 1–5 tip.
