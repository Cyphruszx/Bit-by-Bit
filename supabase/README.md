# BitbyBit Supabase setup

BitbyBit works entirely in the browser and needs none of this. Signing in adds one thing:
your ledger is kept as a backup, so it survives a cleared browser and follows you to a
second device. With no Supabase project configured the app behaves exactly as it always
has, with no sign-in and no network.

## Setting it up

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. In its SQL Editor, run `migrations/202609040001_ledger_document.sql`.
3. Copy the project URL and publishable key into a local `.env.local`, based on
   `../.env.example`. Never commit that file.
4. In Authentication → Providers, enable Email. Turn off email confirmation only if you are
   just testing locally.

## What is stored

One row per person in `public.ledgers`, holding the ledger as a single JSON document — the
same object the browser holds. The database does not read inside it, which is why the
reader can keep changing shape without a migration each time.

**That document contains your statement detail**: merchant descriptions, amounts, and the
account numbers your statements printed. It cannot be masked before upload, because a
movement's fingerprint is built from its account key and masking would change every
fingerprint, breaking repeat imports and leaving a backup that restores a degraded ledger.

What protects it is row-level security: every policy on the table is `auth.uid() = user_id`,
so a row is reachable only by the person it belongs to. The service-role key bypasses
row-level security entirely and must never appear in the browser or in this repository.

If you would rather the server never held readable statements at all, the `document` column
holds `{ cipher, iv }` as happily as it holds the ledger, so client-side encryption can be
added later without a migration. The cost is that a forgotten password would then mean a
lost backup, with no way to recover it.

## Checking it works

Signed in as a test account, confirm:

- `select * from public.ledgers` returns only your own row.
- An insert naming another person's `user_id` is rejected.
- `revision` climbs by one on every write and is never accepted from the client — the
  `ledgers_touch` trigger sets it, which is what makes the concurrency check trustworthy.

## The older migration

`migrations/202608210001_initial_finance_schema.sql` describes a row-per-transaction schema
from an earlier plan that the app never used. It is left in place because dropping tables is
destructive; nothing reads or writes them.
