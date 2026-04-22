import { useEffect, useMemo, useState } from 'react';
import type { GhBranch, GhRepo, GhUser } from '../lib/github';
import { getUser, listBranches, listRepos } from '../lib/github';

const TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=repo&description=WebContainer+Studio';

export interface GitHubPanelProps {
  token: string;
  user: GhUser | null;
  onConnect: (token: string, user: GhUser) => void;
  onDisconnect: () => void;
  onSelect: (owner: string, repo: string, branch: string) => void;
  onOpenUrl: (url: string) => void;
}

export default function GitHubPanel({
  token,
  user,
  onConnect,
  onDisconnect,
  onSelect,
  onOpenUrl,
}: GitHubPanelProps) {
  const [tokenInput, setTokenInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GhRepo | null>(null);
  const [branches, setBranches] = useState<GhBranch[] | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');

  useEffect(() => {
    if (!token || !user || repos !== null) return;
    setLoadingRepos(true);
    listRepos(token)
      .then((r) => setRepos(r))
      .catch((e) => setReposError((e as Error).message))
      .finally(() => setLoadingRepos(false));
  }, [token, user, repos]);

  useEffect(() => {
    if (!token || !selectedRepo) return;
    setBranches(null);
    setBranchesError(null);
    setLoadingBranches(true);
    listBranches(token, selectedRepo.owner.login, selectedRepo.name)
      .then((b) => setBranches(b))
      .catch((e) => setBranchesError((e as Error).message))
      .finally(() => setLoadingBranches(false));
  }, [token, selectedRepo]);

  const filteredRepos = useMemo(() => {
    if (!repos) return [];
    const q = search.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q),
    );
  }, [repos, search]);

  const connect = async () => {
    const t = tokenInput.trim();
    if (!t) return;
    setConnecting(true);
    setError(null);
    try {
      const u = await getUser(t);
      onConnect(t, u);
      setTokenInput('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  if (!token || !user) {
    return (
      <div className="popover gh-panel">
        <div className="popover-title">Connect GitHub</div>
        <div className="popover-hint">
          One-time setup: generate a personal access token, paste it here, and
          you'll get a searchable picker for all your repos and branches. Token
          stays in your browser — it is never sent to any server.
        </div>
        <ol className="steps">
          <li>
            <a
              href={TOKEN_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open GitHub token page (scopes pre-filled)
            </a>
          </li>
          <li>Click <b>Generate token</b> and copy the result.</li>
          <li>Paste below and hit <b>Connect</b>.</li>
        </ol>
        <label>
          Personal access token
          <input
            autoFocus
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') connect();
            }}
            placeholder="ghp_... or github_pat_..."
          />
        </label>
        {error && <div className="error-text">{error}</div>}
        <div className="popover-actions">
          <button
            className="primary"
            disabled={connecting || !tokenInput.trim()}
            onClick={connect}
          >
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="popover gh-panel">
      <div className="gh-user">
        <img src={user.avatar_url} alt="" className="gh-avatar" />
        <div className="gh-user-info">
          <div className="gh-user-name">{user.name ?? user.login}</div>
          <div className="gh-user-login">@{user.login}</div>
        </div>
        <button className="link-button" onClick={onDisconnect}>
          Sign out
        </button>
      </div>

      {!selectedRepo && (
        <>
          <input
            className="gh-search"
            placeholder="Search your repositories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="gh-list">
            {loadingRepos && <div className="gh-list-empty">Loading repos…</div>}
            {reposError && <div className="error-text">{reposError}</div>}
            {!loadingRepos && !reposError && filteredRepos.length === 0 && (
              <div className="gh-list-empty">No repos match.</div>
            )}
            {filteredRepos.map((r) => (
              <button
                key={r.id}
                className="gh-row"
                onClick={() => setSelectedRepo(r)}
              >
                <img src={r.owner.avatar_url} className="gh-row-avatar" alt="" />
                <div className="gh-row-main">
                  <div className="gh-row-name">
                    {r.full_name}
                    {r.private && <span className="gh-badge">private</span>}
                  </div>
                  {r.description && (
                    <div className="gh-row-desc">{r.description}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {selectedRepo && (
        <>
          <div className="gh-breadcrumb">
            <button className="link-button" onClick={() => setSelectedRepo(null)}>
              ← Back to repos
            </button>
            <span className="gh-breadcrumb-name">{selectedRepo.full_name}</span>
          </div>
          <div className="gh-list">
            {loadingBranches && <div className="gh-list-empty">Loading branches…</div>}
            {branchesError && <div className="error-text">{branchesError}</div>}
            {branches?.map((b) => (
              <button
                key={b.name}
                className="gh-row"
                onClick={() =>
                  onSelect(selectedRepo.owner.login, selectedRepo.name, b.name)
                }
              >
                <div className="gh-row-main">
                  <div className="gh-row-name">
                    {b.name}
                    {b.name === selectedRepo.default_branch && (
                      <span className="gh-badge gh-badge-default">default</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <details className="gh-url-fallback">
        <summary>Or paste a GitHub URL</summary>
        <div className="gh-url-row">
          <input
            placeholder="https://github.com/owner/repo/tree/branch"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && urlInput.trim()) onOpenUrl(urlInput);
            }}
          />
          <button
            onClick={() => urlInput.trim() && onOpenUrl(urlInput)}
            disabled={!urlInput.trim()}
          >
            Open
          </button>
        </div>
      </details>
    </div>
  );
}
