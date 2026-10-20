-- Mirror of EMS My Events, refreshed by each successful run. starts_at is Mountain local time.
create table if not exists public.court_reservations (
  ems_id bigint primary key,
  starts_at timestamp not null,
  location text not null,
  status text not null,
  synced_at timestamptz not null default now()
);
alter table public.court_reservations enable row level security;
revoke all on public.court_reservations from anon, authenticated;
grant all on public.court_reservations to service_role;
