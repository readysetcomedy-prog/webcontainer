import { WebContainer } from '@webcontainer/api';
import type { FileSystemTree } from '@webcontainer/api';
import type { FileEntry } from '../types';
import { isBinaryPath } from './github';

let bootPromise: Promise<WebContainer> | null = null;

export function getContainer(): Promise<WebContainer> {
  if (!bootPromise) {
    bootPromise = WebContainer.boot({ coep: 'credentialless' });
  }
  return bootPromise;
}

export function filesToTree(files: FileEntry[]): FileSystemTree {
  const root: FileSystemTree = {};
  for (const { path, content } of files) {
    const parts = path.split('/').filter(Boolean);
    let node: FileSystemTree = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const existing = node[part];
      if (!existing || !('directory' in existing)) {
        node[part] = { directory: {} };
      }
      node = (node[part] as { directory: FileSystemTree }).directory;
    }
    const file = parts[parts.length - 1];
    node[file] = { file: { contents: content } };
  }
  return root;
}

export async function readAllFiles(
  container: WebContainer,
  dir = '/',
  acc: FileEntry[] = [],
  skip = new Set(['node_modules', '.git']),
): Promise<FileEntry[]> {
  const entries = await container.fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const full = dir === '/' ? `/${entry.name}` : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      await readAllFiles(container, full, acc, skip);
    } else {
      const rel = full.replace(/^\//, '');
      if (isBinaryPath(rel)) {
        const bytes = await container.fs.readFile(full);
        acc.push({ path: rel, content: bytes });
      } else {
        const content = await container.fs.readFile(full, 'utf-8');
        acc.push({ path: rel, content });
      }
    }
  }
  return acc;
}
