import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface AgentInfo {
  host: string;
  version: string;
  home?: string;
  platform?: string;
  lastSeen: number;
}

export interface ExecRequest {
  id: string;
  command: string;
  args?: string[];
  cwd?: string;
}

export interface DirEntry {
  name?: string;
  path: string;
  isDir: boolean;
}

export type AgentEvent =
  | {
      type: 'hello';
      host: string;
      home?: string;
      platform?: string;
      version: string;
      ts: number;
    }
  | { type: 'pong'; ts: number }
  | { type: 'output'; id: string; stream: 'stdout' | 'stderr'; data: string }
  | { type: 'exit'; id: string; code: number; error?: string }
  | { type: 'list_ok'; id: string; data: { entries: DirEntry[] } }
  | { type: 'list_err'; id: string; error: string }
  | { type: 'read_ok'; id: string; data: { content: string } }
  | { type: 'read_err'; id: string; error: string }
  | { type: 'write_ok'; id: string; data: { ok: true } }
  | { type: 'write_err'; id: string; error: string }
  | { type: 'exists_ok'; id: string; data: { exists: boolean } }
  | { type: 'exists_err'; id: string; error: string }
  | { type: 'clone_ok'; id: string; data: { ok: true } }
  | { type: 'clone_err'; id: string; error: string }
  | {
      type: 'savepoint_ok';
      id: string;
      data: { headSha: string; stashSha: string };
    }
  | { type: 'savepoint_err'; id: string; error: string }
  | { type: 'revert_ok'; id: string; data: { ok: true } }
  | { type: 'revert_err'; id: string; error: string }
  | { type: 'watch_started'; ok: boolean; error?: string }
  | { type: 'watch_stopped'; ok: boolean }
  | { type: 'fs_change'; id: string; changes: string[] };

type EventHandler = (e: AgentEvent) => void;

type PendingResolver = (data: unknown) => void;
type PendingRejector = (err: Error) => void;

