import { useState } from 'react';

export interface ToolbarProps {
  booting: boolean;
  running: boolean;
  onLoadRepo: (repo: string, token: string) => void;
  onRun: () => void;
  onStop: () => void;
  onDeploy: (token: string, siteId: string) => void;
}

export default function Toolbar({
  booting,
  running,
  onLoadRepo,
  onRun,
  onStop,
  onDeploy,
}: ToolbarProps) {
  const [repoOpen, setRepoOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [repo, setRepo] = useState('https://github.com/vitejs/vite');
  const [ghToken, setGhToken] = useState(
    () => localStorage.getItem('github_token') ?? '',
  );
  const [netlifyToken, setNetlifyToken] = useState(
    () => localStorage.getItem('netlify_token') ?? '',
  );
  const [siteId, setSiteId] = useState(
    () => localStorage.getItem('netlify_site_id') ?? '',
  );

  const submitRepo = () => {
    if (!repo.trim()) return;
    onLoadRepo(repo, ghToken);
    setRepoOpen(false);
  };

  return (
    <div className="toolbar">
      <div className="brand">WebContainer Studio</div>
      <div className="toolbar-actions">
        <button onClick={() => setRepoOpen((v) => !v)} disabled={booting}>
          Open from GitHub
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
      </div>
      {repoOpen && (
        <div className="popover">
          <div className="popover-title">Open a GitHub repo</div>
          <div className="popover-hint">
            Paste the GitHub URL of the project you want to open. We'll download
            it, install the dependencies, and start it up automatically.
          </div>
          <label>
            GitHub URL
            <input
              autoFocus
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRepo();
              }}
              placeholder="https://github.com/vitejs/vite"
            />
          </label>
          <button
            className="link-button"
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            {advancedOpen ? 'Hide' : 'Show'} advanced options
          </button>
          {advancedOpen && (
            <label>
              GitHub personal access token
              <span className="hint-text">
                Only needed for private repos or to avoid GitHub rate limits.
                Stored locally in your browser.
              </span>
              <input
                type="password"
                value={ghToken}
                onChange={(e) => {
                  setGhToken(e.target.value);
                  localStorage.setItem('github_token', e.target.value);
                }}
                placeholder="ghp_..."
              />
            </label>
          )}
          <div className="popover-actions">
            <button onClick={() => setRepoOpen(false)}>Cancel</button>
            <button className="primary" onClick={submitRepo}>
              Open &amp; Run
            </button>
          </div>
        </div>
      )}
      {deployOpen && (
        <div className="popover">
          <div className="popover-title">Deploy to Netlify</div>
          <div className="popover-hint">
            Builds the project and uploads the result to Netlify. Paste a Netlify
            personal access token below. Leave the site id blank to create a new
            site.
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
