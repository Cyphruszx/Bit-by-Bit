-- BitbyBit §3: primary/sub-tags, recurring, savings, and period preferences.
-- Run after 202608210001_initial_finance_schema.sql.
-- RLS uses the user JWT (auth.uid()). Never query these tables with service_role from the app.

alter table public.uploaded_files
  add column if not exists file_kind text,
  add column if not exists notes text[] not null default '{}',
  add column if not exists transaction_count integer not null default 0;

alter table public.transactions
  add column if not exists tags text[] not null default '{}',
  add column if not exists tag_source text check (tag_source in ('rules', 'ai', 'user')),
  add column if not exists extracted_by text check (extracted_by in ('ai', 'ocr', 'parser')),
  add column if not exists source_filename text,
  add column if not exists client_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_user_client_key_key'
  ) then
    alter table public.transactions
      add constraint transactions_user_client_key_key unique (user_id, client_key);
  end if;
end $$;

create table if not exists public.user_preferences (
  user_id uuid primary key references public.users (id) on delete cascade,
  period jsonb not null default '{"kind":"all"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recurring_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  fingerprint text not null check (char_length(trim(fingerprint)) between 1 and 200),
  name text not null check (char_length(trim(name)) between 1 and 120),
  amount numeric(14, 2) not null,
  cadence text not null check (cadence in ('weekly', 'fortnightly', 'monthly', 'unknown')),
  next_date date,
  source text not null check (source in ('detected', 'custom')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create table if not exists public.recurring_ignored (
  user_id uuid not null references public.users (id) on delete cascade,
  fingerprint text not null check (char_length(trim(fingerprint)) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (user_id, fingerprint)
);

create table if not exists public.savings_pots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  detail text not null default '',
  saved numeric(14, 2) not null default 0,
  target numeric(14, 2) not null default 0,
  monthly_contribution numeric(14, 2) not null default 0,
  included_in_total boolean not null default true,
  sort_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.savings_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  snapshot_date date not null,
  total_saved numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  unique (user_id, snapshot_date)
);

create index if not exists recurring_items_user_id_idx on public.recurring_items (user_id);
create index if not exists savings_pots_user_id_idx on public.savings_pots (user_id);
create index if not exists savings_snapshots_user_id_idx on public.savings_snapshots (user_id, snapshot_date);

create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

create trigger recurring_items_set_updated_at
  before update on public.recurring_items
  for each row execute function public.set_updated_at();

create trigger savings_pots_set_updated_at
  before update on public.savings_pots
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name'));

  insert into public.user_preferences (user_id)
  values (new.id);

  insert into public.categories (user_id, name)
  select new.id, category_name
  from unnest(array[
    'Housing', 'Groceries', 'Dining', 'Transport', 'Shopping', 'Entertainment',
    'Utilities', 'Subscriptions', 'Health', 'Travel', 'Income', 'Other'
  ]) as category_name;

  return new;
end;
$$;

alter table public.user_preferences enable row level security;
alter table public.recurring_items enable row level security;
alter table public.recurring_ignored enable row level security;
alter table public.savings_pots enable row level security;
alter table public.savings_snapshots enable row level security;

create policy "Users manage own preferences" on public.user_preferences
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Users manage own recurring items" on public.recurring_items
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Users manage own recurring ignored" on public.recurring_ignored
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Users manage own savings pots" on public.savings_pots
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Users manage own savings snapshots" on public.savings_snapshots
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
