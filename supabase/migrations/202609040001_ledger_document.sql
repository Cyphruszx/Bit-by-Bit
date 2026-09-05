-- BitbyBit: one ledger document per person.
--
-- The browser already holds the whole ledger as a single object — movements, the imports
-- that carried them, and what the person said about institutions, accounts, payers and
-- individual movements. This stores that same object and does not look inside it, so the
-- reader can keep changing shape without a migration each time. It has changed four times
-- in the last week alone.
--
-- Row-level security is the whole protection here: one row per person, reachable only by
-- that person. The service-role key bypasses it and must never reach the browser.

create table if not exists public.ledgers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  document   jsonb not null,
  -- Bumped on every write. A push carries the revision it read, so two devices saving at
  -- once are caught rather than one quietly overwriting the other.
  revision   bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.ledgers enable row level security;

drop policy if exists "read own ledger" on public.ledgers;
create policy "read own ledger" on public.ledgers
  for select using (auth.uid() = user_id);

drop policy if exists "create own ledger" on public.ledgers;
create policy "create own ledger" on public.ledgers
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own ledger" on public.ledgers;
create policy "update own ledger" on public.ledgers
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own ledger" on public.ledgers;
create policy "delete own ledger" on public.ledgers
  for delete using (auth.uid() = user_id);

-- The revision and the timestamp are the server's to set, not the client's: a client that
-- sent its own could stall the revision and defeat the concurrency check above.
create or replace function public.touch_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.revision := coalesce(old.revision, 0) + 1;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ledgers_touch on public.ledgers;
create trigger ledgers_touch
  before insert or update on public.ledgers
  for each row execute function public.touch_ledger();
