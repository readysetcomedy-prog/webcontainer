import { supabase } from './supabase';
import type { Project } from './projects';

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  owner: string;
  repo: string;
  branch: string;
  env_content: string;
  netlify_site_id: string | null;
  updated_at: string;
}

function rowToProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    owner: r.owner,
    repo: r.repo,
    branch: r.branch,
    envContent: r.env_content,
    netlifySiteId: r.netlify_site_id ?? undefined,
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

export async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as ProjectRow[]).map(rowToProject);
}

export async function upsertProjectRemote(p: Project, userId: string): Promise<Project> {
  const payload = {
    id: p.id,
    user_id: userId,
    name: p.name,
    owner: p.owner,
    repo: p.repo,
    branch: p.branch,
    env_content: p.envContent,
    netlify_site_id: p.netlifySiteId ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('projects')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return rowToProject(data as ProjectRow);
}

export async function deleteProjectRemote(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}
