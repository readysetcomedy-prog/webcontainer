import { WebContainer } from '@webcontainer/api';
import type { FileSystemTree } from '@webcontainer/api';
import type { FileEntry } from '../types';
import { isBinaryPath } from './github';

let bootPromise: Promise<WebContainer> | null = null;

const BRIDGE_SCRIPT = `
(function () {
  if (window.__studioBridge) return;
  window.__studioBridge = true;
  function abs(url) {
    try {
      return new URL(String(url), location.href).href;
    } catch (_) {
      return null;
    }
  }
  function send(url) {
    var resolved = abs(url);
    if (!resolved) return;
    try {
      window.parent.postMessage({ type: 'studio:open', url: resolved }, '*');
    } catch (_) {}
  }
  window.open = function (url) {
    if (url) send(url);
    return null;
  };
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var a = t.closest('a[target="_blank"]');
    if (a && a.href) {
      e.preventDefault();
      e.stopPropagation();
      send(a.href);
    }
  }, true);
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f && f.target === '_blank' && f.action) {
      e.preventDefault();
      send(f.action);
    }
  }, true);
})();
`;

export function getContainer(): Promise<WebContainer> {
  if (!bootPromise) {
    bootPromise = (async () => {
      const c = await WebContainer.boot({ coep: 'credentialless' });
      try {
        await c.setPreviewScript(BRIDGE_SCRIPT);
      } catch (e) {
        console.warn('Failed to install preview bridge script:', e);
      }
      return c;
    })();
  }
  return bootPromise;
}

export function filesToTree(files: FileEntry[]): FileSystemTree {
  const root: FileSystemTree = {};
  for (const { path, content } of files) {
    // Tolerate Windows-style paths from older agents — WebContainer is
    // unix, so a literal "app\index.tsx" filename wouldn't match what
    // tools (Vite/Expo/etc.) look for.
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
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

// WebContainer.mount() MERGES into the existing filesystem — it never removes
// files that aren't in the new tree. Without a wipe, the previous project's
// files survive a project switch and leak into the next one. Nastiest case: a
// repo whose Expo app lives in a folder named `app/`, followed by an Expo Router
// project whose *routes* folder is also `app/` — the old nested project
// (package.json, node_modules, its own routes) lands inside the new project's
// routes dir, expo-router tries to bundle all of it, and Metro answers every
// bundle request with a 500. A project that builds fine on its own then
// "mysteriously" fails only in the preview.
//
// Root node_modules is kept: its lifecycle (wipe on project change, reuse on a
// same-project re-pull) is owned by the install logic in App.
export async function clearProjectTree(
  container: WebContainer,
  keep = new Set(['node_modules']),
): Promise<void> {
  const entries = await container.fs.readdir('/', { withFileTypes: true });
  for (const entry of entries) {
    if (keep.has(entry.name)) continue;
    try {
      await container.fs.rm(`/${entry.name}`, { recursive: true, force: true });
    } catch {
      // already gone / not removable — mount() will overwrite what it can
    }
  }
}
