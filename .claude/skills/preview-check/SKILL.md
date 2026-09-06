---
name: preview-check
description: Assemble the manual check list for a change on the Vercel preview — the preview URL for the current branch plus the routes and interactions worth clicking for what changed. Use after pushing, since no automated test in this repo covers the UI.
disable-model-invocation: true
---

# Check it on the preview

Every test in this repo lives under `src/lib/`. Nothing renders a component, so the UI is
verified by hand on the Vercel preview. This assembles the list; the user does the clicking.

## 1. Find the preview

In order of what is usually quickest:

- The **Vercel comment on the pull request** — it links the preview for the branch head.
- The **Vercel MCP**, when connected: `list_projects`, then `list_deployments` filtered to
  the branch, then `get_deployment` for its URL. `get_deployment_build_logs` if the build
  failed and `get_runtime_errors` / `get_runtime_logs` for a page that renders but breaks.
- The **Vercel dashboard**, filtered to the branch.

Confirm the deployment's commit SHA matches what you pushed before reporting anything about
it. A preview built from an older commit is worse than no preview.

## 2. What to click

Pick the rows the change actually touches, not the whole list.

| Route | Worth checking | Backed by |
|---|---|---|
| `/` | Landing copy still matches what shipped | `app/page.tsx` |
| `/sign-in` | Sign-in appears only when Supabase is configured; the app works without it | `sign-in-form.tsx`, `supabase/config.ts` |
| `/upload` | Drop a sample from `public/samples/`, watch it read, review the queue, accept | `upload-studio.tsx`, `review-queue.tsx` |
| `/dashboard` | Totals, the income rhythm, unsettled money prompts | `dashboard-view.tsx`, `income-rhythm.tsx`, `unsettled-money.tsx` |
| `/transactions` | Table density, sorting, paging, the category chart below the list | `transaction-table.tsx`, `tag-charts.tsx` |
| `/categories` | Renaming a category does not rewrite stored rows | `category-book-editor.tsx` |
| `/accounts` | Institution names, merging two accounts, account linking | `accounts-view.tsx`, `account-link.tsx` |
| `/recurring` | Detected repeats and their cadence | `recurring-view.tsx` |
| `/savings` | Goals and the savings charts | `savings-view.tsx`, `savings-charts.tsx` |
| `/goals` | Renders and reflects savings state | `app/(app)/goals/page.tsx` |

## 3. Always worth a pass

- **Upload a sample end to end.** It is the app's most stateful surface: file → OCR or
  parse → review → accept. Most regressions show up here first.
- **Re-upload the same file.** Nothing should double-count; the fingerprint is what stops
  it. Repeat imports are the single most breakable behaviour in the app.
- **Signed out.** The app is designed to work fully with no Supabase and no network. Check
  the change did not make sign-in load-bearing.
- **Narrow width.** The transactions table and charts are the first things to break.

## 4. Report back

Say which routes were checked, on which commit, and what you saw — including anything you
could not check and why. Do not describe UI behaviour you did not observe; if the user is
doing the clicking, say that plainly and wait for what they find.
