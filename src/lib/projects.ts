export interface Project {
  id: string;
  name: string;
  owner: string;
  repo: string;
  branch: string;
  envContent: string;
  netlifySiteId?: string;
  updatedAt: number;
}

const KEY = 'projects';
const ACTIVE_KEY = 'activeProjectId';

export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Project[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]) {
  localStorage.setItem(KEY, JSON.stringify(projects));
}

export function getActiveProjectId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveProjectId(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

export function upsertProject(p: Project): Project[] {
  const all = loadProjects();
  const idx = all.findIndex((x) => x.id === p.id);
  if (idx >= 0) all[idx] = p;
  else all.unshift(p);
  saveProjects(all);
  return all;
}

export function removeProject(id: string): Project[] {
  const all = loadProjects().filter((x) => x.id !== id);
  saveProjects(all);
  if (getActiveProjectId() === id) setActiveProjectId(null);
  return all;
}

export function newProjectId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
