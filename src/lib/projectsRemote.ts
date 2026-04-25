import { supabase } from './supabase';
import type { Project } from './projects';

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  owner: string | null;
  repo: string | null;
  branch: string | null;
  env_content: string;
  netlify_site_id: string | null;
  local_path: string | null;
  paths_by_machine: Record<string, string> | null;
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
    localPath: r.local_path ?? undefined,
    pathsByMachine: r.paths_by_machine ?? {},
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
    Pick<
      Project,
      | 'name'
      | 'owner'
      | 'repo'
      | 'branch'
      | 'envContent'
      | 'netlifySiteId'
      | 'localPath'
      | 'pathsByMachine'
    >
  >,
): Promise<Project> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.owner !== undefined) payload.owner = patch.owner || null;
  if (patch.repo !== undefined) payload.repo = patch.repo || null;
  if (patch.branch !== undefined) payload.branch = patch.branch || null;
  if (patch.envContent !== undefined) payload.env_content = patch.envContent;
  if (patch.netlifySiteId !== undefined)
    payload.netlify_site_id = patch.netlifySiteId || null;
  if (patch.localPath !== undefined)
    payload.local_path = patch.localPath || null;
  if (patch.pathsByMachine !== undefined)
    payload.paths_by_machine = patch.pathsByMachine;
  const { data, error } = await supabase
    .from('projects')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowToProject(data as ProjectRow);
}

/**
 * Create a project that's only backed by a folder on disk — no GitHub repo
 * yet. The caller passes the agent's host so the folder is recorded against
 * this specific machine; opening the same project on another laptop will
 * prompt for that machine's path.
 */
export async function createLocalProject(
  userId: string,
  name: string,
  machineHost: string,
  path: string,
): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      name,
      owner: null,
      repo: null,
      branch: null,
      env_content: '',
      local_path: path,
      paths_by_machine: { [machineHost]: path },
    })
    .select()
    .single();
  if (error) throw error;
  return rowToProject(data as ProjectRow);
}

export async function deleteProjectRemote(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}
