import type { FileEntry } from '../types';

export interface RepoRef {
  owner: string;
  repo: string;
  ref?: string;
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

async function ghJson<T>(url: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        token
          ? `GitHub returned 404. The repo or branch does not exist, or your token does not have access to it.`
          : `GitHub returned 404. If this is a private repo, click "Show advanced options" and paste a GitHub personal access token. Otherwise check the owner, repo name, and branch.`,
      );
    }
    if (res.status === 401) {
      throw new Error(
        `GitHub rejected the token (401). Generate a new one at https://github.com/settings/tokens with access to this repo.`,
      );
    }
    if (res.status === 403) {
      const body = await res.text();
      if (body.includes('rate limit')) {
        throw new Error(
          `GitHub rate limit hit. Add a personal access token under "Show advanced options" to raise your limit.`,
        );
      }
      throw new Error(`GitHub 403: ${body}`);
    }
    throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
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
      const raw = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${entry.path}`,
      );
      if (!raw.ok) {
        throw new Error(`Failed to fetch ${entry.path}: ${raw.status}`);
      }
      const content = await raw.text();
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
