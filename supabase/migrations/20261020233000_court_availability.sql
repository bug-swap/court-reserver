-- Open slots per court, written by a "slots" run for the settings page.
create table if not exists public.court_availability (
  target_date date primary key,
  courts jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.court_availability enable row level security;
revoke all on public.court_availability from anon, authenticated;
grant all on public.court_availability to service_role;

alter table public.court_runs drop constraint if exists court_runs_mode_check;
alter table public.court_runs add constraint court_runs_mode_check
  check (mode in ('book', 'keepalive', 'dry-run', 'slots'));
alter table public.court_runs drop constraint if exists court_runs_outcome_check;
alter table public.court_runs add constraint court_runs_outcome_check
  check (outcome in ('confirmed', 'already_booked', 'session_active', 'dry_run', 'slots_ready', 'failed'));
