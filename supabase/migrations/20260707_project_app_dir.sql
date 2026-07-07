-- Per-project target directory ("app dir") for Run/Deploy.
-- null  = unset → fall back to .getxsite.json, then auto-detection
-- ''    = explicitly the repo root
-- 'app' = run/deploy inside the app/ subfolder
alter table public.projects
  add column if not exists app_dir text;

-- Per-target env vars: { "<dir>": "KEY=value\n..." }. Root env stays in
-- env_content. A repo with a Vite site at root and an Expo app in app/
-- needs different vars per target.
alter table public.projects
  add column if not exists env_by_dir jsonb;
