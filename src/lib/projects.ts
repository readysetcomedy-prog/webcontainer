export interface Project {
  id: string;
  name: string;
  // GitHub coordinates: present for projects that originated from a repo
  // OR have been linked to one for push/pull. Null for local-only projects
  // that have never been wired up to a remote.
  owner: string | null;
  repo: string | null;
  branch: string | null;
  envContent: string;
  netlifySiteId?: string;
  localPath?: string;
  pathsByMachine: Record<string, string>;
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
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  (crypto as Crypto).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return (
    Array.from(b.subarray(0, 4)).map(h).join('') + '-' +
    Array.from(b.subarray(4, 6)).map(h).join('') + '-' +
    Array.from(b.subarray(6, 8)).map(h).join('') + '-' +
    Array.from(b.subarray(8, 10)).map(h).join('') + '-' +
    Array.from(b.subarray(10, 16)).map(h).join('')
  );
}
