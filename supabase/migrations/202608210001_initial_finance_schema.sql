-- BitbyBit: foundational multi-tenant financial schema.
-- Run with the Supabase CLI or paste into the Supabase SQL editor.

create extension if not exists pgcrypto;

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  account_type text not null check (account_type in ('bank_account', 'credit_card', 'savings_account', 'cash', 'other')),
  institution_name text,
  currency char(3) not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.uploaded_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  filename text not null check (char_length(trim(filename)) between 1 and 255),
  file_type text not null check (file_type in ('csv', 'xlsx', 'pdf', 'image', 'other')),
  storage_path text,
  upload_status text not null default 'uploaded' check (upload_status in ('uploaded', 'failed')),
  processing_status text not null default 'pending' check (processing_status in ('pending', 'processing', 'completed', 'failed')),
  processing_error text,
  uploaded_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name),
  unique (id, user_id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  transaction_date date not null,
  description text not null check (char_length(trim(description)) between 1 and 500),
  merchant_name text,
  original_description text,
  amount numeric(14, 2) not null check (amount <> 0),
  transaction_type text not null check (transaction_type in ('income', 'expense', 'transfer', 'refund')),
  category_id uuid,
  subcategory text,
  currency char(3) not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  source_file_id uuid,
  ai_confidence numeric(4, 3) check (ai_confidence between 0 and 1),
  user_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, user_id) references public.accounts (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id),
  foreign key (source_file_id, user_id) references public.uploaded_files (id, user_id)
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  category_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  period text not null default 'monthly' check (period in ('weekly', 'monthly', 'yearly')),
  starts_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, user_id) references public.categories (id, user_id),
  unique (user_id, category_id, period, starts_on)
);

create index accounts_user_id_idx on public.accounts (user_id);
create index uploaded_files_user_id_idx on public.uploaded_files (user_id);
create index categories_user_id_idx on public.categories (user_id);
create index transactions_user_date_idx on public.transactions (user_id, transaction_date desc);
create index transactions_account_date_idx on public.transactions (account_id, transaction_date desc);
create index transactions_category_date_idx on public.transactions (category_id, transaction_date desc);
create index transactions_source_file_idx on public.transactions (source_file_id);
create index budgets_user_id_idx on public.budgets (user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at before update on public.users for each row execute function public.set_updated_at();
create trigger accounts_set_updated_at before update on public.accounts for each row execute function public.set_updated_at();
create trigger uploaded_files_set_updated_at before update on public.uploaded_files for each row execute function public.set_updated_at();
create trigger categories_set_updated_at before update on public.categories for each row execute function public.set_updated_at();
create trigger transactions_set_updated_at before update on public.transactions for each row execute function public.set_updated_at();
create trigger budgets_set_updated_at before update on public.budgets for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name'));

  insert into public.categories (user_id, name)
  select new.id, category_name
  from unnest(array[
    'Housing', 'Groceries', 'Dining', 'Transport', 'Shopping', 'Entertainment',
    'Utilities', 'Subscriptions', 'Health', 'Travel', 'Income', 'Other'
  ]) as category_name;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.users enable row level security;
alter table public.accounts enable row level security;
alter table public.uploaded_files enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;

create policy "Users can view their profile" on public.users for select using ((select auth.uid()) = id);
create policy "Users can update their profile" on public.users for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Users manage own accounts" on public.accounts for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users manage own uploaded files" on public.uploaded_files for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users manage own categories" on public.categories for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users manage own transactions" on public.transactions for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users manage own budgets" on public.budgets for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