const newRpcId = () =>
  `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export class AgentClient {
  private channel: RealtimeChannel | null = null;
  private userId: string;
  private handlers = new Set<EventHandler>();
  private connectedHandlers = new Set<(v: boolean) => void>();
  private agentInfoHandlers = new Set<(v: AgentInfo | null) => void>();
  private agentInfo: AgentInfo | null = null;
  private connected = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private pending = new Map<
    string,
    { resolve: PendingResolver; reject: PendingRejector }
  >();
  private fsWatchHandlers = new Map<string, (changes: string[]) => void>();

  constructor(userId: string) {
    this.userId = userId;
  }

  connect() {
    if (this.channel) return;
    const channel = supabase.channel(`agent-${this.userId}`, {
      config: { broadcast: { self: false } },
    });
    channel.on('broadcast', { event: 'agent' }, ({ payload }) => {
      const evt = payload as AgentEvent;
      if (evt.type === 'hello' || evt.type === 'pong') {
        this.agentInfo = {
          host: 'host' in evt ? evt.host : this.agentInfo?.host ?? '?',
          version:
            'version' in evt ? evt.version : this.agentInfo?.version ?? '?',
          home: 'home' in evt ? evt.home : this.agentInfo?.home,
          platform:
            'platform' in evt ? evt.platform : this.agentInfo?.platform,
          lastSeen: Date.now(),
        };
        this.emitAgentInfo();
      }

      // RPC resolution
      if (
        evt.type === 'list_ok' ||
        evt.type === 'read_ok' ||
        evt.type === 'write_ok' ||
        evt.type === 'exists_ok' ||
        evt.type === 'clone_ok' ||
        evt.type === 'savepoint_ok' ||
        evt.type === 'revert_ok'
      ) {
        const id = (evt as { id: string }).id;
        const p = this.pending.get(id);
        if (p) {
          p.resolve((evt as { data: unknown }).data);
          this.pending.delete(id);
        }
      } else if (
        evt.type === 'list_err' ||
        evt.type === 'read_err' ||
        evt.type === 'write_err' ||
        evt.type === 'exists_err' ||
        evt.type === 'clone_err' ||
        evt.type === 'savepoint_err' ||
        evt.type === 'revert_err'
      ) {
        const id = (evt as { id: string }).id;
        const p = this.pending.get(id);
        if (p) {
          p.reject(new Error((evt as { error: string }).error));
          this.pending.delete(id);
        }
      } else if (evt.type === 'fs_change') {
        const handler = this.fsWatchHandlers.get(evt.id);
        if (handler) handler(evt.changes);
      }

      this.handlers.forEach((h) => h(evt));
    });
    channel.subscribe((status) => {
      const next = status === 'SUBSCRIBED';
      if (next !== this.connected) {
        this.connected = next;
        this.connectedHandlers.forEach((h) => h(next));
      }
      if (next) {
        this.ping();
        this.heartbeatTimer = setInterval(() => this.ping(), 15_000);
        this.staleTimer = setInterval(() => {
          if (
            this.agentInfo &&
            Date.now() - this.agentInfo.lastSeen > 60_000
          ) {
            this.agentInfo = null;
            this.emitAgentInfo();
          }
        }, 5_000);
      }
    });
    this.channel = channel;
  }

  disconnect() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.heartbeatTimer = null;
    this.staleTimer = null;
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.agentInfo = null;
    this.connected = false;
    this.connectedHandlers.forEach((h) => h(false));
    this.emitAgentInfo();
    for (const p of this.pending.values()) p.reject(new Error('disconnected'));
    this.pending.clear();
    this.fsWatchHandlers.clear();
  }

  isConnected() {
    return this.connected;
  }

  agent() {
    return this.agentInfo;
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  onConnected(handler: (v: boolean) => void): () => void {
    this.connectedHandlers.add(handler);
    handler(this.connected);
    return () => {
      this.connectedHandlers.delete(handler);
    };
  }

  onAgent(handler: (v: AgentInfo | null) => void): () => void {
    this.agentInfoHandlers.add(handler);
    handler(this.agentInfo);
    return () => {
      this.agentInfoHandlers.delete(handler);
    };
  }

  private emitAgentInfo() {
    this.agentInfoHandlers.forEach((h) => h(this.agentInfo));
  }

  ping() {
    this.send({ type: 'ping' });
  }

  exec(req: ExecRequest) {
    this.send({ type: 'exec', ...req });
  }

  kill(id: string) {
    this.send({ type: 'kill', id });
  }

  private rpc<T>(type: string, body: Record<string, unknown>): Promise<T> {
    if (!this.agentInfo) {
      return Promise.reject(new Error('agent not connected'));
    }
    const id = newRpcId();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (data) => resolve(data as T),
        reject,
      });
      this.send({ type, id, ...body });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`agent rpc ${type} timed out`));
        }
      }, 30_000);
    });
  }

  list(path: string, recursive = false): Promise<{ entries: DirEntry[] }> {
    return this.rpc('list', { path, recursive });
  }

  readFile(path: string): Promise<{ content: string }> {
    return this.rpc('read', { path });
  }

  writeFile(path: string, content: string): Promise<{ ok: true }> {
    return this.rpc('write', { path, content });
  }

  exists(path: string): Promise<{ exists: boolean }> {
    return this.rpc('exists', { path });
  }

  clone(url: string, dest: string): Promise<{ ok: true }> {
    return this.rpc('clone', { url, dest });
  }

  savepoint(path: string): Promise<{ headSha: string; stashSha: string }> {
    return this.rpc('savepoint', { path });
  }

  revert(
    path: string,
    headSha: string,
    stashSha: string,
  ): Promise<{ ok: true }> {
    return this.rpc('revert', { path, headSha, stashSha });
  }

  watchStart(id: string, path: string, onChange: (paths: string[]) => void) {
    this.fsWatchHandlers.set(id, onChange);
    this.send({ type: 'watch_start', id, path });
    return () => this.watchStop(id);
  }

  watchStop(id: string) {
    this.send({ type: 'watch_stop', id });
    this.fsWatchHandlers.delete(id);
  }

  private send(payload: Record<string, unknown>) {
    if (!this.channel) return;
    this.channel.send({ type: 'broadcast', event: 'studio', payload });
  }
}
