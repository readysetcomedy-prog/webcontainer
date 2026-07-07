import { supabase } from './supabase';
import type { Project } from './projects';

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  group_name: string | null;
  owner: string | null;
  repo: string | null;
  branch: string | null;
  env_content: string;
  netlify_site_id: string | null;
  // May be absent until the 20260707_project_app_dir migration has run.
  app_dir?: string | null;
  local_path: string | null;
  paths_by_machine: Record<string, string> | null;
  updated_at: string;
}

function rowToProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    groupName: r.group_name ?? null,
    owner: r.owner,
    repo: r.repo,
    branch: r.branch,
    envContent: r.env_content,
    netlifySiteId: r.netlify_site_id ?? undefined,
    appDir: r.app_dir ?? null,
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

export async function findProjectByRepoBranch(
  owner: string,
  repo: string,
  branch: string,
): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('owner', owner)
    .eq('repo', repo)
    .eq('branch', branch)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToProject(data as ProjectRow) : null;
}

/**
 * Look up sibling projects that share an owner/repo, regardless of branch.
 * We use this to inherit fields (group, env, netlify site, local paths)
 * onto a freshly-opened branch so the user doesn't have to re-enter them.
 */
async function findSiblingByRepo(
  owner: string,
  repo: string,
): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('owner', owner)
    .eq('repo', repo)
    .order('updated_at', { ascending: false })
    .limit(1)
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
  const existing = await findProjectByRepoBranch(owner, repo, branch);
  if (existing) return existing;
  const sibling = await findSiblingByRepo(owner, repo);
  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      // The friendly name defaults to "<repo> @ <branch>" when there's
      // already a sibling — that's the case the user explicitly cared
      // about (multiple branches under the same parent name).
      name: sibling ? `${repo} @ ${branch}` : `${owner}/${repo}`,
      group_name: sibling?.groupName ?? null,
      owner,
      repo,
      branch,
      env_content: sibling?.envContent ?? '',
      netlify_site_id: sibling?.netlifySiteId ?? null,
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
      | 'groupName'
      | 'owner'
      | 'repo'
      | 'branch'
      | 'envContent'
      | 'netlifySiteId'
      | 'appDir'
      | 'localPath'
      | 'pathsByMachine'
    >
  >,
): Promise<Project> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.groupName !== undefined) payload.group_name = patch.groupName || null;
  if (patch.owner !== undefined) payload.owner = patch.owner || null;
  if (patch.repo !== undefined) payload.repo = patch.repo || null;
  if (patch.branch !== undefined) payload.branch = patch.branch || null;
  if (patch.envContent !== undefined) payload.env_content = patch.envContent;
  if (patch.netlifySiteId !== undefined)
    payload.netlify_site_id = patch.netlifySiteId || null;
  // appDir: '' is meaningful (explicit repo root) — only null clears, so
  // don't use the `|| null` coercion the other string fields use.
  if (patch.appDir !== undefined) payload.app_dir = patch.appDir;
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
 * Rename a group across every project that currently has it. Pass an
 * empty string to ungroup all of them.
 */
export async function renameGroup(
  userId: string,
  fromName: string,
  toName: string,
): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({
      group_name: toName.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('group_name', fromName);
  if (error) throw error;
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
  groupName?: string | null,
): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      name,
      group_name: groupName?.trim() || null,
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
