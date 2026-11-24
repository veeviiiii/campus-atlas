-- Campus Atlas: paper uploads on the site (build order step 3, piece A).
--
-- Run once in the Supabase SQL editor (or `supabase db push`). Safe to read top to bottom:
--   1. paper_uploads: one row per paper a student sends in
--   2. banned_users: accounts that may not upload
--   3. who may do what (row-level security)
--   4. limits: 5 uploads waiting and 10 a day per account
--   5. answer_upload(): the uploader answers a question from the maintainer
--   6. the private storage bucket for the photos, and who may put files in it
--
-- The browser talks to this database with the publishable (anon) key, which is public by design.
-- These rules are the only thing between a signed-in student and other students' uploads, so every
-- one of them has a test in web/tests/supabase/access.test.mjs. The maintainer's laptop uses the
-- service key (pipeline/fetch_uploads.py), which skips row-level security; it never leaves .env.

create schema if not exists private; -- helper functions; not exposed by the API (Settings > API > Exposed schemas)
grant usage on schema private to authenticated;

-- 1. uploads -------------------------------------------------------------------------------------

create table public.paper_uploads (
  id          uuid primary key default gen_random_uuid(),
  uploader    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id   text not null check (course_id ~ '^[a-z0-9-]{2,60}$'),           -- an id from catalog/davv.json
  semester    smallint not null check (semester between 1 and 10),
  subject     text not null check (char_length(btrim(subject)) between 2 and 120),
  exam_kind   text not null check (exam_kind in ('mst1', 'mst2', 'mst3', 'end', 'unknown')),
  session     text check (session ~ '^\d{4}-\d{2}$'),                           -- academic year, "2025-26"
  exam_month  text check (exam_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),              -- "2025-10"
  note        text check (char_length(note) <= 500),
  page_count  smallint not null check (page_count between 1 and 12),
  -- pending: waiting to be checked · held: the maintainer asked something (message) · published:
  -- on the site (pack_key) · rejected: not used (message says why)
  status      text not null default 'pending' check (status in ('pending', 'held', 'published', 'rejected')),
  message     text check (char_length(message) <= 500),   -- from the maintainer to the uploader
  answer      text check (char_length(answer) <= 500),    -- the uploader's answer to a held upload
  pack_key    text check (char_length(pack_key) <= 120),  -- "davv-sdsf/mtech-aids-dual-sem1" once published
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index paper_uploads_uploader on public.paper_uploads (uploader, created_at desc);
create index paper_uploads_status on public.paper_uploads (status, created_at);

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger paper_uploads_touch before update on public.paper_uploads
for each row execute function private.touch_updated_at();

-- 2. bans ----------------------------------------------------------------------------------------

create table public.banned_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  reason     text,
  created_at timestamptz not null default now()
);

-- Row-level security on, and no policy at all: only the service key can read or change this table.
alter table public.banned_users enable row level security;
revoke all on public.banned_users from anon, authenticated;
-- The service key (the maintainer's laptop) may do anything here. Newer Supabase projects no longer give
-- it new tables on their own, so it is granted by name.
grant all on public.banned_users to service_role;

create function private.is_banned() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.banned_users b where b.user_id = (select auth.uid()));
$$;
revoke all on function private.is_banned() from public;
grant execute on function private.is_banned() to authenticated;

-- 3. who may do what -----------------------------------------------------------------------------

alter table public.paper_uploads enable row level security;

-- Signed-out visitors get nothing. Signed-in students may read and delete rows (which rows: the
-- policies below) and may insert only the columns of the form. They cannot send id, uploader,
-- status, message, answer or pack_key at all: those take their defaults.
revoke all on public.paper_uploads from anon, authenticated;
grant all on public.paper_uploads to service_role; -- see the bans section
grant select, delete on public.paper_uploads to authenticated;
grant insert (course_id, semester, subject, exam_kind, session, exam_month, note, page_count)
  on public.paper_uploads to authenticated;

