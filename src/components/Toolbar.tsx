import { useEffect, useRef, useState } from 'react';
import type { GhUser } from '../lib/github';
import GitHubPanel from './GitHubPanel';
import EnvPanel from './EnvPanel';
import AgentPanel from './AgentPanel';
import ActionsPanel from './ActionsPanel';
import BranchPicker from './BranchPicker';
import type { AgentClient, AgentInfo } from '../lib/agentClient';
import type { Project } from '../lib/projects';

export interface ToolbarProps {
  booting: boolean;
  running: boolean;
  token: string;
  user: GhUser | null;
  onConnect: (token: string, user: GhUser) => void;
  onDisconnect: () => void;
  onSelectBranch: (owner: string, repo: string, branch: string) => void;
  onOpenUrl: (url: string) => void;
  onRun: () => void;
  onStop: () => void;
  onDeploy: (token: string, siteId: string) => void;
  repoKey: string | null;
  envContent: string;
  exampleEnv: string | null;
  onSaveEnv: (content: string, restart: boolean) => void;
  defaultNetlifySiteId: string;
  onSaveNetlifySiteId: (value: string) => void;
  netlifyToken: string;
  onSaveNetlifyToken: (value: string) => void;
  dirtyCount: number;
  onPushToGitHub: () => void;
  onPullFromGitHub: () => void;
  onDownload: () => void;
  canDownload: boolean;
  userEmail: string;
  userId: string;
  onSignOut: () => void;
  agentInfo: AgentInfo | null;
  agent: AgentClient | null;
  activeProject: Project | null;
  onSetLocalPath: (path: string) => Promise<void>;
  onBuildExpo: (platform: 'ios' | 'android') => void;
  log: (text: string, kind?: 'info' | 'err' | 'out') => void;
  notify: (kind: 'info' | 'success' | 'error', message: string) => void;
  onOpenSettings: () => void;
  onStartTour: () => void;
  currentBranch: string | null;
}

