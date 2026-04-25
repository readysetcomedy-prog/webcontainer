-- Allow projects that are backed by a local folder only (no GitHub repo).
-- Run this in the Supabase SQL editor against the studio's project.

alter table public.projects
  alter column owner drop not null,
  alter column repo  drop not null,
  alter column branch drop not null;

-- The (user_id, owner, repo) unique constraint already treats NULLs as
-- distinct in Postgres, so multiple local-only projects per user are
-- allowed without further changes.
