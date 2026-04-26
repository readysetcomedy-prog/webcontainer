import { useEffect, useRef, useState } from 'react';
import type { AgentClient, AgentInfo } from '../lib/agentClient';
import type { ModelPreset } from '../lib/userSecrets';
import { bytesToBase64 } from '../lib/github';
import {
  addUsage,
  buildExecForModel,
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
  activity?: string[];
  attachments?: { name: string; relPath: string; isImage: boolean }[];
  startedAt?: number;
}

interface PendingAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  bytes: Uint8Array;
  // Object URL for image previews; null for non-images.
  previewUrl: string | null;
}

const newMsgId = () =>
  `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB per file

// Sanitise a filename so we can drop it on disk without surprises. Keep
// extension; collapse anything weird to dashes.
function safeName(name: string): string {
  const lastDot = name.lastIndexOf('.');
  const stem = lastDot > 0 ? name.slice(0, lastDot) : name;
  const ext = lastDot > 0 ? name.slice(lastDot) : '';
  const cleanStem = stem.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60) || 'file';
  const cleanExt = ext.replace(/[^a-zA-Z0-9.]+/g, '');
  return cleanStem + cleanExt;
}

async function fileToAttachment(file: File): Promise<PendingAttachment> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const isImage = file.type.startsWith('image/');
  const previewUrl = isImage ? URL.createObjectURL(file) : null;
  return {
    id: newMsgId(),
    name: safeName(file.name),
    size: bytes.byteLength,
    type: file.type,
    bytes,
    previewUrl,
  };
}

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
  onStatusChange?: (status: string | null) => void;
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
  onStatusChange,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sessionUsage, setSessionUsage] = useState<Usage>(() => emptyUsage());
  const activeRunRef = useRef<string | null>(null);
  const parserRef = useRef<ReturnType<typeof makeParser> | null>(null);
  const prevTextRef = useRef<string>('');
  const endRef = useRef<HTMLDivElement>(null);
  const sessionStartedRef = useRef(false);
  const lastSavepointRef = useRef<{
    headSha: string;
    stashSha: string;
    label: string;
  } | null>(null);
  const [hasSavepoint, setHasSavepoint] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachErr, setAttachErr] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const selected =
    models.find((m) => m.id === selectedModelId) ?? models[0] ?? null;
  const tracking = isTrackable(selected);

  // Revoke object URLs when attachments are removed/cleared so we don't
  // leak memory.
  useEffect(() => {
    return () => {
      attachments.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
    };
    // We only want this to fire on unmount — list-level revoke happens
    // synchronously at remove time below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = async (filesIn: FileList | File[]) => {
    setAttachErr(null);
    const arr = Array.from(filesIn);
    const accepted: PendingAttachment[] = [];
    for (const f of arr) {
      if (f.size > MAX_ATTACHMENT_BYTES) {
        setAttachErr(
          `${f.name} is ${(f.size / 1024 / 1024).toFixed(1)}MB — over the 25MB attachment limit.`,
        );
        continue;
      }
      try {
        accepted.push(await fileToAttachment(f));
      } catch (e) {
        setAttachErr(`Couldn't read ${f.name}: ${(e as Error).message}`);
      }
    }
    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted]);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const dropped = prev.find((a) => a.id === id);
      if (dropped?.previewUrl) URL.revokeObjectURL(dropped.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const clearAttachments = () => {
    attachments.forEach((a) => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    });
    setAttachments([]);
    setAttachErr(null);
  };

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
          const { textAppend, activity, usage, errored } = feedClaudeStream(
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
          if (activity && activity.length) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== 'assistant' || !last.pending) return prev;
              return [
                ...prev.slice(0, -1),
                { ...last, activity: [...(last.activity ?? []), ...activity] },
              ];
            });
            if (onStatusChange) onStatusChange(activity[activity.length - 1]);
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
            const stderrSoFar = last.text ?? '';
            const looksLikeStaleSession =
              /No deferred tool marker|exceeds the tail-scan window|stale.*marker|session.*not.*deferred/i.test(
                stderrSoFar,
              );
            // API 400 "text content blocks must be non-empty" means
            // --continue is replaying a turn the API now rejects (usually
            // an assistant message that contained only a tool_use with an
            // empty text preamble). The fix is the same as a stale session:
            // start fresh on the next message.
            const looksLikeBadHistory =
              /text content blocks? must be non-empty|invalid_request_error.*messages/i.test(
                stderrSoFar,
              );
            const hint = isEnoent
              ? `\n\n[${cliName} isn't installed (or not on PATH) on your laptop. Install it, then try again.` +
                (cliName === 'claude'
                  ? '\nOn most systems:  npm install -g @anthropic-ai/claude-code\nThen:  claude   (to sign in once)'
                  : cliName === 'codex'
                  ? '\nOn most systems:  npm install -g @openai/codex\nThen:  codex login'
                  : '') +
                ']'
              : looksLikeStaleSession || looksLikeBadHistory
              ? `\n\n[The previous conversation got into a state ${cliName === 'claude' ? "Claude's API" : 'the model'} won't replay. Send your next message — it'll start a fresh session automatically.]`
              : `\n\n[${cliName} exited with code ${evt.code}${evt.error ? `: ${evt.error}` : ''}]`;
            finalText = `${last.text}${hint}`;
          }
          return [
            ...prev.slice(0, -1),
            { ...last, text: finalText, pending: false },
          ];
        });
        // Any non-zero exit invalidates the session continuity — the next
        // message has to start fresh instead of trying --continue.
        if (evt.code !== 0) {
          sessionStartedRef.current = false;
        }
        activeRunRef.current = null;
        parserRef.current = null;
        prevTextRef.current = '';
        if (onStatusChange) onStatusChange(null);
      }
    });
    return off;
  }, [agent, tracking]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0) || !agent || !agentInfo || !selected)
      return;
    if (activeRunRef.current) return;

    // Write attachments to disk before kicking off the CLI. We park them
    // under <cwd>/.getxsite/attachments/ so the user's repo stays clean
    // and Claude's prompt can reference them by relative path.
    const writtenAttachments: { name: string; relPath: string; isImage: boolean }[] = [];
    if (attachments.length > 0) {
      if (!cwd) {
        setAttachErr(
          "No project folder set — attachments need somewhere to live on disk.",
        );
        return;
      }
      try {
        // Make sure .getxsite/ doesn't end up in the user's repo.
        const gitignorePath = `${cwd.replace(/[\\/]+$/, '')}/.gitignore`;
        try {
          const { content } = await agent.readFile(gitignorePath);
          if (!/^\s*\.getxsite\/?\s*$/m.test(content)) {
            await agent.writeFile(
              gitignorePath,
              content.endsWith('\n') ? content + '.getxsite/\n' : content + '\n.getxsite/\n',
            );
          }
        } catch {
          // .gitignore might not exist; create one with just our entry.
          await agent.writeFile(gitignorePath, '.getxsite/\n');
        }

        const stamp = Date.now().toString(36);
        for (const a of attachments) {
          const rel = `.getxsite/attachments/${stamp}-${a.id.slice(2, 8)}-${a.name}`;
          const target = `${cwd.replace(/[\\/]+$/, '')}/${rel}`;
          await agent.writeFile(target, bytesToBase64(a.bytes), 'base64');
          writtenAttachments.push({
            name: a.name,
            relPath: rel,
            isImage: a.type.startsWith('image/'),
          });
        }
      } catch (e) {
        setAttachErr(`Couldn't save attachments: ${(e as Error).message}`);
        return;
      }
    }

    // Prepend attachment references so the model sees them. Claude Code
    // (and most CLIs that read paths) will Read / vision the file when
    // asked.
    let promptForModel = trimmed;
    if (writtenAttachments.length > 0) {
      const lines = writtenAttachments.map((a) =>
        `- ${a.relPath}${a.isImage ? ' (image)' : ''}`,
      );
      const header =
        writtenAttachments.length === 1
          ? `Attached file:\n${lines.join('\n')}\n\n`
          : `Attached ${writtenAttachments.length} files:\n${lines.join('\n')}\n\n`;
      promptForModel = trimmed ? header + trimmed : header.trim();
    }

    const userMsg: ChatMessage = {
      id: newMsgId(),
      role: 'user',
      text: trimmed,
      attachments: writtenAttachments.length > 0 ? writtenAttachments : undefined,
    };
    const aiMsg: ChatMessage = {
      id: newMsgId(),
      role: 'assistant',
      text: '',
      pending: true,
      startedAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInput('');
    clearAttachments();
    const runId = newMsgId();
    activeRunRef.current = runId;
    const isClaude = selected.cli === 'claude';
    const continuation =
      isClaude && sessionStartedRef.current ? ['--continue'] : [];
    const { args: runArgs, stdin } = buildExecForModel(
      { ...selected, args: [...selected.args, ...continuation] },
      promptForModel,
    );
    sessionStartedRef.current = true;
    parserRef.current = tracking ? makeParser() : null;
    prevTextRef.current = '';
    setManualHeight(null);
    if (onStatusChange) onStatusChange('Thinking…');
    // Best-effort git savepoint so user can revert if Claude breaks
    // something. Run in the background — don't block the chat.
    if (cwd) {
      agent
        .savepoint(cwd)
        .then((snap) => {
          lastSavepointRef.current = {
            headSha: snap.headSha,
            stashSha: snap.stashSha,
            label: trimmed.slice(0, 60),
          };
          setHasSavepoint(true);
        })
        .catch(() => {
          lastSavepointRef.current = null;
          setHasSavepoint(false);
        });
    }
    agent.exec({ id: runId, command: selected.cli, args: runArgs, cwd, stdin });
  };

  const cancel = () => {
    if (!agent || !activeRunRef.current) return;
    agent.kill(activeRunRef.current);
    // If the user kills mid-task, mark the session unrecoverable so the
    // next prompt starts a brand-new conversation rather than trying to
    // --continue a half-finished one.
    sessionStartedRef.current = false;
  };

  const newConversation = () => {
    sessionStartedRef.current = false;
    setMessages([]);
    setSessionUsage(emptyUsage());
  };

  const revertLast = async () => {
    if (!agent || !cwd || !lastSavepointRef.current || reverting) return;
    const sp = lastSavepointRef.current;
    const ok = window.confirm(
      `Revert every file change Claude made after your prompt "${sp.label}${sp.label.length >= 60 ? '…' : ''}"? Your earlier uncommitted work is preserved.`,
    );
    if (!ok) return;
    setReverting(true);
    try {
      await agent.revert(cwd, sp.headSha, sp.stashSha);
      lastSavepointRef.current = null;
      setHasSavepoint(false);
    } catch (e) {
      window.alert(`Revert failed: ${(e as Error).message}`);
    } finally {
      setReverting(false);
    }
  };

  const clearAttachmentFolder = async () => {
    if (!agent || !cwd) return;
    const ok = window.confirm(
      'Delete every file the chat has saved under .getxsite/attachments/ on this laptop? Past chat references will break.',
    );
    if (!ok) return;
    try {
      // The agent doesn't have a recursive-delete RPC, so we list and
      // overwrite each known attachment with empty content + remove the
      // folder via shell. Simpler: spawn rm -rf via exec.
      const isWin = (agentInfo?.platform ?? '').toLowerCase() === 'win32';
      const target = `${cwd.replace(/[\\/]+$/, '')}${isWin ? '\\' : '/'}.getxsite${isWin ? '\\' : '/'}attachments`;
      const cmd = isWin ? 'cmd' : 'rm';
      const args = isWin ? ['/c', 'rmdir', '/s', '/q', target] : ['-rf', target];
      const id = `clear-attach-${Date.now().toString(36)}`;
      agent.exec({ id, command: cmd, args, cwd });
    } catch (e) {
      window.alert(`Couldn't clear attachments: ${(e as Error).message}`);
    }
  };

  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragActive(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragActive(false);
    const dropped = e.dataTransfer.files;
    if (dropped && dropped.length > 0) addFiles(dropped);
  };
  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
    // reset so picking the same file twice still fires onChange
    e.target.value = '';
  };

  const [now, setNow] = useState(() => Date.now());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [manualHeight, setManualHeight] = useState<number | null>(null);
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (manualHeight !== null) {
      ta.style.height = `${manualHeight}px`;
      return;
    }
    ta.style.height = 'auto';
    const natural = ta.scrollHeight;
    ta.style.height = Math.min(Math.max(natural, 44), 600) + 'px';
  }, [input, manualHeight]);

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const ta = textareaRef.current;
    if (!ta) return;
    const startH = ta.offsetHeight;
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY; // dragging up = positive
      const next = Math.min(Math.max(startH + delta, 44), 600);
      setManualHeight(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  useEffect(() => {
    const hasPending = messages.some((m) => m.pending);
    if (!hasPending) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [messages]);

  const connected = !!agentInfo;
  const hasSessionUsage =
    sessionUsage.inputTokens + sessionUsage.outputTokens > 0;

  return (
    <div
      className={`chat-panel ${dragActive ? 'chat-panel-dragging' : ''}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
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
        {hasSavepoint && (
          <button
            className="link-button chat-revert"
            onClick={revertLast}
            disabled={reverting}
            title="Undo every file change since your last message"
          >
            {reverting ? 'Reverting…' : 'Revert latest'}
          </button>
        )}
        {connected && cwd && (
          <button
            className="link-button"
            onClick={clearAttachmentFolder}
            title="Delete every file the chat has saved under .getxsite/attachments/"
          >
            Clear attachments
          </button>
        )}
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
        {messages.map((m) => {
          const elapsedSec =
            m.pending && m.startedAt ? Math.floor((now - m.startedAt) / 1000) : 0;
          return (
            <div key={m.id} className={`chat-msg chat-msg-${m.role}`}>
              <div className="chat-msg-role">
                {m.role === 'user' ? 'You' : selected?.label ?? 'Assistant'}
                {m.pending && m.startedAt && (
                  <span className="chat-msg-timer">
                    {' '}
                    · {elapsedSec < 60
                      ? `${elapsedSec}s`
                      : `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`}
                  </span>
                )}
              </div>
              {m.activity && m.activity.length > 0 && (
                <div className="chat-msg-activity">
                  {m.activity.slice(-8).map((line, i) => (
                    <div key={i} className="chat-msg-activity-line">
                      {line}
                    </div>
                  ))}
                </div>
              )}
              {m.attachments && m.attachments.length > 0 && (
                <div className="chat-msg-attachments">
                  {m.attachments.map((a) => (
                    <span
                      key={a.relPath}
                      className="chat-msg-attach-chip"
                      title={a.relPath}
                    >
                      {a.isImage ? '🖼' : '📎'} {a.name}
                    </span>
                  ))}
                </div>
              )}
              <div className="chat-msg-text">
                {m.text ||
                  (m.pending
                    ? m.activity && m.activity.length
                      ? '…'
                      : 'Thinking…'
                    : '')}
              </div>
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
          );
        })}
        <div ref={endRef} />
      </div>
      <div
        className="chat-input-resize"
        onMouseDown={onResizeStart}
        title="Drag to resize — or just type and it grows on its own"
      />
      {(attachments.length > 0 || attachErr) && (
        <div className="chat-attachments-row">
          {attachments.map((a) => (
            <span key={a.id} className="chat-attach-chip" title={`${a.name} (${(a.size / 1024).toFixed(1)} KB)`}>
              {a.previewUrl ? (
                <img src={a.previewUrl} alt="" className="chat-attach-thumb" />
              ) : (
                <span className="chat-attach-icon">📎</span>
              )}
              <span className="chat-attach-name">{a.name}</span>
              <button
                className="chat-attach-remove"
                onClick={() => removeAttachment(a.id)}
                title="Remove"
                type="button"
              >
                ✕
              </button>
            </span>
          ))}
          {attachErr && (
            <span className="chat-attach-err">{attachErr}</span>
          )}
        </div>
      )}
      <div className="chat-input-row">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={onPickFiles}
        />
        <button
          className="chat-attach-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!connected || !selected || !cwd || !!activeRunRef.current}
          title={cwd ? 'Attach files (or drag and drop)' : 'Open a project first to attach files'}
          type="button"
        >
          📎
        </button>
        <textarea
          ref={textareaRef}
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
              ? attachments.length > 0
                ? `Send ${attachments.length} attachment${attachments.length === 1 ? '' : 's'} with optional prompt… (Cmd/Ctrl+Enter)`
                : 'Ask for a change… (Cmd/Ctrl+Enter to send)'
              : !selected
              ? 'Add a model first'
              : 'Connect the local agent to chat'
          }
          rows={1}
          disabled={!connected || !selected || !!activeRunRef.current}
        />
        {activeRunRef.current ? (
          <button onClick={cancel} className="chat-cancel">Stop</button>
        ) : (
          <button
            onClick={send}
            disabled={
              !connected ||
              !selected ||
              (!input.trim() && attachments.length === 0)
            }
            className="primary"
          >
            Send
          </button>
        )}
      </div>
      {dragActive && (
        <div className="chat-drop-overlay">
          Drop files to attach to your next message
        </div>
      )}
    </div>
  );
}
