import type { FileEntry } from '../types';

export interface RepoRef {
  owner: string;
  repo: string;
  ref?: string;
}

export function parseRepoInput(input: string): RepoRef {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(
    /github\.com[\/:]([^\/]+)\/([^\/#?]+?)(?:\.git)?(?:\/tree\/([^\/?#]+))?\/?$/i,
  );
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2], ref: urlMatch[3] };
  }
  const shortMatch = trimmed.match(/^([^\/\s]+)\/([^\/\s#@]+?)(?:@([^\s]+))?$/);
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2], ref: shortMatch[3] };
  }
  throw new Error(`Cannot parse GitHub reference: ${input}`);
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
