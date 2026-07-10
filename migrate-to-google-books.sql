-- Migration: switch book identity from Open Library to Google Books.
-- Run once in the Supabase SQL Editor (only needed on a DB created
-- with the old supabase-setup.sql — fresh installs already have this).

alter table public.books rename column ol_work_id to gb_volume_id;

-- Note: any books added while using Open Library keep their old OL IDs.
-- They still display and vote fine, but duplicate detection won't match
-- them against Google Books results. If the pool is just test data,
-- simplest is to clear it:
--   truncate public.votes, public.reads;
--   delete from public.books;
