import { useEffect, useMemo, useRef, useState } from 'react';
import type { GhBranch, GhRepo } from '../lib/github';
import { fetchRepoFiles, listBranches, listRepos } from '../lib/github';
import type { AgentClient, AgentInfo } from '../lib/agentClient';
import type { FileEntry } from '../types';

export interface PullDialogProps {
  token: string;
  agent: AgentClient;
  agentInfo: AgentInfo;
  initialOwner?: string | null;
  initialRepo?: string | null;
  initialBranch?: string | null;
  initialPath?: string | null;
  onClose: () => void;
  onPulled: (result: {
    owner: string;
    repo: string;
    branch: string;
    path: string;
    fileCount: number;
  }) => void;
}

type Step = 'pick-repo' | 'pick-branch' | 'pick-path' | 'confirm';

function bytesToBase64(b: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin);
}

export default function PullDialog({
  token,
  agent,
  agentInfo,
  initialOwner,
  initialRepo,
  initialBranch,
  initialPath,
  onClose,
  onPulled,
}: PullDialogProps) {
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const [reposErr, setReposErr] = useState<string | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [search, setSearch] = useState('');

  const [selectedRepo, setSelectedRepo] = useState<{
    owner: string;
    repo: string;
    defaultBranch: string;
  } | null>(
    initialOwner && initialRepo
      ? {
          owner: initialOwner,
          repo: initialRepo,
          defaultBranch: initialBranch ?? 'main',
        }
      : null,
  );

  const [branches, setBranches] = useState<GhBranch[] | null>(null);
  const [branchesErr, setBranchesErr] = useState<string | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(
    initialBranch ?? null,
  );

  const [path, setPath] = useState<string>(initialPath ?? '');
  const [pathStatus, setPathStatus] = useState<
    'idle' | 'checking' | 'exists' | 'missing'
  >('idle');
  const probeToken = useRef(0);

  const [step, setStep] = useState<Step>(
    initialOwner && initialRepo && initialBranch
      ? initialPath
        ? 'confirm'
        : 'pick-path'
      : 'pick-repo',
  );

  const [pulling, setPulling] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [pullErr, setPullErr] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 'pick-repo' || repos !== null) return;
    setReposLoading(true);
    listRepos(token)
      .then((r) => setRepos(r))
      .catch((e) => setReposErr((e as Error).message))
      .finally(() => setReposLoading(false));
  }, [token, step, repos]);

  useEffect(() => {
    if (!selectedRepo) return;
    setBranches(null);
    setBranchesErr(null);
    setBranchesLoading(true);
    listBranches(token, selectedRepo.owner, selectedRepo.repo)
      .then((b) => setBranches(b))
      .catch((e) => setBranchesErr((e as Error).message))
      .finally(() => setBranchesLoading(false));
  }, [token, selectedRepo]);

  useEffect(() => {
    if (!path.trim()) {
      setPathStatus('idle');
      return;
    }
    const tk = ++probeToken.current;
    setPathStatus('checking');
    const t = setTimeout(() => {
      agent
        .exists(path.trim())
        .then((r) => {
          if (probeToken.current !== tk) return;
          setPathStatus(r.exists ? 'exists' : 'missing');
        })
        .catch(() => {
          if (probeToken.current !== tk) return;
          setPathStatus('idle');
        });
    }, 400);
    return () => clearTimeout(t);
  }, [agent, path]);

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

  const goPickBranch = (r: GhRepo) => {
    setSelectedRepo({
      owner: r.owner.login,
      repo: r.name,
      defaultBranch: r.default_branch,
    });
    setSelectedBranch(null);
    setStep('pick-branch');
  };

  const pickBranch = (name: string) => {
    setSelectedBranch(name);
    if (path.trim()) {
      setStep('confirm');
    } else {
      // Default the destination path: ~/getxsite/owner/repo
      const isWin = (agentInfo.platform ?? '').toLowerCase() === 'win32';
      const sep = isWin ? '\\' : '/';
      const home = agentInfo.home ?? (isWin ? 'C:\\Users' : '~');
      const def = selectedRepo
        ? [home, 'getxsite', selectedRepo.owner, selectedRepo.repo].join(sep)
        : '';
      if (def && !path.trim()) setPath(def);
      setStep('pick-path');
    }
  };

  const confirmPath = () => {
    setStep('confirm');
  };

  const doPull = async () => {
    if (!selectedRepo || !selectedBranch || !path.trim()) return;
    setPulling(true);
    setPullErr(null);
    setProgress({ done: 0, total: 0 });
    try {
      const fetched: FileEntry[] = await fetchRepoFiles(
        { owner: selectedRepo.owner, repo: selectedRepo.repo, ref: selectedBranch },
        token,
        (d, t) => setProgress({ done: d, total: t }),
      );
      setProgress({ done: 0, total: fetched.length });
      const root = path.trim().replace(/[\\/]+$/, '');
      const isWin = (agentInfo.platform ?? '').toLowerCase() === 'win32';
      const sep = isWin ? '\\' : '/';
      let written = 0;
      const concurrency = 6;
      let idx = 0;
      const writeOne = async (f: FileEntry) => {
        const target = `${root}${sep}${f.path.replace(/\//g, sep)}`;
        if (typeof f.content === 'string') {
          await agent.writeFile(target, f.content, 'utf-8');
        } else {
          await agent.writeFile(target, bytesToBase64(f.content), 'base64');
        }
      };
      const worker = async () => {
        while (idx < fetched.length) {
          const i = idx++;
          try {
            await writeOne(fetched[i]);
          } catch {
            // skip individual write errors so the pull keeps going
          }
          written++;
          if (written % 10 === 0) {
            setProgress({ done: written, total: fetched.length });
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, fetched.length) }, worker),
      );
      setProgress({ done: fetched.length, total: fetched.length });
      onPulled({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branch: selectedBranch,
        path: root,
        fileCount: fetched.length,
      });
    } catch (e) {
      setPullErr((e as Error).message);
    } finally {
      setPulling(false);
    }
  };

  return (
    <div className="modal-shell" onClick={pulling ? undefined : onClose}>
      <div className="modal-card push-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Pull from GitHub to your laptop</span>
          <button
            className="link-button"
            onClick={onClose}
            disabled={pulling}
          >
            ✕
          </button>
        </div>
        <div className="push-body">
          <div className="push-crumbs">
            <button
              className={`push-crumb ${step === 'pick-repo' ? 'active' : ''}`}
              onClick={() => !pulling && setStep('pick-repo')}
              disabled={pulling}
            >
              {selectedRepo
                ? `${selectedRepo.owner}/${selectedRepo.repo}`
                : 'Pick repo'}
            </button>
            <span className="push-crumb-sep">›</span>
            <button
              className={`push-crumb ${step === 'pick-branch' ? 'active' : ''}`}
              onClick={() => !pulling && selectedRepo && setStep('pick-branch')}
              disabled={!selectedRepo || pulling}
            >
              {selectedBranch ?? 'Pick branch'}
            </button>
            <span className="push-crumb-sep">›</span>
            <button
              className={`push-crumb ${step === 'pick-path' ? 'active' : ''}`}
              onClick={() =>
                !pulling && selectedRepo && selectedBranch && setStep('pick-path')
              }
              disabled={!selectedRepo || !selectedBranch || pulling}
            >
              {path.trim() ? 'Path set' : 'Pick path'}
            </button>
            <span className="push-crumb-sep">›</span>
            <button
              className={`push-crumb ${step === 'confirm' ? 'active' : ''}`}
              onClick={() =>
                !pulling &&
                selectedRepo &&
                selectedBranch &&
                path.trim() &&
                setStep('confirm')
              }
              disabled={
                !selectedRepo || !selectedBranch || !path.trim() || pulling
              }
            >
              Pull
            </button>
          </div>

          {step === 'pick-repo' && (
            <>
              <input
                className="gh-search"
                autoFocus
                placeholder="Search your repositories…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="gh-list push-list">
                {reposLoading && (
                  <div className="gh-list-empty">Loading repos…</div>
                )}
                {reposErr && <div className="error-text">{reposErr}</div>}
                {!reposLoading && !reposErr && filteredRepos.length === 0 && (
                  <div className="gh-list-empty">No repos match.</div>
                )}
                {filteredRepos.map((r) => (
                  <button
                    key={r.id}
                    className="gh-row"
                    onClick={() => goPickBranch(r)}
                  >
                    <img
                      src={r.owner.avatar_url}
                      className="gh-row-avatar"
                      alt=""
                    />
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

          {step === 'pick-branch' && selectedRepo && (
            <div className="gh-list push-list">
              {branchesLoading && (
                <div className="gh-list-empty">Loading branches…</div>
              )}
              {branchesErr && <div className="error-text">{branchesErr}</div>}
              {branches?.map((b) => (
                <button
                  key={b.name}
                  className="gh-row"
                  onClick={() => pickBranch(b.name)}
                >
                  <div className="gh-row-main">
                    <div className="gh-row-name">
                      {b.name}
                      {b.name === selectedRepo.defaultBranch && (
                        <span className="gh-badge gh-badge-default">default</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 'pick-path' && (
            <div className="push-new-branch">
              <label>
                Folder on this laptop
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    autoFocus
                    placeholder={
                      (agentInfo.platform ?? '').toLowerCase() === 'win32'
                        ? 'C:\\Users\\you\\projects\\my-repo'
                        : '~/projects/my-repo'
                    }
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && path.trim()) confirmPath();
                    }}
                    style={{ flex: 1 }}
                  />
                  <span
                    className={`path-status path-status-${pathStatus}`}
                    title={
                      pathStatus === 'exists'
                        ? 'Folder already exists — pulling will overwrite files.'
                        : pathStatus === 'missing'
                        ? "Folder doesn't exist yet — it will be created."
                        : ''
                    }
                  >
                    {pathStatus === 'exists'
                      ? '✓'
                      : pathStatus === 'missing'
                      ? '+'
                      : pathStatus === 'checking'
                      ? '⟳'
                      : ''}
                  </span>
                </div>
              </label>
              {pathStatus === 'exists' && (
                <div className="warn-text">
                  This folder already exists. Pulling will <b>overwrite</b> any
                  file the repo also has. Files only on disk are left alone.
                </div>
              )}
              <div className="modal-actions">
                <button className="link-button" onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="primary"
                  onClick={confirmPath}
                  disabled={!path.trim() || pathStatus === 'checking'}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 'confirm' && selectedRepo && selectedBranch && (
            <>
              <div className="push-summary">
                Pulling{' '}
                <code>
                  {selectedRepo.owner}/{selectedRepo.repo}@{selectedBranch}
                </code>{' '}
                into{' '}
                <code>{path}</code>
              </div>
              {pathStatus === 'exists' && !pulling && (
                <div className="warn-text">
                  Existing folder will have its files overwritten where the
                  repo has matching paths. Untracked files on disk are left
                  alone.
                </div>
              )}
              {progress && pulling && (
                <div className="push-progress">
                  {progress.total === 0
                    ? `Fetching from GitHub… ${progress.done} files`
                    : `Writing to disk: ${progress.done} / ${progress.total}`}
                </div>
              )}
              {pullErr && <div className="error-text">{pullErr}</div>}
              <div className="modal-actions">
                <button
                  className="link-button"
                  onClick={onClose}
                  disabled={pulling}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  onClick={doPull}
                  disabled={pulling}
                >
                  {pulling ? 'Pulling…' : 'Pull to disk'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
