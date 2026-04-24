#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import spawn from 'cross-spawn';
import { hostname, homedir, platform } from 'node:os';
import { argv, env, exit } from 'node:process';
import { promises as fs, watch as fsWatch } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';

const SUPABASE_URL =
  env.GETXSITE_SUPABASE_URL || 'https://swbrewprhjmujomqtdpc.supabase.co';
const SUPABASE_ANON_KEY =
  env.GETXSITE_SUPABASE_KEY || 'sb_publishable_oXaXUakEgFSXeHkBVCnEhg_neTbeSHw';

function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return fallback;
}

const userId = arg('user-id', env.GETXSITE_USER_ID);
if (!userId) {
  console.error(
    'Missing user id. Set GETXSITE_USER_ID or pass --user-id <uuid>.\n' +
      'You can find your id at https://getxsite.com/app under "Local agent".',
  );
  exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const channelName = `agent-${userId}`;
const channel = supabase.channel(channelName, {
  config: { broadcast: { self: false } },
});

const procs = new Map();
const watchers = new Map();
const host = hostname();
const home = homedir();
const plat = platform();
const version = '0.3.0';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  '.cache',
  '.expo',
  'dist',
  'build',
  'out',
  '.DS_Store',
]);

function send(type, payload) {
  channel.send({
    type: 'broadcast',
    event: 'agent',
    payload: { type, ...payload },
  });
}

function announce() {
  send('hello', { host, home, platform: plat, version, ts: Date.now() });
}

async function safeReply(id, op, fn) {
  try {
    const data = await fn();
    send(`${op}_ok`, { id, data });
  } catch (e) {
    send(`${op}_err`, { id, error: String(e?.message ?? e) });
  }
}

function exec(req) {
  const { id, command, args = [], cwd } = req;
  if (!id || !command) return;
  console.log(`[exec ${id}] ${command} ${args.join(' ')}${cwd ? ` (cwd=${cwd})` : ''}`);
  let child;
  try {
    child = spawn(command, args, {
      cwd: cwd || env.HOME || env.USERPROFILE,
      env: { ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    send('exit', { id, code: -1, error: String(e?.message ?? e) });
    return;
  }
  procs.set(id, child);
  child.stdout.on('data', (d) =>
    send('output', { id, stream: 'stdout', data: d.toString('utf-8') }),
  );
  child.stderr.on('data', (d) =>
    send('output', { id, stream: 'stderr', data: d.toString('utf-8') }),
  );
  child.on('error', (err) => {
    send('exit', { id, code: -1, error: err.message });
    procs.delete(id);
  });
  child.on('exit', (code) => {
    send('exit', { id, code });
    procs.delete(id);
  });
}

function killProc(req) {
  const child = procs.get(req.id);
  if (child) child.kill('SIGTERM');
}

async function listDir({ path, recursive }) {
  const root = resolve(path);
  if (recursive) {
    const out = [];
    await walk(root, root, out);
    return { entries: out };
  }
  const ents = await fs.readdir(root, { withFileTypes: true });
  return {
    entries: ents
      .filter((e) => !SKIP_DIRS.has(e.name))
      .map((e) => ({
        name: e.name,
        path: relative(root, join(root, e.name)),
        isDir: e.isDirectory(),
      })),
  };
}

async function walk(root, dir, out) {
  let ents;
  try {
    ents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(root, full, out);
    } else if (e.isFile()) {
      out.push({ path: relative(root, full), isDir: false });
    }
  }
}

async function readFile({ path }) {
  const buf = await fs.readFile(resolve(path));
  return { content: buf.toString('utf-8') };
}

async function writeFile({ path, content }) {
  await fs.mkdir(resolve(path).replace(/\/[^/]+$/, ''), { recursive: true });
  await fs.writeFile(resolve(path), content, 'utf-8');
  return { ok: true };
}

function startWatch({ id, path }) {
  if (!isAbsolute(path)) path = resolve(path);
  if (watchers.has(id)) {
    watchers.get(id).close();
  }
  let timer = null;
  const pending = new Set();
  const flush = () => {
    if (pending.size === 0) return;
    const changes = [...pending];
    pending.clear();
    send('fs_change', { id, changes });
  };
  try {
    const w = fsWatch(path, { recursive: true }, (event, filename) => {
      if (!filename) return;
      const norm = String(filename);
      const top = norm.split(/[\\/]/, 1)[0];
      if (SKIP_DIRS.has(top)) return;
      pending.add(norm);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 200);
    });
    watchers.set(id, w);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

function stopWatch({ id }) {
  const w = watchers.get(id);
  if (w) {
    w.close();
    watchers.delete(id);
  }
  return { ok: true };
}

async function gitClone({ url, dest }) {
  return await new Promise((resolve, reject) => {
    const child = spawn('git', ['clone', url, dest], { stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString('utf-8')));
    child.on('exit', (code) => {
      if (code === 0) resolve({ ok: true });
      else reject(new Error(stderr || `git clone exited ${code}`));
    });
    child.on('error', reject);
  });
}

async function pathExists({ path }) {
  try {
    await fs.access(resolve(path));
    return { exists: true };
  } catch {
    return { exists: false };
  }
}

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString('utf-8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf-8')));
    child.on('exit', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `git exited ${code}`));
    });
    child.on('error', reject);
  });
}

