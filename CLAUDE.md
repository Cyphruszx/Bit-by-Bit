@AGENTS.md

# BitbyBit — Claude local-file handoff

This file is the project brief for Claude (Claude Code or any local session) working from a git checkout. The tree on this branch is the same source that GitHub `main` and this Cloud Agent checkout share.

## Local / cloud sync

Verified 28 Aug 2026 on Cloud Agent run `bc-b116738c-3968-4360-bf6b-5ed6dc462abf` (started from Cursor desktop with local files).

| Check | Result |
| --- | --- |
| Cloud workspace HEAD | `6347f9f62f2e4211219a202b7334a469470437d3` |
| `origin/main` | same SHA |
| Working tree | clean (no uncommitted local files) |
| Tracked source files | 76 (no extra untracked source files) |

To re-check on another machine:

```bash
git fetch origin main
git rev-parse HEAD origin/main
git status --porcelain
git diff HEAD origin/main
```

All four should show the same SHA, an empty porcelain list, and an empty diff. Then this checkout matches GitHub and the cloud snapshot of local files.

**Not on this tree** (open PRs that exist only on other cloud branches). Do not merge them unless the user asks:

- [#11](https://github.com/Cyphruszx/Bit-by-Bit/pull/11) `cursor/auth-review-efficiency-e707` — cookie sessions + Supabase persist (review-fixed; prefer this over #9)
- [#10](https://github.com/Cyphruszx/Bit-by-Bit/pull/10) `cursor/critical-bug-management-a63f` — date-shift / dropped-transaction parser fixes
- [#8](https://github.com/Cyphruszx/Bit-by-Bit/pull/8) `cursor/product-plan-reference-279c` — `docs/PLAN.md` product plan
- [#1](https://github.com/Cyphruszx/Bit-by-Bit/pull/1) `cursor/setup-dev-environment-37b1` — Cloud Agent `environment.json`

PRs #3–#7 are still open on GitHub but their commits are already ancestors of `main` (`4e28e77` … `6347f9f`).

## What this app is

BitbyBit is an Australian personal-finance web app. Users upload bank files, PDFs, spreadsheets, OFX/QIF, Word, HTML, JSON, photos of receipts, or plain text. The server interprets them into money in, money out, and tagged movements. The UI is client-side `localStorage` on this branch (no signed-in cloud persist).

Brand copy lives in `src/lib/brand.ts`. Locale is `en-AU`.

## Stack

- Next.js 16 App Router, React 19, TypeScript, Tailwind 4
- Document parsers: `xlsx`, `unpdf`, `mammoth`, `tesseract.js`
- Optional OpenAI vision/tagging via server-only `OPENAI_API_KEY`
- Checkpoint-2 SQL only in `supabase/migrations/` (not wired into the app on this branch)

## Commands

```bash
npm ci
cp .env.example .env.local   # fill keys as needed; never commit .env.local
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
```

## Routes

| Path | Role |
| --- | --- |
| `/` | Marketing home |
| `/upload` | Upload + interpret documents |
| `/dashboard` | Period summary, tag charts, savings snapshot |
| `/transactions` | Editable tagged movements |
| `/recurring` | Recurring payments vs activity in the period |
| `/savings` | Savings pots and charts |
| `/accounts` | Accounts / demo accounts |
| `/goals` | Goals page |

App chrome is `src/app/(app)/layout.tsx` → `AppShell` + `AppNav`.

## Where the logic lives

- Upload server action: `src/app/actions/interpret-documents.ts`
- Interpretation pipeline: `src/lib/money-flow/` (`detect`, `parsers`, `interpret`, `categorize`, `ai`, `tags`, `period`, `summary`, `recurring`, `savings`)
- Client store: `src/components/money-flow-provider.tsx` (`bitbybit.interpreted-v1`, `bitbybit.period-v1`)
- Recurring / savings stores: `src/components/recurring-store.tsx`, `src/components/savings-store.tsx`
- Sample files: `public/samples/`

## Agent rules

Follow `AGENTS.md`. Confirm with the user before a new feature, architecture change, or extra slice of work. Next.js APIs in this repo may differ from older training data; read `node_modules/next/dist/docs/` after install when needed.

Do not put secrets in git, `CLAUDE.md`, or chat. The service-role Supabase key must never go in the browser.
