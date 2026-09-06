---
name: project-conventions
description: The unwritten rules of the BitbyBit money-flow reader — evidence over guessing, stable keys, frozen identity, comments that carry the why. Load before writing or reviewing code under src/lib/money-flow/, src/lib/store/ or the statement readers.
user-invocable: false
---

# BitbyBit conventions

These are the rules the code already follows. They are not style preferences; each one is
load-bearing, and the comments in the source say why. Read a neighbouring file before
adding to a directory.

## Nothing is guessed

A signal the statement did not give is not inferred from a weaker one. `institution.ts`:
*"a statement with no signal stays unknown until the person names it themselves"* —
`UNKNOWN_INSTITUTION` is a real, displayable answer, not a failure. The same holds for
transfers and refunds: a movement is the person's own money only on the evidence of both
legs (`transferPair`, `refundPair`), never on a bank's own wording. When the reader cannot
settle something, it says so and asks — see `verdicts.ts` and `unsettled-money.tsx`.

## Identity is frozen; interpretation may improve

`accountKey` is what the statement said and never changes. `accountId` is the app's current
best grouping and may improve as the reader does. They are deliberately separate — read the
comment on `accountId` in `types.ts` before touching either.

A movement's fingerprint is built from its account key. That is why statement detail cannot
be masked before it reaches Supabase (`supabase/README.md`): masking changes the
fingerprint, which breaks repeat imports and leaves a backup that restores a degraded
ledger. Do not propose masking as a privacy fix; row-level security is the answer there.

## Keys are stable, names are display

`categoryKey` is a stable key like `groceries`; the display name is separate. The comment in
`types.ts` records what happened when they were the same thing: renaming a category rewrote
every row carrying it, and no report could be compared with one drawn a week earlier. Any
new dimension follows this shape.

## Evidence is kept, never rewritten

`source` holds every cell the statement printed for a movement, and `description` keeps the
raw wording because it identifies a movement more reliably than the tidied merchant. When
the working columns change, the evidence does not.

## Tags never move a total

`tags` are freeform and are for finding things. A tag that changed a figure would be a
second category wearing a different name — the exact mistake that layer exists to undo.

## Two stages, in order

Reading a bank file is stage A (`readBankSource` in `bank-filter.ts`: the owning bank maps
the file onto source cells and a `RawMovement`) then stage B (`interpretMovement` in
`interpret-row.ts`: fills the working columns). Bank-specific knowledge belongs in stage A
only.

## Comments carry the why

The house style is a comment that explains why a rule exists, usually by naming what broke
without it — see the header of `institution.ts` or the field comments in `types.ts`.
Comments that restate the code are not the convention. Match the density of the file you
are editing.

## Secrets

`OPENAI_API_KEY` is server-only and must never take a `NEXT_PUBLIC_` prefix. The Supabase
service-role key bypasses row-level security entirely and must never appear in the browser
or in this repository. The app is designed to work fully with neither key set — an
unconfigured Supabase means no sign-in and no network, not a broken app.

## This is not the Next.js you know

Next 16.3.2. Read the relevant guide in `node_modules/next/dist/docs/` before writing App
Router, server action or caching code. Training-data conventions are wrong here often
enough to assume they are.

## Before handing work back

`npm run typecheck`, `npm run lint`, `npm test`. If the change touched how a statement is
read, also run `/verify-samples` and quote the numbers.
