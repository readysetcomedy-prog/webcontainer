-- Saved GetTube analyses so the user can revisit results without re-spending
-- API credits. Stores the input description plus the full analysis JSON
-- (package + extracted + research).
create table if not exists public.gettube_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  description text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists gettube_analyses_user_created_idx
  on public.gettube_analyses (user_id, created_at desc);

alter table public.gettube_analyses enable row level security;

-- Per-command policies mirroring the projects table.
drop policy if exists gettube_analyses_own_select on public.gettube_analyses;
create policy gettube_analyses_own_select on public.gettube_analyses
  for select using (auth.uid() = user_id);

drop policy if exists gettube_analyses_own_insert on public.gettube_analyses;
create policy gettube_analyses_own_insert on public.gettube_analyses
  for insert with check (auth.uid() = user_id);

drop policy if exists gettube_analyses_own_delete on public.gettube_analyses;
create policy gettube_analyses_own_delete on public.gettube_analyses
  for delete using (auth.uid() = user_id);
