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

export async function findProjectByRepo(
  owner: string,
  repo: string,
): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('owner', owner)
    .eq('repo', repo)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToProject(data as ProjectRow) : null;
}

export async function findOrCreateProject(
  userId: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<Project> {
  const existing = await findProjectByRepo(owner, repo);
  if (existing) {
    if (existing.branch !== branch) {
      const { data, error } = await supabase
        .from('projects')
        .update({ branch, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      return rowToProject(data as ProjectRow);
    }
    return existing;
  }
  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      name: `${owner}/${repo}`,
      owner,
      repo,
      branch,
      env_content: '',
    })
    .select()
    .single();
  if (error) throw error;
  return rowToProject(data as ProjectRow);
}

export async function updateProjectFields(
  id: string,
  patch: Partial<
    Pick<Project, 'name' | 'branch' | 'envContent' | 'netlifySiteId'>
  >,
): Promise<Project> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.branch !== undefined) payload.branch = patch.branch;
  if (patch.envContent !== undefined) payload.env_content = patch.envContent;
  if (patch.netlifySiteId !== undefined)
    payload.netlify_site_id = patch.netlifySiteId || null;
  const { data, error } = await supabase
    .from('projects')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowToProject(data as ProjectRow);
}

export async function deleteProjectRemote(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}
