# BitbyBit Supabase database setup

Checkpoint 2 supplies the database migration only; it does not create a hosted Supabase project on your behalf.

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. In its SQL Editor, paste and run `migrations/202608210001_initial_finance_schema.sql`.
3. Copy the project URL and publishable key into a local `.env.local` file based on `../.env.example`. Do not commit that file.
4. In Supabase Authentication, create two test users. After each signup, the migration trigger automatically creates the matching app user record and initial categories.

## Manual verification queries

Use the authenticated client for each test account, not the SQL editor service role, then confirm:

- Each user can read only their own `accounts`, `transactions`, `uploaded_files`, `categories`, and `budgets`.
- An insert with another user's `user_id` is rejected by RLS.
- A transaction cannot reference another user's account, category, or source file because of composite foreign keys.

The service-role key bypasses row-level security and must never be exposed in the browser.
