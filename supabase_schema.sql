-- Run in the SQL Editor of the Supabase project used by canvas-emailer.
-- These court-specific names do not alter Canvas tables or its Storage bucket.

create table if not exists public.court_settings (
  id integer primary key default 1 check (id = 1),
  sport text not null default 'squash' check (sport in ('squash', 'badminton')),
  start_time text not null default '18:00' check (start_time ~ '^(0[0-9]|1[0-9]|2[0-2]):[0-5][0-9]$'),
  badminton_room text not null default 'any' check (badminton_room in ('any', '3A', '3B', '3C')),
  updated_at timestamptz not null default now()
);

create table if not exists public.court_session (
  id integer primary key default 1 check (id = 1),
  encrypted_state text not null,
  refreshed_at timestamptz not null default now()
);

create table if not exists public.court_bookings (
  target_date date primary key,
  sport text not null check (sport in ('squash', 'badminton')),
  start_time text not null,
  badminton_room text not null,
  confirmation text,
  booked_at timestamptz not null default now()
);

create table if not exists public.court_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  mode text not null check (mode in ('book', 'keepalive', 'dry-run')),
  target_date date,
  outcome text not null check (outcome in ('confirmed', 'already_booked', 'session_active', 'dry_run', 'failed')),
  error text
);

create index if not exists court_runs_started_at_idx on public.court_runs (started_at desc);

alter table public.court_settings enable row level security;
alter table public.court_session enable row level security;
alter table public.court_bookings enable row level security;
alter table public.court_runs enable row level security;

-- Only the server-side secret key may access these tables. No browser policies.
revoke all on public.court_settings from anon, authenticated;
revoke all on public.court_session from anon, authenticated;
revoke all on public.court_bookings from anon, authenticated;
revoke all on public.court_runs from anon, authenticated;
revoke all on sequence public.court_runs_id_seq from anon, authenticated;
grant all on public.court_settings, public.court_session, public.court_bookings, public.court_runs to service_role;
grant usage, select on sequence public.court_runs_id_seq to service_role;

insert into public.court_settings (id, sport, start_time, badminton_room)
values (1, 'squash', '18:00', 'any')
on conflict (id) do nothing;
