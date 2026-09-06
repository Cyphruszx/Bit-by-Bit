---
name: verify-samples
description: Read every statement in public/samples/ the way the app does and print the resulting figures. Use whenever a change touches how a statement is read — parsers, bank filters, interpret-row, categorisation, transfer or refund pairing, summary totals — so the change can be reported and committed with real numbers instead of a description.
---

# Verify against the sample statements

AGENTS.md: *"When a change affects how a statement is read, verify it against a file in
`public/samples/` and quote the numbers."* This is how, and the output is shaped to match
the verification block the commit messages in this repo already carry.

## Run it

```bash
npx tsx .claude/skills/verify-samples/verify-samples.ts
```

Takes about a minute — the Up statement is 1,267 movements of plain text.

The reader runs with `{ ai: null }`, so no OpenAI call is made even when `OPENAI_API_KEY`
is set in `.env.local`. Two runs of an unchanged reader print identical figures; any
difference belongs to the change under test.

## The baseline

An unchanged reader, on the three fixtures currently in `public/samples/`:

| | |
|---|---|
| `nab-medicare.csv` | 378 movements, read as a NAB account export |
| `nab-rent.csv` | 59 movements, read as a NAB account export |
| `up-2025-07-to-2026-06.txt` | 1,267 movements, read as an Up / Bendigo statement |
| **Movements** | **1,704** (437 NAB, 1,267 Up) |
| Income | $142,796.02 |
| Spending | $168,303.53 |
| Net | −$25,507.51 |
| Own-money transfers | $118,183.87 |
| Refunds | $3,255.59 |
| Unsettled internal | $104,340.25 |
| Transfer pairs | 169, contested 0 |
| NAB cash in / out | $204,214.49 / $203,665.05 |
| Up cash in / out | $85,020.99 / $86,077.94 |
| Names | KFC, Grill'd, PayPal, JORDAN LEE all still read |

If your change was not meant to move a figure and one of these moved, that is the finding —
report it before going further. A `MISSING` in the name spot-check means a tidying change
ate a merchant name.

## How to use the output

1. Run it **before** the change and keep the output.
2. Make the change.
3. Run it again and diff the two by eye.
4. Quote the figures that moved and the ones that held. "Movements held at 1,704; spending
   fell $12.40 because the interest-rate notices are now dropped" is a verification. "The
   parser still works" is not.

A figure that moves for a reason you cannot explain is a bug, not a rounding difference.

## Into the commit message

Commits that touch the reader carry the figures. Follow the existing shape:

```
Verified against public/samples/nab-medicare.csv, nab-rent.csv and up-2025-07-to-2026-06.txt:
Income $142,796.02 · Spending $168,303.53 · Own-money transfers $118,183.87 · Movements 1,704
(437 NAB, 1,267 Up) · Transfer pairs 169, contested 0 · NAB cash in/out $204,214.49 / $203,665.05
· Up cash in/out $85,020.99 / $86,077.94
Names still read KFC, Grill'd, PayPal, JORDAN LEE.
```

Every number there comes straight off this script's output.

## What it does not cover

- **The UI.** Nothing here renders a component; the user verifies those on the Vercel
  preview — see `/preview-check`.
- **Formats no fixture represents.** There is no PDF, OFX, QIF, XLSX or receipt image in
  `public/samples/`, so those paths through `parsers.ts` are unexercised. If your change is
  to one of them, say so plainly rather than implying this run covered it.
- **Re-import behaviour.** Commits that change identity or fingerprints also state what a
  re-import does ("0 added, 1,704 duplicates; totals unchanged"). That is a separate check.
- **The unit suite.** Run `npm test` too — 32 test files assert specifics this rolls up.

## Adding a fixture

Only ever add a **redacted** statement: `public/samples/` is committed to git and served
publicly, and a real one carries merchant descriptions and account numbers. Replace names
and account numbers by hand, and keep the shape — headers, wording, spacing — because that
shape is what bank detection reads. Adding a fixture changes every total above, so restate
the baseline in the same commit.