export default function Toolbar({
  booting,
  running,
  token,
  user,
  onConnect,
  onDisconnect,
  onSelectBranch,
  onOpenUrl,
  onRun,
  onStop,
  onDeploy,
  repoKey,
  envContent,
  exampleEnv,
  onSaveEnv,
  defaultNetlifySiteId,
  onSaveNetlifySiteId,
  netlifyToken,
  onSaveNetlifyToken,
  dirtyCount,
  onPushToGitHub,
  onPullFromGitHub,
  onDownload,
  canDownload,
  userEmail,
  userId,
  onSignOut,
  agentInfo,
  agent,
  activeProject,
  onSetLocalPath,
  onBuildExpo,
  log,
  notify,
  onOpenSettings,
  onStartTour,
  currentBranch,
}: ToolbarProps) {
  const [ghOpen, setGhOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const autoOpenedKeyRef = useRef<string>('');
  const hostname = agentInfo?.host;
  const hasPathForThisMachine = !!(
    activeProject &&
    hostname &&
    (activeProject.pathsByMachine?.[hostname] || activeProject.localPath)
  );
  useEffect(() => {
    if (!hostname || !activeProject) return;
    const key = `${activeProject.id}@${hostname}`;
    if (autoOpenedKeyRef.current === key) return;
    if (!hasPathForThisMachine) {
      autoOpenedKeyRef.current = key;
      setAgentOpen(true);
    }
  }, [hostname, activeProject?.id, hasPathForThisMachine, activeProject]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [siteId, setSiteId] = useState(defaultNetlifySiteId);

  useEffect(() => {
    setSiteId(defaultNetlifySiteId);
  }, [defaultNetlifySiteId]);

  const connected = !!(token && user);

  return (
    <div className="toolbar">
      <div className="brand" data-tour="brand">
        GetXsite.com
        {agentInfo && activeProject?.localPath && (
          <span className="brand-mode" title={`Files on ${agentInfo.host}: ${activeProject.localPath}`}>
            local mode
          </span>
        )}
      </div>
      {activeProject && token && currentBranch && (
        <div data-tour="branch-picker">
          <BranchPicker
            token={token}
            owner={activeProject.owner}
            repo={activeProject.repo}
            branch={currentBranch}
            onPick={(b) =>
              onSelectBranch(activeProject.owner, activeProject.repo, b)
            }
          />
        </div>
      )}
      <div className="toolbar-actions">
        {connected ? (
          <button
            className="user-chip"
            data-tour="btn-github"
            onClick={() => setGhOpen((v) => !v)}
            disabled={booting}
            title="Browse repos and branches"
          >
            <img src={user!.avatar_url} alt="" className="user-chip-avatar" />
            <span>{user!.login}</span>
            <span className="chevron">▾</span>
          </button>
        ) : (
          <button
            data-tour="btn-github"
            onClick={() => setGhOpen((v) => !v)}
            disabled={booting}
          >
            Connect GitHub
          </button>
        )}
        <button
          data-tour="btn-env"
          onClick={() => setEnvOpen((v) => !v)}
          disabled={booting || !repoKey}
          title={
            repoKey ? `Env vars for ${repoKey}` : 'Open a repo first to edit env vars'
          }
        >
          Env vars
          {envContent && <span className="dot" />}
        </button>
        <button
          data-tour="btn-pull"
          onClick={onPullFromGitHub}
          disabled={booting || !repoKey}
          title={
            repoKey
              ? `Pull latest from ${repoKey}`
              : 'Open a repo first to pull from GitHub'
          }
        >
          Pull
        </button>
        <button
          data-tour="btn-push"
          onClick={onPushToGitHub}
          disabled={booting || !repoKey || !token || dirtyCount === 0}
          title={
            !token
              ? 'Connect GitHub to push'
              : !repoKey
              ? 'Open a repo first to push'
              : dirtyCount === 0
              ? 'No local edits to push'
              : `Push ${dirtyCount} file${dirtyCount === 1 ? '' : 's'} to GitHub`
          }
        >
          Push
          {dirtyCount > 0 && <span className="count-badge">{dirtyCount}</span>}
        </button>
        <button
          data-tour="btn-download"
          onClick={onDownload}
          disabled={booting || !canDownload}
          title={
            canDownload
              ? 'Download the project as a ZIP, including .env.local'
              : 'Open a repo first'
          }
        >
          Download
        </button>
        {running ? (
          <button onClick={onStop}>Stop</button>
        ) : (
          <button onClick={onRun} disabled={booting}>
            Run
          </button>
        )}
        <button
          data-tour="btn-deploy"
          onClick={() => setDeployOpen((v) => !v)}
          disabled={booting}
        >
          Deploy to Netlify
        </button>
        {agentInfo && activeProject?.localPath && (
          <>
            <button
              onClick={() => onBuildExpo('ios')}
              title="Run eas build --platform ios on your laptop"
            >
              Build iOS
            </button>
            <button
              onClick={() => onBuildExpo('android')}
              title="Run eas build --platform android on your laptop"
            >
              Build Android
            </button>
          </>
        )}
        <button
          data-tour="btn-actions"
          onClick={() => setActionsOpen((v) => !v)}
          disabled={!agentInfo || !activeProject?.localPath}
          title={
            agentInfo && activeProject?.localPath
              ? 'Quick actions (test, lint, build…)'
              : 'Actions need agent + local path'
          }
        >
          Actions
        </button>
        <button
          data-tour="btn-agent"
          onClick={() => setAgentOpen((v) => !v)}
          title={
            agentInfo ? `Local agent: ${agentInfo.host}` : 'Local agent setup'
          }
        >
          Agent
          <span className={`agent-pill ${agentInfo ? 'on' : 'off'}`}>
            {agentInfo ? 'on' : 'off'}
          </span>
        </button>
        <button
          data-tour="btn-tutorial"
          onClick={onStartTour}
          title="Take a guided tour of the studio"
        >
          Tutorial
        </button>
        <button
          data-tour="btn-settings"
          onClick={onOpenSettings}
          title="Account & token settings"
        >
          Settings
        </button>
        <button
          className="signout-button"
          onClick={onSignOut}
          title={userEmail ? `Signed in as ${userEmail} — click to sign out` : 'Sign out'}
        >
          Sign out
        </button>
      </div>
      {ghOpen && (
        <GitHubPanel
          token={token}
          user={user}
          onConnect={(t, u) => {
            onConnect(t, u);
          }}
          onDisconnect={() => {
            onDisconnect();
          }}
          onSelect={(owner, repo, branch) => {
            setGhOpen(false);
            onSelectBranch(owner, repo, branch);
          }}
          onOpenUrl={(url) => {
            setGhOpen(false);
            onOpenUrl(url);
          }}
        />
      )}
      {envOpen && (
        <EnvPanel
          repoKey={repoKey}
          initialContent={envContent}
          exampleContent={exampleEnv}
          onSave={(content, restart) => {
            onSaveEnv(content, restart);
            setEnvOpen(false);
          }}
          onClose={() => setEnvOpen(false)}
        />
      )}
      {agentOpen && (
        <AgentPanel
          userId={userId}
          agentInfo={agentInfo}
          agent={agent}
          activeProject={activeProject}
          onSetLocalPath={onSetLocalPath}
        />
      )}
      {actionsOpen && (
        <ActionsPanel
          agent={agent}
          agentInfo={agentInfo}
          activeProject={activeProject}
          log={log}
          notify={notify}
          onClose={() => setActionsOpen(false)}
        />
      )}
      {deployOpen && (
        <div className="popover">
          <div className="popover-title">Deploy to Netlify</div>
          <div className="popover-hint">
            Builds the project and uploads the result to Netlify. Paste a
            Netlify personal access token below. Leave the site id blank to
            create a new site.
          </div>
          <label>
            Netlify personal access token
            <input
              autoFocus
              type="password"
              value={netlifyToken}
              onChange={(e) => onSaveNetlifyToken(e.target.value)}
              placeholder="nfp_..."
            />
          </label>
          <label>
            Netlify site id
            <span className="hint-text">
              Leave blank to create a new site.
              {repoKey
                ? ' Saved per project; next deploy will update this site.'
                : ''}
            </span>
            <input
              value={siteId}
              onChange={(e) => {
                setSiteId(e.target.value);
                onSaveNetlifySiteId(e.target.value);
              }}
              placeholder="optional"
            />
          </label>
          <div className="popover-actions">
            <button onClick={() => setDeployOpen(false)}>Cancel</button>
            <button
              className="primary"
              onClick={() => {
                onDeploy(netlifyToken, siteId);
                setDeployOpen(false);
              }}
            >
              Deploy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
