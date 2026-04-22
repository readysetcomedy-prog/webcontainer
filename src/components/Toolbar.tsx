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
  const [repo, setRepo] = useState('vitejs/vite');
  const [ghToken, setGhToken] = useState(
    () => localStorage.getItem('github_token') ?? '',
  );
  const [netlifyToken, setNetlifyToken] = useState(
    () => localStorage.getItem('netlify_token') ?? '',
  );
  const [siteId, setSiteId] = useState(
    () => localStorage.getItem('netlify_site_id') ?? '',
  );

  return (
    <div className="toolbar">
      <div className="brand">WebContainer Studio</div>
      <div className="toolbar-actions">
        <button onClick={() => setRepoOpen((v) => !v)} disabled={booting}>
          Pull from GitHub
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
          <label>
            Repo (<code>owner/repo</code>, <code>owner/repo@branch</code>, or full URL)
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="vitejs/vite"
            />
          </label>
          <label>
            GitHub token <em>(optional, for private repos + rate limits)</em>
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
          <div className="popover-actions">
            <button
              onClick={() => {
                onLoadRepo(repo, ghToken);
                setRepoOpen(false);
              }}
            >
              Pull
            </button>
            <button onClick={() => setRepoOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {deployOpen && (
        <div className="popover">
          <label>
            Netlify personal access token
            <input
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
            Netlify site id <em>(blank to create new site)</em>
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
            <button
              onClick={() => {
                onDeploy(netlifyToken, siteId);
                setDeployOpen(false);
              }}
            >
              Deploy
            </button>
            <button onClick={() => setDeployOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
