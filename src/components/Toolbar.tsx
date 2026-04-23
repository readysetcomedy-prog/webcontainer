import { useEffect, useState } from 'react';
import type { GhUser } from '../lib/github';
import GitHubPanel from './GitHubPanel';
import EnvPanel from './EnvPanel';

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
  userEmail: string;
  onSignOut: () => void;
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
  userEmail,
  onSignOut,
}: ToolbarProps) {
  const [ghOpen, setGhOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [siteId, setSiteId] = useState(defaultNetlifySiteId);

  useEffect(() => {
    setSiteId(defaultNetlifySiteId);
  }, [defaultNetlifySiteId]);

  const connected = !!(token && user);

  return (
    <div className="toolbar">
      <div className="brand">GetXsite.com</div>
      <div className="toolbar-actions">
        {connected ? (
          <button
            className="user-chip"
            onClick={() => setGhOpen((v) => !v)}
            disabled={booting}
            title="Browse repos and branches"
          >
            <img src={user!.avatar_url} alt="" className="user-chip-avatar" />
            <span>{user!.login}</span>
            <span className="chevron">▾</span>
          </button>
        ) : (
          <button onClick={() => setGhOpen((v) => !v)} disabled={booting}>
            Connect GitHub
          </button>
        )}
        <button
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
        {running ? (
          <button onClick={onStop}>Stop</button>
        ) : (
          <button onClick={onRun} disabled={booting}>
            Run
          </button>
        )}
        <button onClick={() => setDeployOpen((v) => !v)} disabled={booting}>
          Deploy to Netlify
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
