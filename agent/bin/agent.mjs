#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { argv, env, exit } from 'node:process';

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
const host = hostname();
const version = '0.1.0';

function send(type, payload) {
  channel.send({
    type: 'broadcast',
    event: 'agent',
    payload: { type, ...payload },
  });
}

function announce() {
  send('hello', { host, version, ts: Date.now() });
}

function exec(req) {
  const { id, command, args = [], cwd } = req;
  if (!id || !command) return;
  console.log(`[exec ${id}] ${command} ${args.join(' ')}${cwd ? ` (cwd=${cwd})` : ''}`);
  let child;
  try {
    child = spawn(command, args, {
      cwd: cwd || env.HOME,
      env: { ...env },
      shell: false,
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

function kill(req) {
  const child = procs.get(req.id);
  if (child) child.kill('SIGTERM');
}

channel.on('broadcast', { event: 'studio' }, ({ payload }) => {
  if (!payload || typeof payload !== 'object') return;
  switch (payload.type) {
    case 'ping':
      send('pong', { ts: Date.now() });
      return;
    case 'exec':
      exec(payload);
      return;
    case 'kill':
      kill(payload);
      return;
    default:
      return;
  }
});

channel.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    console.log(`[agent] Connected as ${host} on channel ${channelName}.`);
    announce();
    setInterval(announce, 25_000);
  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    console.error(`[agent] Channel ${status.toLowerCase()}, retrying in 3s…`);
    setTimeout(() => channel.subscribe(), 3000);
  }
});

process.on('SIGINT', () => {
  console.log('[agent] shutting down');
  for (const child of procs.values()) child.kill('SIGTERM');
  channel.unsubscribe();
  exit(0);
});
