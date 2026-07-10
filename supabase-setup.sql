-- ============================================================
-- Book Club Picker — Supabase setup (run once in SQL Editor)
-- Implements the v1 spec: allowlist auth, anonymous voting,
-- read flags, book lifecycle, and strict RLS.
-- ============================================================

-- ---------- 1. Tables ----------

create table public.members (
  email      text primary key,
  created_at timestamptz not null default now()
);

create table public.books (
  id          uuid primary key default gen_random_uuid(),
  gb_volume_id text not null unique,           -- Google Books volume ID => duplicates impossible
  title       text not null,
  author      text,
  cover_url   text,
  subjects    text[],
  blurb       text,                            -- anonymous pitch, 1-2 sentences
  status      text not null default 'pool'
              check (status in ('pool','current','finished')),
  added_by    uuid not null default auth.uid(),-- stored, never exposed (see column grants)
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);

-- Only one Current Read at a time, enforced by the DB.
create unique index only_one_current_book
  on public.books (status) where status = 'current';

create table public.votes (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id    uuid not null references public.books (id) on delete cascade,
  value      smallint not null check (value in (1, -1)),
  created_at timestamptz not null default now(),
  primary key (user_id, book_id)               -- one vote per user per book
);

create table public.reads (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id    uuid not null references public.books (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

-- ---------- 2. Allowlist helpers ----------
-- SECURITY DEFINER so they can read `members` even though clients cannot.

create or replace function public.is_member()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.member_count()
returns integer
language sql stable security definer
set search_path = public
as $$
  select count(*)::int from public.members;
$$;

revoke execute on function public.is_member(), public.member_count() from public, anon;
grant  execute on function public.is_member(), public.member_count() to authenticated;

-- ---------- 3. Vote/read tallies without exposing who voted ----------
-- Security-definer view: members see aggregate counts only.
-- (Raw `votes`/`reads` rows are readable only by their owner — see RLS below.)

create or replace view public.book_stats as
select
  b.id as book_id,
  (select count(*) from public.votes v where v.book_id = b.id and v.value =  1) as upvotes,
  (select count(*) from public.votes v where v.book_id = b.id and v.value = -1) as downvotes,
  (select count(*) from public.reads r where r.book_id = b.id)                  as read_count
from public.books b
where public.is_member();   -- returns zero rows for non-members

revoke all on public.book_stats from public, anon;
grant select on public.book_stats to authenticated;

-- ---------- 4. Row-Level Security ----------

alter table public.members enable row level security;  -- no policies => clients get nothing
alter table public.books   enable row level security;
alter table public.votes   enable row level security;
alter table public.reads   enable row level security;

-- books: members read everything; insert into pool; update status (Accept / mark finished).
create policy books_select on public.books
  for select to authenticated
  using (public.is_member());

create policy books_insert on public.books
  for insert to authenticated
  with check (public.is_member() and status = 'pool' and added_by = auth.uid());

create policy books_update on public.books
  for update to authenticated
  using (public.is_member())
  with check (public.is_member());
-- No delete policy: deletes are impossible in v1.

-- votes: users touch only their own rows.
create policy votes_select on public.votes
  for select to authenticated using (user_id = auth.uid() and public.is_member());
create policy votes_insert on public.votes
  for insert to authenticated with check (user_id = auth.uid() and public.is_member());
create policy votes_update on public.votes
  for update to authenticated
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());
create policy votes_delete on public.votes
  for delete to authenticated using (user_id = auth.uid() and public.is_member());

-- reads: same as votes.
create policy reads_select on public.reads
  for select to authenticated using (user_id = auth.uid() and public.is_member());
create policy reads_insert on public.reads
  for insert to authenticated with check (user_id = auth.uid() and public.is_member());
create policy reads_delete on public.reads
  for delete to authenticated using (user_id = auth.uid() and public.is_member());

-- ---------- 5. Column-level grants ----------
-- `added_by` is never selectable/writable by clients, per spec §4.

revoke all on public.members from public, anon, authenticated;
revoke all on public.books   from public, anon, authenticated;
revoke all on public.votes   from public, anon, authenticated;
revoke all on public.reads   from public, anon, authenticated;

grant select (id, gb_volume_id, title, author, cover_url, subjects, blurb,
              status, created_at, finished_at)
  on public.books to authenticated;
grant insert (gb_volume_id, title, author, cover_url, subjects, blurb)
  on public.books to authenticated;   -- status & added_by come from defaults
grant update (status, finished_at)
  on public.books to authenticated;

grant select, insert, update, delete on public.votes to authenticated;
grant select, insert, delete         on public.reads to authenticated;

-- ---------- 6. Add your members (EDIT THESE) ----------

insert into public.members (email) values
  ('marcruz385@gmail.com')
  -- ,('member2@example.com')
  -- ,('member3@example.com')
;
