import { useEffect, useRef, useState } from 'react';
import type { AgentInfo, AgentClient } from '../lib/agentClient';
import type { Project } from '../lib/projects';

export interface AgentPanelProps {
  userId: string;
  agentInfo: AgentInfo | null;
  agent: AgentClient | null;
  activeProject: Project | null;
  onSetLocalPath: (path: string) => Promise<void>;
}

function defaultPathFor(agentInfo: AgentInfo, project: Project): string {
  const isWin = (agentInfo.platform ?? '').toLowerCase() === 'win32';
  const sep = isWin ? '\\' : '/';
  const home = agentInfo.home ?? (isWin ? 'C:\\Users' : '/Users/you');
  return [home, 'getxsite', project.owner, project.repo].join(sep);
}

export default function AgentPanel({
  userId,
  agentInfo,
  agent,
  activeProject,
  onSetLocalPath,
}: AgentPanelProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const machineKey = agentInfo?.host ?? null;
  const storedForThisMachine = machineKey
    ? activeProject?.pathsByMachine?.[machineKey]
    : undefined;
  const legacyPath = activeProject?.localPath;
  const initialPath =
    storedForThisMachine ??
    (activeProject && agentInfo ? defaultPathFor(agentInfo, activeProject) : legacyPath ?? '');
  const [localPath, setLocalPath] = useState<string>(initialPath ?? '');
  const [savingPath, setSavingPath] = useState(false);
  const [pathInfo, setPathInfo] = useState<string | null>(null);
  const [pathErr, setPathErr] = useState<string | null>(null);
  const [pathStatus, setPathStatus] = useState<
    'idle' | 'checking' | 'exists' | 'missing'
  >('idle');
  const probeToken = useRef(0);

  useEffect(() => {
    setLocalPath(initialPath ?? '');
    setPathInfo(null);
    setPathErr(null);
  }, [activeProject?.id, machineKey, initialPath]);

  // Live existence probe: every time the user stops typing for 400ms,
  // check whether the path exists on disk via the agent.
  useEffect(() => {
    if (!agent || !agentInfo) {
      setPathStatus('idle');
      return;
    }
    const trimmed = localPath.trim();
    if (!trimmed) {
      setPathStatus('idle');
      return;
    }
    const token = ++probeToken.current;
    setPathStatus('checking');
    const t = setTimeout(() => {
      agent
        .exists(trimmed)
        .then((r) => {
          if (probeToken.current !== token) return;
          setPathStatus(r.exists ? 'exists' : 'missing');
        })
        .catch(() => {
          if (probeToken.current !== token) return;
          setPathStatus('idle');
        });
    }, 400);
    return () => clearTimeout(t);
  }, [agent, agentInfo, localPath]);

  const installCmd = 'npm install -g @getxsite/agent';
  const runCmd = `getxsite-agent --user-id ${userId}`;

  const copy = async (text: string, kind: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const savePath = async (cloneIfMissing: boolean) => {
    if (!activeProject || !agent) return;
    const trimmed = localPath.trim();
    if (!trimmed) return;
    setSavingPath(true);
    setPathInfo(null);
    setPathErr(null);
    try {
      const check = await agent.exists(trimmed);
      if (cloneIfMissing) {
        if (!check.exists) {
          setPathInfo('cloning…');
          await agent.clone(
            `https://github.com/${activeProject.owner}/${activeProject.repo}.git`,
            trimmed,
          );
          setPathInfo('cloned');
        } else {
          setPathInfo('using existing folder');
        }
      } else if (!check.exists) {
        const ok = window.confirm(
          `That folder doesn't exist on ${machineKey ?? 'this machine'}:\n\n${trimmed}\n\nSave it anyway? The studio won't be able to read files until the folder exists. Usually you want "Clone here & save" instead.`,
        );
        if (!ok) {
          setSavingPath(false);
          return;
        }
        setPathInfo('saved (folder does not exist yet)');
      }
      await onSetLocalPath(trimmed);
      setPathInfo((p) => (p ? `${p} · saved` : 'saved'));
      setPathStatus(check.exists ? 'exists' : 'missing');
    } catch (e) {
      setPathErr((e as Error).message);
    } finally {
      setSavingPath(false);
    }
  };

  const knownMachines = activeProject
    ? Object.entries(activeProject.pathsByMachine ?? {})
    : [];

  return (
    <div className="popover agent-panel">
      <div className="popover-title">Local agent</div>
      <div className="popover-hint">
        Run a tiny script on your laptop and the studio drives your local{' '}
        <code>claude</code> / <code>codex</code> using your existing
        subscription. Nothing listens on your machine — the agent dials
        out to a private channel.
      </div>
      <div className="popover-hint" style={{ fontSize: 11, lineHeight: 1.5 }}>
        <b>One-time setup</b> (each command is run once, ever):
        <br />1. <code>npm install -g @anthropic-ai/claude-code</code> then{' '}
        <code>claude</code> (sign in to your Claude subscription)
        <br />2. <code>npm install -g @getxsite/agent</code> (below)
        <br />
        <b>Each session</b>, run the agent command and leave the terminal open.
      </div>

      <div className="agent-status-row">
        <div className={`agent-status-dot ${agentInfo ? 'on' : 'off'}`} />
        <div>
          {agentInfo ? (
            <>
              <b>{agentInfo.host}</b> connected ·{' '}
              <span className="hint-text">
                v{agentInfo.version}
                {agentInfo.platform ? ` · ${agentInfo.platform}` : ''}
              </span>
            </>
          ) : (
            <>Not connected</>
          )}
        </div>
      </div>

      <div>
        <div className="hint-text" style={{ marginBottom: 4 }}>
          Install once (any terminal — Windows, macOS, Linux):
        </div>
        <div className="agent-cmd">
          <code>{installCmd}</code>
          <button
            className="icon-button"
            onClick={() => copy(installCmd, 'cmd')}
            title="Copy"
          >
            {copied === 'cmd' ? '✓' : '⧉'}
          </button>
        </div>
        <div className="hint-text" style={{ marginTop: 8, marginBottom: 4 }}>
          Then run whenever you want to connect:
        </div>
        <div className="agent-cmd">
          <code>{runCmd}</code>
          <button
            className="icon-button"
            onClick={() => copy(runCmd, 'run')}
            title="Copy"
          >
            {copied === 'run' ? '✓' : '⧉'}
          </button>
        </div>
        <div className="hint-text" style={{ marginTop: 6 }}>
          To upgrade later:{' '}
          <code>npm install -g @getxsite/agent@latest</code>
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

      <div className="agent-divider" />

      <div className="popover-title" style={{ fontSize: 13 }}>
        Active project on disk
      </div>
      {!activeProject ? (
        <div className="hint-text">Open a project to configure its local path.</div>
      ) : (
        <>
          <div className="hint-text">
            Where does <b>{activeProject.owner}/{activeProject.repo}</b> live on{' '}
            <b>{machineKey ?? 'your laptop'}</b>? Chat, builds, and quick
            actions run in this folder.
          </div>
          {!storedForThisMachine && machineKey && legacyPath && (
            <div className="login-info" style={{ fontSize: 12 }}>
              This project was set up on another machine with path{' '}
              <code>{legacyPath}</code>. Set the path for <b>{machineKey}</b>{' '}
              below.
            </div>
          )}
          <input
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            placeholder={`~/getxsite/${activeProject.repo}`}
            spellCheck={false}
            className="agent-path-input"
          />
          <div className={`agent-path-status agent-path-status-${pathStatus}`}>
            {pathStatus === 'checking' && '⟳ Checking path…'}
            {pathStatus === 'exists' && '✓ Folder exists on disk'}
            {pathStatus === 'missing' && '✗ Folder not found on disk (use "Clone here & save" to create it)'}
            {pathStatus === 'idle' && agentInfo && 'Type a path — we\'ll verify it against your laptop live'}
            {pathStatus === 'idle' && !agentInfo && 'Start the agent first to verify paths'}
          </div>
          {pathErr && <div className="error-text">{pathErr}</div>}
          {pathInfo && <div className="login-info">{pathInfo}</div>}
          <div className="popover-actions">
            <button
              disabled={!agentInfo || !localPath.trim() || savingPath}
              onClick={() => savePath(false)}
              title="Register this path — use when the folder already exists"
            >
              Use this folder
            </button>
            <button
              className="primary"
              disabled={
                !agentInfo ||
                !localPath.trim() ||
                savingPath ||
                pathStatus === 'exists'
              }
              onClick={() => savePath(true)}
              title={
                pathStatus === 'exists'
                  ? "Folder already exists — use \"Use this folder\" instead"
                  : "Clone the repo into this folder, then save"
              }
            >
              Clone here &amp; save
            </button>
          </div>

          {knownMachines.length > 0 && (
            <details className="machines-list">
              <summary>
                Known paths on other machines ({knownMachines.length})
              </summary>
              <div className="machines-body">
                {knownMachines.map(([host, path]) => (
                  <div key={host} className="machine-row">
                    <div className="machine-host">
                      {host}
                      {host === machineKey && (
                        <span className="hint-text"> (this one)</span>
                      )}
                    </div>
                    <div className="machine-path">
                      <code>{path}</code>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
