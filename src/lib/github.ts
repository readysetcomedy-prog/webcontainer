import type { FileEntry } from '../types';

export interface RepoRef {
  owner: string;
  repo: string;
  ref?: string;
}

export interface GhUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

export interface GhRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string; avatar_url: string };
  private: boolean;
  default_branch: string;
  updated_at: string;
  description: string | null;
}

export interface GhBranch {
  name: string;
  protected: boolean;
  commit: { sha: string };
}

export function parseRepoInput(input: string): RepoRef {
  let s = input.trim();
  if (!s) throw new Error('Enter a GitHub URL.');

  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^git@github\.com:/i, '');
  s = s.replace(/^github\.com\//i, '');
  s = s.replace(/[?#].*$/, '');
  s = s.replace(/\/$/, '');
  s = s.replace(/\.git$/i, '');

  let ref: string | undefined;
  const atIdx = s.indexOf('@');
  const firstSlash = s.indexOf('/');
  if (atIdx >= 0 && firstSlash >= 0 && atIdx > firstSlash) {
    ref = s.slice(atIdx + 1);
    s = s.slice(0, atIdx);
  }

  const treeMatch = s.match(/^([^\/]+)\/([^\/]+)\/tree\/(.+)$/);
  if (treeMatch) {
    return { owner: treeMatch[1], repo: treeMatch[2], ref: ref ?? treeMatch[3] };
  }

  const simpleMatch = s.match(/^([^\/\s]+)\/([^\/\s]+)$/);
  if (simpleMatch) {
    return { owner: simpleMatch[1], repo: simpleMatch[2], ref };
  }

  throw new Error(
    `That doesn't look like a GitHub URL. Try something like https://github.com/owner/repo`,
  );
}

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}

async function ghFetch(url: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { headers });
}

async function ghJson<T>(url: string, token?: string): Promise<T> {
  const res = await ghFetch(url, token);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        token
          ? `GitHub returned 404. The repo or branch does not exist, or your token does not have access to it.`
          : `GitHub returned 404. If this is a private repo, connect your GitHub account first. Otherwise check the owner, repo name, and branch.`,
      );
    }
    if (res.status === 401) {
      throw new Error(
        `GitHub rejected the token (401). Sign out and reconnect with a fresh token.`,
      );
    }
    if (res.status === 403) {
      const body = await res.text();
      if (body.includes('rate limit')) {
        throw new Error(
          `GitHub rate limit hit. Connect your GitHub account to raise your limit.`,
        );
      }
      throw new Error(`GitHub 403: ${body}`);
    }
    throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export function getStoredToken(): string {
  return localStorage.getItem('github_token') ?? '';
}

export function setStoredToken(token: string) {
  if (token) localStorage.setItem('github_token', token);
  else localStorage.removeItem('github_token');
}

export async function getUser(token: string): Promise<GhUser> {
  return ghJson<GhUser>('https://api.github.com/user', token);
}

function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

export async function listRepos(token: string, maxPages = 3): Promise<GhRepo[]> {
  const repos: GhRepo[] = [];
  let url: string | null =
    'https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member';
  let page = 0;
  while (url && page < maxPages) {
    const res = await ghFetch(url, token);
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
    const batch = (await res.json()) as GhRepo[];
    repos.push(...batch);
    url = parseNextLink(res.headers.get('Link'));
    page++;
  }
  return repos;
}

export async function listBranches(
  token: string,
  owner: string,
  repo: string,
  maxPages = 3,
): Promise<GhBranch[]> {
  const branches: GhBranch[] = [];
  let url: string | null = `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`;
  let page = 0;
  while (url && page < maxPages) {
    const res = await ghFetch(url, token);
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
    const batch = (await res.json()) as GhBranch[];
    branches.push(...batch);
    url = parseNextLink(res.headers.get('Link'));
    page++;
  }
  return branches;
}

function decodeBase64ToUtf8(b64: string): string {
  const clean = b64.replace(/\s/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

export async function fetchRepoFiles(
  ref: RepoRef,
  token?: string,
  onProgress?: (done: number, total: number) => void,
): Promise<FileEntry[]> {
  const { owner, repo } = ref;
  let branch = ref.ref;
  if (!branch) {
    const info = await ghJson<{ default_branch: string }>(
      `https://api.github.com/repos/${owner}/${repo}`,
      token,
    );
    branch = info.default_branch;
  }
  const tree = await ghJson<{ tree: TreeEntry[]; truncated: boolean }>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    token,
  );
  if (tree.truncated) {
    console.warn('GitHub tree is truncated; some files may be missing.');
  }
  const blobs = tree.tree.filter((e) => e.type === 'blob');
  const files: FileEntry[] = [];
  let done = 0;
  const concurrency = 8;
  let index = 0;
  async function worker() {
    while (index < blobs.length) {
      const i = index++;
      const entry = blobs[i];
      let content: string;
      if (token) {
        const blob = await ghJson<{ content: string; encoding: string }>(
          `https://api.github.com/repos/${owner}/${repo}/git/blobs/${entry.sha}`,
          token,
        );
        content =
          blob.encoding === 'base64'
            ? decodeBase64ToUtf8(blob.content)
            : blob.content;
      } else {
        const raw = await fetch(
          `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${entry.path}`,
        );
        if (!raw.ok) {
          throw new Error(`Failed to fetch ${entry.path}: ${raw.status}`);
        }
        content = await raw.text();
      }
      files.push({ path: entry.path, content });
      done++;
      onProgress?.(done, blobs.length);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, blobs.length) }, worker),
  );
  return files;
}
