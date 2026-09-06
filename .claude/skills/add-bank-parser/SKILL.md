---
name: add-bank-parser
description: Add a reader for a bank BitbyBit does not yet recognise — the stage-A file reader, its registration in the bank filter, its institution profile, tests, and a redacted fixture. Use when a statement from a new bank is being imported, or when an existing bank's export is being read as a generic table instead of as its own format.
disable-model-invocation: true
---

# Add a bank statement reader

Two banks are wired up today: NAB (`nab-statement.ts`, a CSV export read by headers) and
Up / Bendigo (`up-statement.ts`, a printed statement read as text). A third follows the same
five steps. Read whichever of the two is closer to the new bank's format before starting —
the new file should look like its sibling.

## Ask first

Before writing anything, confirm with the user:

- **The bank's label**, exactly as it should appear in the app ("Up", "NAB").
- **The format**: a spreadsheet-style export with a header row, or printed statement text?
  That decides which branch of `readBankSource` you register in.
- **A sample file** — a redacted one, for `public/samples/`. Without a real file you are
  guessing at the format, and guessing is against the conventions of this reader.

## The five steps

### 1. The reader — `src/lib/money-flow/<bank>-statement.ts`

Export exactly two things (a third only if something else needs it, as `upgrade.ts` needs
`nameFromPrintedLines`):

```ts
// Detection. Cheap, and specific enough that no other bank's file matches.
export function looksLike<Bank>Export(headers: string[]): boolean
// or, for printed text:
export function looksLike<Bank>Statement(text: string): boolean

// Stage A: the file's own cells, mapped onto RawMovement. No categorisation here.
export function movementsFrom<Bank>Table(
  headers: string[],
  rows: Array<Array<string | number | null>>,
  sourceFile: string,
): RawMovement[]
```

Follow `nab-statement.ts` on the details that matter:

- **Name the columns as constants** and look them up by those names, not through pooled
  header vocabularies. The comment there explains why: otherwise "Processed On" steals the
  date and "Merchant Name" steals the description.
- **Skip a row that lacks a date, an amount, or a description** rather than inventing one.
- **Fill `source`** via `sourceFromCells(headers, cells)` — every cell the statement
  printed, kept as evidence.
- **Set `directionKnown`** honestly. `true` only when the file gives a signed amount or an
  unambiguous type column; otherwise `false` and let `interpretMovement` decide.
- **`id`** is `` `${sourceFile}-${index}-${dateIso}-${amount}` `` — stable across re-imports
  of the same file.
- **`confidence`** reflects how sure the mapping is (NAB's typed export is `0.92`).

Do not categorise, tidy merchants, or pair transfers in this file. That is stage B
(`interpretMovement`), and it runs for every bank.

### 2. Register it — `src/lib/money-flow/bank-filter.ts`

Add a branch to `readBankSource`, alongside the NAB and Up branches, with a note in the same
voice as the existing two ("Read as an Up / Bendigo bank statement."). The note is shown to
the person, so it says what the reader concluded, not what it did internally.

For a **text** statement, also add the note to `notesForText` in `parsers.ts` — Up appears
in both places, because text reaches the reader by two paths.

### 3. Institution profile — `src/lib/money-flow/institution.ts`

Add a `Profile` to `PROFILES`:

- `label` — the bank's name as displayed.
- `statement` — a regex matching wording only this bank prints on every page. Up uses
  `/up is a brand of bendigo|zap card \*\*/i`.
- `name` — the bank's own name, for an OFX header or a filename.
- `headers` — header sets this bank's export produces and no other's.

Prefer the statement's own wording; a filename is the weakest signal and must never be the
only one. If nothing in the file names the bank, it stays `UNKNOWN_INSTITUTION` — that is
the correct answer, not a gap to fill.

### 4. Tests — `src/lib/money-flow/<bank>-statement.test.ts`

Mirror `up-statement.test.ts`. Cover at minimum:

- Detection says yes to this bank's file and **no** to the other banks' fixtures.
- Every amount comes from the amount column, not a neighbouring cell.
- Rows the statement did not mean as movements (balance lines, notices) are dropped, with
  the count asserted.
- Account keys survive the round trip.

### 5. Fixture — `public/samples/<bank>-<span>.<ext>`

**Redacted by hand** before it goes in: that directory is committed and served publicly.
Replace merchant names and account numbers, but keep the shape — headers, wording, spacing —
because the shape is what detection reads.

## Finish

```bash
npm run typecheck && npm run lint && npm test
npx tsx .claude/skills/verify-samples/verify-samples.ts
```

The sample run must show the new file read as the new bank, and the existing NAB and Up
figures unchanged. Quote both in your summary. A new reader that moves an existing bank's
totals has matched a file it should not — fix detection before going further.
