-- Per-project target directory ("app dir") for Run/Deploy.
-- null  = unset → fall back to .getxsite.json, then auto-detection
-- ''    = explicitly the repo root
-- 'app' = run/deploy inside the app/ subfolder
alter table public.projects
  add column if not exists app_dir text;
