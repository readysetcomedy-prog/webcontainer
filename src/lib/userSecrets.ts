import { supabase } from './supabase';

export interface UserSecrets {
  githubToken: string;
  netlifyToken: string;
  lastActiveProjectId: string | null;
}

interface UserSecretsRow {
  user_id: string;
  github_token: string | null;
  netlify_token: string | null;
  last_active_project_id: string | null;
  updated_at: string;
}

const EMPTY: UserSecrets = {
  githubToken: '',
  netlifyToken: '',
  lastActiveProjectId: null,
};

export async function fetchUserSecrets(): Promise<UserSecrets> {
  const { data, error } = await supabase
    .from('user_secrets')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) return EMPTY;
  const row = data as UserSecretsRow;
  return {
    githubToken: row.github_token ?? '',
    netlifyToken: row.netlify_token ?? '',
    lastActiveProjectId: row.last_active_project_id,
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
  const { error } = await supabase
    .from('user_secrets')
    .upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
}
