import { supabase } from './supabase';

export interface ModelPreset {
  id: string;
  label: string;
  cli: string;
  args: string[];
}

export interface UserSecrets {
  githubToken: string;
  netlifyToken: string;
  lastActiveProjectId: string | null;
  models: ModelPreset[];
}

interface UserSecretsRow {
  user_id: string;
  github_token: string | null;
  netlify_token: string | null;
  last_active_project_id: string | null;
  models: ModelPreset[] | null;
  updated_at: string;
}

const DEFAULT_MODELS: ModelPreset[] = [
  {
    id: 'seed_claude',
    label: 'Claude (default)',
    cli: 'claude',
    args: ['-p', '--output-format', 'text'],
  },
  {
    id: 'seed_codex',
    label: 'Codex (default)',
    cli: 'codex',
    args: ['exec', '--quiet'],
  },
];

const EMPTY: UserSecrets = {
  githubToken: '',
  netlifyToken: '',
  lastActiveProjectId: null,
  models: DEFAULT_MODELS,
};

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newModelId(): string {
  return newId();
}

export async function fetchUserSecrets(): Promise<UserSecrets> {
  const { data, error } = await supabase
    .from('user_secrets')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) return EMPTY;
  const row = data as UserSecretsRow;
  const models =
    row.models && row.models.length > 0 ? row.models : DEFAULT_MODELS;
  return {
    githubToken: row.github_token ?? '',
    netlifyToken: row.netlify_token ?? '',
    lastActiveProjectId: row.last_active_project_id,
    models,
  };
}

export async function saveUserSecrets(
  userId: string,
  patch: Partial<UserSecrets>,
): Promise<void> {
  const payload: Record<string, unknown> = {
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  if (patch.githubToken !== undefined) payload.github_token = patch.githubToken || null;
  if (patch.netlifyToken !== undefined) payload.netlify_token = patch.netlifyToken || null;
  if (patch.lastActiveProjectId !== undefined)
    payload.last_active_project_id = patch.lastActiveProjectId;
  if (patch.models !== undefined) payload.models = patch.models;
  const { error } = await supabase
    .from('user_secrets')
    .upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
}