async function savepoint({ path }) {
  const root = resolve(path);
  const headSha = await runGit(root, ['rev-parse', 'HEAD']);
  let stashSha = '';
  try {
    // Create a stash object capturing uncommitted + untracked state,
    // WITHOUT pushing it onto the stash list (working tree stays as-is).
    const s = await runGit(root, ['stash', 'create']);
    stashSha = s || '';
  } catch {
    stashSha = '';
  }
  return { headSha, stashSha };
}

async function revert({ path, headSha, stashSha }) {
  const root = resolve(path);
  await runGit(root, ['reset', '--hard', headSha]);
  await runGit(root, ['clean', '-fd']);
  if (stashSha) {
    try {
      await runGit(root, ['stash', 'apply', '--index', stashSha]);
    } catch {
      try {
        await runGit(root, ['stash', 'apply', stashSha]);
      } catch {
        // Nothing to apply or conflicts — user can recover manually
      }
    }
  }
  return { ok: true };
}

channel.on('broadcast', { event: 'studio' }, async ({ payload }) => {
  if (!payload || typeof payload !== 'object') return;
  switch (payload.type) {
    case 'ping':
      send('pong', { ts: Date.now() });
      return;
    case 'exec':
      exec(payload);
      return;
    case 'kill':
      killProc(payload);
      return;
    case 'list':
      await safeReply(payload.id, 'list', () => listDir(payload));
      return;
    case 'read':
      await safeReply(payload.id, 'read', () => readFile(payload));
      return;
    case 'write':
      await safeReply(payload.id, 'write', () => writeFile(payload));
      return;
    case 'exists':
      await safeReply(payload.id, 'exists', () => pathExists(payload));
      return;
    case 'clone':
      await safeReply(payload.id, 'clone', () => gitClone(payload));
      return;
    case 'savepoint':
      await safeReply(payload.id, 'savepoint', () => savepoint(payload));
      return;
    case 'revert':
      await safeReply(payload.id, 'revert', () => revert(payload));
      return;
    case 'watch_start':
      send('watch_started', startWatch(payload));
      return;
    case 'watch_stop':
      send('watch_stopped', stopWatch(payload));
      return;
    default:
      return;
  }
});

function probeCli(cmd) {
  return new Promise((resolve) => {
    const args = plat === 'win32' ? ['/c', 'where', cmd] : ['-lc', `command -v ${cmd}`];
    const sh = plat === 'win32' ? 'cmd.exe' : 'sh';
    const child = spawn(sh, args, { stdio: 'ignore' });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

async function printCliStatus() {
  const [hasClaude, hasCodex] = await Promise.all([
    probeCli('claude'),
    probeCli('codex'),
  ]);
  console.log('[agent] Available CLIs:');
  console.log(
    `  claude:  ${hasClaude ? 'installed' : 'NOT installed (npm install -g @anthropic-ai/claude-code, then run `claude` to sign in)'}`,
  );
  console.log(
    `  codex:   ${hasCodex ? 'installed' : 'NOT installed (optional — npm install -g @openai/codex)'}`,
  );
  console.log(
    '[agent] Leave this window open while you use the studio. Ctrl+C to stop.',
  );
}

channel.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    console.log(`[agent] Connected as ${host} on channel ${channelName}.`);
    announce();
    setInterval(announce, 25_000);
    printCliStatus();
  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    console.error(`[agent] Channel ${status.toLowerCase()}, retrying in 3s…`);
    setTimeout(() => channel.subscribe(), 3000);
  }
});

process.on('SIGINT', () => {
  console.log('[agent] shutting down');
  for (const child of procs.values()) child.kill('SIGTERM');
  for (const w of watchers.values()) w.close();
  channel.unsubscribe();
  exit(0);
});
