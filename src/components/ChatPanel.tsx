import { useEffect, useRef, useState } from 'react';
import type { AgentClient, AgentInfo } from '../lib/agentClient';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  pending?: boolean;
}

const newMsgId = () =>
  `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export interface ChatPanelProps {
  agent: AgentClient | null;
  agentInfo: AgentInfo | null;
  userId: string;
  cwd?: string;
}

export default function ChatPanel({
  agent,
  agentInfo,
  userId,
  cwd,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [tool, setTool] = useState<'claude' | 'codex'>('claude');
  const activeRunRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!agent) return;
    const off = agent.onEvent((evt) => {
      if (evt.type === 'output' && evt.id === activeRunRef.current) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant' || !last.pending) return prev;
          const updated = { ...last, text: last.text + evt.data };
          return [...prev.slice(0, -1), updated];
        });
      } else if (evt.type === 'exit' && evt.id === activeRunRef.current) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const finalText =
            evt.code === 0
              ? last.text || '(empty response)'
              : `${last.text}\n\n[exited with code ${evt.code}${evt.error ? `: ${evt.error}` : ''}]`;
          return [
            ...prev.slice(0, -1),
            { ...last, text: finalText, pending: false },
          ];
        });
        activeRunRef.current = null;
      }
    });
    return off;
  }, [agent]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = () => {
    const trimmed = input.trim();
    if (!trimmed || !agent || !agentInfo) return;
    if (activeRunRef.current) return;
    const userMsg: ChatMessage = {
      id: newMsgId(),
      role: 'user',
      text: trimmed,
    };
    const aiMsg: ChatMessage = {
      id: newMsgId(),
      role: 'assistant',
      text: '',
      pending: true,
    };
    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInput('');
    const runId = newMsgId();
    activeRunRef.current = runId;
    const command = tool === 'claude' ? 'claude' : 'codex';
    const args =
      tool === 'claude'
        ? ['-p', trimmed, '--output-format', 'text']
        : ['exec', '--quiet', trimmed];
    agent.exec({ id: runId, command, args, cwd });
  };

  const cancel = () => {
    if (!agent || !activeRunRef.current) return;
    agent.kill(activeRunRef.current);
  };

  const connected = !!agentInfo;

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span>Chat</span>
        <select
          value={tool}
          onChange={(e) => setTool(e.target.value as 'claude' | 'codex')}
          title="Which CLI to invoke on the agent"
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
        <span
          className={`chat-status ${connected ? 'on' : 'off'}`}
          title={
            connected
              ? `Agent: ${agentInfo!.host}`
              : 'Local agent not connected'
          }
        >
          ● {connected ? agentInfo!.host : 'agent offline'}
        </span>
      </div>
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            {connected ? (
              <>
                Type a prompt below — it will run as <code>{tool} </code>
                on <b>{agentInfo!.host}</b> using your subscription.
              </>
            ) : (
              <>
                Connect a local agent to chat with Claude/Codex from the
                studio. Open the <b>Local agent</b> panel in the toolbar
                for setup instructions. Your user id:{' '}
                <code className="chat-userid">{userId}</code>
              </>
            )}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg chat-msg-${m.role}`}>
            <div className="chat-msg-role">
              {m.role === 'user' ? 'You' : tool === 'claude' ? 'Claude' : 'Codex'}
            </div>
            <div className="chat-msg-text">{m.text || (m.pending ? '…' : '')}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="chat-input-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={
            connected
              ? 'Ask for a change… (Cmd/Ctrl+Enter to send)'
              : 'Connect the local agent to chat'
          }
          rows={2}
          disabled={!connected || !!activeRunRef.current}
        />
        {activeRunRef.current ? (
          <button onClick={cancel} className="chat-cancel">Stop</button>
        ) : (
          <button
            onClick={send}
            disabled={!connected || !input.trim()}
            className="primary"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
