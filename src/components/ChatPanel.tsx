import { useEffect, useRef, useState } from 'react';
import type { AgentClient, AgentInfo } from '../lib/agentClient';
import type { ModelPreset } from '../lib/userSecrets';
import {
  addUsage,
  argsForRun,
  emptyUsage,
  feedClaudeStream,
  formatCost,
  formatNum,
  isTrackable,
  makeParser,
  type Usage,
} from '../lib/tokenParser';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  pending?: boolean;
  usage?: Usage;
}

const newMsgId = () =>
  `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export interface ChatPanelProps {
  agent: AgentClient | null;
  agentInfo: AgentInfo | null;
  userId: string;
  cwd?: string;
  models: ModelPreset[];
  selectedModelId: string | null;
  onSelectModel: (id: string) => void;
  onAddModel: () => void;
  onManageModels: () => void;
}

export default function ChatPanel({
  agent,
  agentInfo,
  userId,
  cwd,
  models,
  selectedModelId,
  onSelectModel,
  onAddModel,
  onManageModels,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sessionUsage, setSessionUsage] = useState<Usage>(() => emptyUsage());
  const activeRunRef = useRef<string | null>(null);
  const parserRef = useRef<ReturnType<typeof makeParser> | null>(null);
  const prevTextRef = useRef<string>('');
  const endRef = useRef<HTMLDivElement>(null);
  const sessionStartedRef = useRef(false);

  const selected =
    models.find((m) => m.id === selectedModelId) ?? models[0] ?? null;
  const tracking = isTrackable(selected);

  useEffect(() => {
    sessionStartedRef.current = false;
    setMessages([]);
    setSessionUsage(emptyUsage());
  }, [cwd, selected?.id]);

  useEffect(() => {
    if (!agent) return;
    const off = agent.onEvent((evt) => {
      if (evt.type === 'output' && evt.id === activeRunRef.current) {
        const parser = parserRef.current;
        if (parser && tracking) {
          if (evt.stream === 'stderr') {
            // surface errors inline as text
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== 'assistant' || !last.pending) return prev;
              return [
                ...prev.slice(0, -1),
                { ...last, text: last.text + evt.data },
              ];
            });
            return;
          }
          const { textAppend, usage, errored } = feedClaudeStream(
            parser,
            evt.data,
            prevTextRef.current,
          );
          if (textAppend) {
            prevTextRef.current += textAppend;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== 'assistant' || !last.pending) return prev;
              return [
                ...prev.slice(0, -1),
                { ...last, text: last.text + textAppend },
              ];
            });
          }
          if (errored) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== 'assistant' || !last.pending) return prev;
              return [
                ...prev.slice(0, -1),
                { ...last, text: last.text + `\n[error: ${errored}]` },
              ];
            });
          }
          if (usage) {
            setSessionUsage((s) => addUsage(s, usage));
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== 'assistant') return prev;
              return [...prev.slice(0, -1), { ...last, usage }];
            });
          }
          return;
        }
        // untracked path
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant' || !last.pending) return prev;
          return [
            ...prev.slice(0, -1),
            { ...last, text: last.text + evt.data },
          ];
        });
      } else if (evt.type === 'exit' && evt.id === activeRunRef.current) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          let finalText: string;
          if (evt.code === 0) {
            finalText = last.text || '(empty response)';
          } else {
            const cliName = selected?.cli ?? 'the CLI';
            const isEnoent = (evt.error ?? '').includes('ENOENT');
            const hint = isEnoent
              ? `\n\n[${cliName} isn't installed (or not on PATH) on your laptop. Install it, then try again.` +
                (cliName === 'claude'
                  ? '\nOn most systems:  npm install -g @anthropic-ai/claude-code\nThen:  claude   (to sign in once)'
                  : cliName === 'codex'
                  ? '\nOn most systems:  npm install -g @openai/codex\nThen:  codex login'
                  : '') +
                ']'
              : `\n\n[${cliName} exited with code ${evt.code}${evt.error ? `: ${evt.error}` : ''}]`;
            finalText = `${last.text}${hint}`;
          }
          return [
            ...prev.slice(0, -1),
            { ...last, text: finalText, pending: false },
          ];
        });
        activeRunRef.current = null;
        parserRef.current = null;
        prevTextRef.current = '';
      }
    });
    return off;
  }, [agent, tracking]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = () => {
    const trimmed = input.trim();
    if (!trimmed || !agent || !agentInfo || !selected) return;
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
    const isClaude = selected.cli === 'claude';
    const continuation =
      isClaude && sessionStartedRef.current ? ['--continue'] : [];
    const runArgs = argsForRun(
      { ...selected, args: [...selected.args, ...continuation] },
      trimmed,
    );
    sessionStartedRef.current = true;
    parserRef.current = tracking ? makeParser() : null;
    prevTextRef.current = '';
    agent.exec({ id: runId, command: selected.cli, args: runArgs, cwd });
  };

  const cancel = () => {
    if (!agent || !activeRunRef.current) return;
    agent.kill(activeRunRef.current);
  };

  const newConversation = () => {
    sessionStartedRef.current = false;
    setMessages([]);
    setSessionUsage(emptyUsage());
  };

  const connected = !!agentInfo;
  const hasSessionUsage =
    sessionUsage.inputTokens + sessionUsage.outputTokens > 0;

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span>Chat</span>
        <select
          value={selected?.id ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__add__') onAddModel();
            else if (v === '__manage__') onManageModels();
            else onSelectModel(v);
          }}
          title="Which CLI + model to invoke on the agent"
        >
          {models.length === 0 && <option value="">— no models —</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          <option disabled>──────</option>
          <option value="__add__">+ Add model…</option>
          {models.length > 0 && <option value="__manage__">Manage models…</option>}
        </select>
        <button
          className="link-button"
          onClick={newConversation}
          title="Start a fresh conversation (forgets prior context)"
        >
          New
        </button>
        {hasSessionUsage && (
          <span
            className="session-usage"
            title={`Session: ${sessionUsage.inputTokens} in, ${sessionUsage.outputTokens} out. Cost shown is API-equivalent — your subscription is flat-rate, so this is what you're saving vs. the API.`}
          >
            {formatNum(sessionUsage.inputTokens)} in · {formatNum(sessionUsage.outputTokens)} out · saved {formatCost(sessionUsage.costUsd)}
          </span>
        )}
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
            {connected && selected ? (
              <>
                Type a prompt below — it will run as{' '}
                <code>{selected.cli} …</code> on <b>{agentInfo!.host}</b> using
                your own subscription.
                {tracking && (
                  <div style={{ marginTop: 8, fontSize: 11 }}>
                    Token counts + API-equivalent cost shown per message.
                    (Your subscription is flat-rate — cost shown is what
                    you'd be paying on the API.)
                  </div>
                )}
              </>
            ) : !selected ? (
              <>
                Add a model to start chatting. Use the dropdown above and pick{' '}
                <b>+ Add model</b>.
              </>
            ) : (
              <>
                Connect a local agent to chat with Claude/Codex from the
                studio. Open the <b>Agent</b> panel in the toolbar for setup.
                Your user id:{' '}
                <code className="chat-userid">{userId}</code>
              </>
            )}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg chat-msg-${m.role}`}>
            <div className="chat-msg-role">
              {m.role === 'user' ? 'You' : selected?.label ?? 'Assistant'}
            </div>
            <div className="chat-msg-text">{m.text || (m.pending ? '…' : '')}</div>
            {m.usage && (
              <div
                className="chat-msg-usage"
                title="Cost shown is what this prompt would cost on the Claude API. Your subscription is flat-rate, so this is what you're saving."
              >
                {formatNum(m.usage.inputTokens)} in
                {m.usage.cacheReadTokens > 0 && (
                  <> · {formatNum(m.usage.cacheReadTokens)} cached</>
                )}
                {' · '}
                {formatNum(m.usage.outputTokens)} out · saved{' '}
                {formatCost(m.usage.costUsd)}
                {m.usage.durationMs > 0 && (
                  <> · {(m.usage.durationMs / 1000).toFixed(1)}s</>
                )}
              </div>
            )}
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
            connected && selected
              ? 'Ask for a change… (Cmd/Ctrl+Enter to send)'
              : !selected
              ? 'Add a model first'
              : 'Connect the local agent to chat'
          }
          rows={2}
          disabled={!connected || !selected || !!activeRunRef.current}
        />
        {activeRunRef.current ? (
          <button onClick={cancel} className="chat-cancel">Stop</button>
        ) : (
          <button
            onClick={send}
            disabled={!connected || !selected || !input.trim()}
            className="primary"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