create policy "read your own uploads" on public.paper_uploads
for select to authenticated
using (uploader = (select auth.uid()));

create policy "add an upload as yourself" on public.paper_uploads
for insert to authenticated
with check (
  uploader = (select auth.uid())
  and status = 'pending'
  and message is null and answer is null and pack_key is null
  and not private.is_banned()
);

create policy "withdraw your own upload while it waits" on public.paper_uploads
for delete to authenticated
using (uploader = (select auth.uid()) and status = 'pending');

-- No update policy: a student changes nothing directly. See answer_upload() below.

-- 4. limits --------------------------------------------------------------------------------------

create function private.limit_uploads() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  waiting int;
  today   int;
begin
  select count(*) filter (where status = 'pending'),
         count(*) filter (where created_at > now() - interval '24 hours')
    into waiting, today
    from public.paper_uploads
   where uploader = new.uploader;
  if waiting >= 5 then
    raise exception 'You have 5 uploads waiting to be checked. Please wait for those first.' using errcode = 'P0001';
  end if;
  if today >= 10 then
    raise exception 'That is 10 uploads in a day. Please come back tomorrow.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger paper_uploads_limit before insert on public.paper_uploads
for each row execute function private.limit_uploads();

-- 5. answering a held upload ---------------------------------------------------------------------

-- "Which year was this paper?" The maintainer sets status = held and a message; the uploader
-- answers here. The function runs with the owner's rights but changes one column of the caller's
-- own held row, nothing else.
create function public.answer_upload(upload_id uuid, answer_text text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if char_length(btrim(coalesce(answer_text, ''))) not between 1 and 500 then
    raise exception 'Write an answer of up to 500 characters.' using errcode = 'P0001';
  end if;
  update public.paper_uploads
     set answer = btrim(answer_text)
   where id = upload_id and uploader = (select auth.uid()) and status = 'held';
  if not found then
    raise exception 'No upload of yours is waiting for an answer.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.answer_upload(uuid, text) from public, anon;
grant execute on function public.answer_upload(uuid, text) to authenticated;

-- 6. the photos ----------------------------------------------------------------------------------

-- Private bucket: uploaded photos can show names and roll numbers until the maintainer has blacked
-- them out, so nothing in it is ever public. 10 MB a file; photos and PDFs only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('paper-uploads', 'paper-uploads', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Files of an upload so far (counted with the owner's rights, so the count cannot be hidden from).
create function private.files_in_upload(folder text) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from storage.objects o where o.bucket_id = 'paper-uploads' and o.name like folder || '/%';
$$;
revoke all on function private.files_in_upload(text) from public;
grant execute on function private.files_in_upload(text) to authenticated;

-- A file is <your user id>/<upload id>/<nn>.<jpg|jpeg|png|webp|pdf>: in your own folder, for one of
-- your own uploads that is still waiting, at most 12 files per upload.
create policy "put pages into your own waiting upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'paper-uploads'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and storage.filename(name) ~ '^[0-9]{2}\.(jpg|jpeg|png|webp|pdf)$'
  and exists (
    select 1 from public.paper_uploads u
     where u.id::text = (storage.foldername(name))[2]
       and u.uploader = (select auth.uid())
       and u.status = 'pending'
  )
  and private.files_in_upload((storage.foldername(name))[1] || '/' || (storage.foldername(name))[2]) < 12
);

create policy "see your own pages" on storage.objects
for select to authenticated
using (bucket_id = 'paper-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "remove your own pages while the upload waits" on storage.objects
for delete to authenticated
using (
  bucket_id = 'paper-uploads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.paper_uploads u
     where u.id::text = (storage.foldername(name))[2]
       and u.uploader = (select auth.uid())
       and u.status = 'pending'
  )
);

-- No update policy on storage.objects: a page cannot be replaced in place (upsert is refused).
