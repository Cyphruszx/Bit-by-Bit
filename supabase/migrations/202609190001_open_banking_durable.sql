-- BitbyBit: durable Open Banking connections, end-user links, auth sessions,
-- and webhook receipts. Server jobs (Connect complete, Fiskil webhooks, daily
-- poll) run on Vercel without a shared process Map, so these rows are what
-- lets first sync and later syncs find the same person.
--
-- The browser never talks to these tables. Access is service-role only
-- (RLS on, no policies for anon/authenticated). public.ledgers stays the
-- document the signed-in UI reads; Open Banking upserts that same row.

create table if not exists public.open_banking_end_users (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  end_user_id text not null unique,
  email       text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.open_banking_connections (
  id                       text primary key,
  user_id                  uuid not null references auth.users (id) on delete cascade,
  end_user_id              text not null,
  session_id               text not null,
  consent_id               text,
  status                   text not null,
  created_at               timestamptz not null,
  revoked_at               timestamptz,
  last_synced_at           timestamptz,
  last_cursor              text,
  first_sync_completed_at  timestamptz,
  sync_stopped_reason      text
);

create index if not exists open_banking_connections_user_id_idx
  on public.open_banking_connections (user_id);

create index if not exists open_banking_connections_end_user_id_idx
  on public.open_banking_connections (end_user_id);

create index if not exists open_banking_connections_consent_id_idx
  on public.open_banking_connections (consent_id);

create index if not exists open_banking_connections_active_idx
  on public.open_banking_connections (status)
  where status = 'active';

create table if not exists public.open_banking_auth_sessions (
  session_id    text primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  end_user_id   text not null,
  redirect_uri  text not null,
  cancel_uri    text not null,
  created_at    timestamptz not null,
  expires_at    bigint,
  fiskil_id     text,
  auth_url      text,
  connection_id text
);

create index if not exists open_banking_auth_sessions_user_id_idx
  on public.open_banking_auth_sessions (user_id);

create table if not exists public.open_banking_webhook_receipts (
  message_id  text primary key,
  received_at timestamptz not null,
  event       text not null
);

alter table public.open_banking_end_users enable row level security;
alter table public.open_banking_connections enable row level security;
alter table public.open_banking_auth_sessions enable row level security;
alter table public.open_banking_webhook_receipts enable row level security;

-- No policies for anon/authenticated: only the service role (which bypasses
-- RLS) may read or write. Do not grant a client path to these tables.
