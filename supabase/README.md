# BitbyBit Supabase setup

Auth and cloud persist need a hosted Supabase project. The app still runs signed-out without these keys.

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. In its SQL Editor, run `migrations/202608210001_initial_finance_schema.sql`, then `migrations/202608270001_auth_persist_schema.sql`.
3. Copy the project URL and **publishable** key into `.env.local` from `../.env.example`. Do not commit that file. Never put `service_role` in the app.
4. In Authentication, enable email + password. Turn on magic-link email if you want one-time links. Add `http://localhost:3000/auth/callback` (and the production origin) to Redirect URLs. Set `NEXT_PUBLIC_SITE_URL` to that production origin so confirmation links are not built from `Origin` or `X-Forwarded-Host`.
5. Create two test users. The `handle_new_user` trigger creates `public.users`, default categories, and preferences.

## Manual verification (use the authenticated client, not service role)

- Each user can read only their own `accounts`, `transactions`, `uploaded_files`, `categories`, `budgets`, `recurring_items`, `savings_pots`, and `user_preferences`.
- An insert with another user's `user_id` is rejected by RLS.
- A transaction cannot reference another user's account, category, or source file because of composite foreign keys.
- Source file bytes are not stored (`storage_path` stays null). Originals stay in memory during parse only.

The service-role key bypasses row-level security and must never be exposed in the browser, `src/proxy.ts`, or `NEXT_PUBLIC_*`.
