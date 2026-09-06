---
name: ship
description: Run the full gate — typecheck, lint, tests, and the sample-statement check when the reader changed — then commit in this repo's house style and push. Use when a change is finished and ready to go up.
disable-model-invocation: true
---

# Ship it

The sequence AGENTS.md asks for at the end of every change, in order. Do not skip a step
because the change looks small; do not reorder them so a failure lands after the commit.

## 1. The gate

```bash
npm run typecheck && npm run lint && npm test
```

All three must pass. If one fails, fix the cause — never work around it, never commit with a
failure noted "to fix later". Report the failure output verbatim if you cannot fix it.

## 2. The sample check, when the reader changed

If the diff touches `src/lib/money-flow/`, `src/lib/store/`, or anything else that changes
how a statement is read:

```bash
npx tsx .claude/skills/verify-samples/verify-samples.ts
```

See `/verify-samples` for the baseline the figures are compared against. Keep the output —
it goes in the commit message.

## 3. Branch

Never commit to `main`. If you are on it, branch first. Work goes up as a pull request.

## 4. Commit in the house style

Read `git log` before writing the message. The shape this repo uses:

- **Subject**: a full sentence saying what the change does, no `feat:`/`fix:` prefix.
  *"Record the cells a PDF, OFX or QIF statement printed"*, not *"fix: pdf source cells"*.
- **Body**: what was wrong and why it mattered — the condition that forced the change, in
  prose. *"Only the table readers kept the statement's own cells, so Show statement was
  empty for a PDF."* Say what the change deliberately does **not** do, and why, when that
  was a real decision.
- **Verification block**, when the reader changed — the figures from step 2, in the
  established shape:

  ```
  Verified against public/samples/nab-medicare.csv, nab-rent.csv and up-2025-07-to-2026-06.txt:
  Income $142,796.02 · Spending $168,303.53 · Own-money transfers $118,183.87 · Movements 1,704
  (437 NAB, 1,267 Up) · Transfer pairs 169, contested 0 · NAB cash in/out $204,214.49 / $203,665.05
  · Up cash in/out $85,020.99 / $86,077.94
  Names still read KFC, Grill'd, PayPal, JORDAN LEE.
  ```

- **Trailer**:

  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

Note that `next dev` rewrites the agent block in `AGENTS.md`. If that shows as an
uncommitted change, commit it with the work rather than reverting it — reverting only
re-creates it.

## 5. Push

```bash
git push -u origin HEAD
```

Then tell the user the branch is up and what still needs their eyes — the UI, which no test
here covers. `/preview-check` lists what to look at on the Vercel preview.

## Do not

- Skip hooks (`--no-verify`) or bypass signing.
- Amend or force-push someone else's commit.
- Commit `.env.local`, a service-role key, or an unredacted statement.
- Push before the gate passes.
