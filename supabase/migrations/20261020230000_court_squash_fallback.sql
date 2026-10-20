-- What to book when squash is taken: nothing (default) or the first free badminton court.
alter table public.court_settings
  add column if not exists squash_fallback text not null default 'none'
  check (squash_fallback in ('none', 'badminton'));
