import { useState } from 'react';
import type { AgentInfo } from '../lib/agentClient';

export interface AgentPanelProps {
  userId: string;
  agentInfo: AgentInfo | null;
}

export default function AgentPanel({ userId, agentInfo }: AgentPanelProps) {
  const [copied, setCopied] = useState<'cmd' | 'id' | null>(null);
  const cmd = `GETXSITE_USER_ID=${userId} npx -y @getxsite/agent`;

  const copy = async (text: string, kind: 'cmd' | 'id') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="popover agent-panel">
      <div className="popover-title">Local agent</div>
      <div className="popover-hint">
        Run a tiny script on your laptop and the studio drives your
        local <code>claude</code> / <code>codex</code> using your existing
        subscription. Nothing listens on your machine — the agent dials
        out to a private channel.
      </div>

      <div className="agent-status-row">
        <div className={`agent-status-dot ${agentInfo ? 'on' : 'off'}`} />
        <div>
          {agentInfo ? (
            <>
              <b>{agentInfo.host}</b> connected ·{' '}
              <span className="hint-text">v{agentInfo.version}</span>
            </>
          ) : (
            <>Not connected</>
          )}
        </div>
      </div>

      <div>
        <div className="hint-text" style={{ marginBottom: 4 }}>
          Run this on your laptop (one-time):
        </div>
        <div className="agent-cmd">
          <code>{cmd}</code>
          <button
            className="icon-button"
            onClick={() => copy(cmd, 'cmd')}
            title="Copy"
          >
            {copied === 'cmd' ? '✓' : '⧉'}
          </button>
        </div>
      </div>

      <div>
        <div className="hint-text" style={{ marginBottom: 4 }}>
          Your user id (the agent uses this as the channel):
        </div>
        <div className="agent-cmd">
          <code className="agent-userid">{userId}</code>
          <button
            className="icon-button"
            onClick={() => copy(userId, 'id')}
            title="Copy"
          >
            {copied === 'id' ? '✓' : '⧉'}
          </button>
        </div>
      </div>

      <div className="hint-text">
        The agent needs <code>claude</code> (or <code>codex</code>)
        installed and signed in on your machine. Once it's running, the
        Chat panel will route prompts there.
      </div>
    </div>
  );
}
