-- Group projects under a parent name (e.g. one "Medicgame" group with rows
-- for the main branch, a feature branch, and a local-only folder), and
-- allow multiple rows for the same (owner, repo) so different branches can
-- live as separate projects instead of constantly clobbering each other.
--
-- Run this in the Supabase SQL editor against the studio's project.

alter table public.projects
  add column if not exists group_name text;

-- Drop the old (user_id, owner, repo) unique so opening a second branch of
-- the same repo doesn't overwrite the first. The constraint name comes from
-- Postgres' default (table_columns_key); use the catalog if yours differs.
do $$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.projects'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%(user_id, owner, repo)%'
  loop
    execute format('alter table public.projects drop constraint %I', c);
  end loop;
end $$;

-- New uniqueness: one row per (user, owner, repo, branch). NULLs are
-- distinct in unique indexes by default, so multiple local-only projects
-- (with NULL owner/repo/branch) can still coexist for the same user.
create unique index if not exists projects_user_owner_repo_branch_key
  on public.projects (user_id, owner, repo, branch);
