import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface AgentInfo {
  host: string;
  version: string;
  lastSeen: number;
}

export interface ExecRequest {
  id: string;
  command: string;
  args?: string[];
  cwd?: string;
}

export type AgentEvent =
  | { type: 'hello'; host: string; version: string; ts: number }
  | { type: 'pong'; ts: number }
  | { type: 'output'; id: string; stream: 'stdout' | 'stderr'; data: string }
  | { type: 'exit'; id: string; code: number; error?: string };

type EventHandler = (e: AgentEvent) => void;

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
          lastSeen: Date.now(),
        };
        this.emitAgentInfo();
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

  private send(payload: Record<string, unknown>) {
    if (!this.channel) return;
    this.channel.send({ type: 'broadcast', event: 'studio', payload });
  }
}
