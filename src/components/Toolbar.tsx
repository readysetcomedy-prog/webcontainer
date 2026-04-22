import { useState } from 'react';
import type { GhUser } from '../lib/github';
import GitHubPanel from './GitHubPanel';

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
}: ToolbarProps) {
  const [ghOpen, setGhOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [netlifyToken, setNetlifyToken] = useState(
    () => localStorage.getItem('netlify_token') ?? '',
  );
  const [siteId, setSiteId] = useState(
    () => localStorage.getItem('netlify_site_id') ?? '',
  );

  const connected = !!(token && user);

  return (
    <div className="toolbar">
      <div className="brand">WebContainer Studio</div>
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
              onChange={(e) => {
                setNetlifyToken(e.target.value);
                localStorage.setItem('netlify_token', e.target.value);
              }}
              placeholder="nfp_..."
            />
          </label>
          <label>
            Netlify site id
            <span className="hint-text">Leave blank to create a new site.</span>
            <input
              value={siteId}
              onChange={(e) => {
                setSiteId(e.target.value);
                localStorage.setItem('netlify_site_id', e.target.value);
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
