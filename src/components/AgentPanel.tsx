import { useEffect, useState } from 'react';
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

  useEffect(() => {
    setLocalPath(initialPath ?? '');
    setPathInfo(null);
    setPathErr(null);
  }, [activeProject?.id, machineKey, initialPath]);

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
      if (cloneIfMissing) {
        const exists = await agent.exists(trimmed);
        if (!exists.exists) {
          setPathInfo('cloning…');
          await agent.clone(
            `https://github.com/${activeProject.owner}/${activeProject.repo}.git`,
            trimmed,
          );
          setPathInfo('cloned');
        } else {
          setPathInfo('using existing folder');
        }
      }
      await onSetLocalPath(trimmed);
      setPathInfo((p) => (p ? `${p} · saved` : 'saved'));
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
          {pathErr && <div className="error-text">{pathErr}</div>}
          {pathInfo && <div className="login-info">{pathInfo}</div>}
          <div className="popover-actions">
            <button
              disabled={!agentInfo || !localPath.trim() || savingPath}
              onClick={() => savePath(false)}
            >
              Save path
            </button>
            <button
              className="primary"
              disabled={!agentInfo || !localPath.trim() || savingPath}
              onClick={() => savePath(true)}
              title="Clone the repo into this folder if it doesn't exist yet, then save"
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
