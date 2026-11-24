-- Campus Atlas: keep the free project awake. Run once after 0001_uploads.sql, in the same way.
--
-- A free Supabase project is paused after a week with too little database activity, and /upload/
-- then stops working until someone restores it from the dashboard (the papers on the site are not
-- affected). Supabase counts database activity, not just requests, so every day
-- .github/workflows/keep-supabase-awake.yml calls keep_alive(): one small write, to one row that
-- nobody can read or change any other way. Calling it does nothing else, so it may be public.

create table public.heartbeat (
  id        smallint primary key default 1 check (id = 1), -- one row, ever
  pinged_at timestamptz not null default now()
);

-- Row-level security on, and no policy at all: only keep_alive() and the service key touch it.
alter table public.heartbeat enable row level security;
revoke all on public.heartbeat from anon, authenticated;

create function public.keep_alive() returns void
language sql security definer set search_path = '' as $$
  insert into public.heartbeat (id, pinged_at) values (1, now())
  on conflict (id) do update set pinged_at = excluded.pinged_at;
$$;
revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;
