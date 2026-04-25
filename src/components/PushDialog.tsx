import { useEffect, useMemo, useState } from 'react';
import type { GhBranch, GhRepo } from '../lib/github';
import {
  createBranch,
  getBranchHeadSha,
  listBranches,
  listRepos,
  pushCommit,
} from '../lib/github';
import type { FileEntry } from '../types';

export interface PushDialogProps {
  token: string;
  files: FileEntry[];
  dirtyPaths: Set<string>;
  // What the parent thinks "we're working on" — pre-selects this repo and
  // branch so the common case (push to the same place I pulled from) is
  // a single click.
  initialOwner?: string | null;
  initialRepo?: string | null;
  initialBranch?: string | null;
  onClose: () => void;
  onPushed: (result: {
    owner: string;
    repo: string;
    branch: string;
    commitSha: string;
    fileCount: number;
  }) => void;
}

type Step = 'pick-repo' | 'pick-branch' | 'commit';

export default function PushDialog({
  token,
  files,
  dirtyPaths,
  initialOwner,
  initialRepo,
  initialBranch,
  onClose,
  onPushed,
}: PushDialogProps) {
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
      ? { owner: initialOwner, repo: initialRepo, defaultBranch: initialBranch ?? 'main' }
      : null,
  );

  const [branches, setBranches] = useState<GhBranch[] | null>(null);
  const [branchesErr, setBranchesErr] = useState<string | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(
    initialBranch ?? null,
  );
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchBase, setNewBranchBase] = useState<string | null>(null);

  const [step, setStep] = useState<Step>(
    initialOwner && initialRepo && initialBranch ? 'commit' : 'pick-repo',
  );

  const onlyDirty = dirtyPaths.size > 0;
  const [pushAll, setPushAll] = useState(!onlyDirty);
  const filesToPush = useMemo(() => {
    if (pushAll) return files;
    return files.filter((f) => dirtyPaths.has(f.path));
  }, [files, dirtyPaths, pushAll]);
  const [message, setMessage] = useState(() => {
    const dirtyList = files.filter((f) => dirtyPaths.has(f.path));
    if (dirtyList.length > 0 && dirtyList.length <= 3) {
      return `studio: ${dirtyList.map((f) => f.path).join(', ')}`;
    }
    return `studio: update ${dirtyList.length || files.length} file${
      (dirtyList.length || files.length) === 1 ? '' : 's'
    }`;
  });

  const [pushing, setPushing] = useState(false);
  const [pushErr, setPushErr] = useState<string | null>(null);

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
    setStep('commit');
  };

  const startCreateBranch = () => {
    setCreatingBranch(true);
    setNewBranchName('');
    setNewBranchBase(selectedRepo?.defaultBranch ?? branches?.[0]?.name ?? null);
  };

  const commitNewBranch = async () => {
    if (!selectedRepo || !newBranchName.trim() || !newBranchBase) return;
    setBranchesErr(null);
    try {
      const baseSha = await getBranchHeadSha(
        token,
        selectedRepo.owner,
        selectedRepo.repo,
        newBranchBase,
      );
      await createBranch(
        token,
        selectedRepo.owner,
        selectedRepo.repo,
        newBranchName.trim(),
        baseSha,
      );
      setSelectedBranch(newBranchName.trim());
      setCreatingBranch(false);
      setStep('commit');
    } catch (e) {
      setBranchesErr((e as Error).message);
    }
  };

  const doPush = async () => {
    if (!selectedRepo || !selectedBranch) return;
    if (filesToPush.length === 0) {
      setPushErr('No files selected to push.');
      return;
    }
    setPushing(true);
    setPushErr(null);
    try {
      const { commitSha } = await pushCommit(
        token,
        selectedRepo.owner,
        selectedRepo.repo,
        selectedBranch,
        filesToPush,
        message.trim() || `studio: update ${filesToPush.length} files`,
      );
      onPushed({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branch: selectedBranch,
        commitSha,
        fileCount: filesToPush.length,
      });
    } catch (e) {
      setPushErr((e as Error).message);
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="modal-shell" onClick={onClose}>
      <div className="modal-card push-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Push to GitHub</span>
          <button className="link-button" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="push-body">
          {/* Breadcrumb */}
          <div className="push-crumbs">
            <button
              className={`push-crumb ${step === 'pick-repo' ? 'active' : ''}`}
              onClick={() => setStep('pick-repo')}
            >
              {selectedRepo
                ? `${selectedRepo.owner}/${selectedRepo.repo}`
                : 'Pick repo'}
            </button>
            <span className="push-crumb-sep">›</span>
            <button
              className={`push-crumb ${step === 'pick-branch' ? 'active' : ''}`}
              onClick={() => selectedRepo && setStep('pick-branch')}
              disabled={!selectedRepo}
            >
              {selectedBranch ?? 'Pick branch'}
            </button>
            <span className="push-crumb-sep">›</span>
            <button
              className={`push-crumb ${step === 'commit' ? 'active' : ''}`}
              onClick={() =>
                selectedRepo && selectedBranch && setStep('commit')
              }
              disabled={!selectedRepo || !selectedBranch}
            >
              Commit
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
            <>
              {!creatingBranch ? (
                <>
                  <div className="push-list-header">
                    <span>Pick a branch in {selectedRepo.owner}/{selectedRepo.repo}</span>
                    <button className="link-button" onClick={startCreateBranch}>
                      + New branch
                    </button>
                  </div>
                  <div className="gh-list push-list">
                    {branchesLoading && (
                      <div className="gh-list-empty">Loading branches…</div>
                    )}
                    {branchesErr && (
                      <div className="error-text">{branchesErr}</div>
                    )}
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
                              <span className="gh-badge gh-badge-default">
                                default
                              </span>
                            )}
                            {b.protected && (
                              <span className="gh-badge">protected</span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="push-new-branch">
                  <label>
                    New branch name
                    <input
                      autoFocus
                      placeholder="my-feature"
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitNewBranch();
                        if (e.key === 'Escape') setCreatingBranch(false);
                      }}
                    />
                  </label>
                  <label>
                    Branch off of
                    <select
                      value={newBranchBase ?? ''}
                      onChange={(e) => setNewBranchBase(e.target.value)}
                    >
                      {branches?.map((b) => (
                        <option key={b.name} value={b.name}>
                          {b.name}
                          {b.name === selectedRepo.defaultBranch ? ' (default)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  {branchesErr && (
                    <div className="error-text">{branchesErr}</div>
                  )}
                  <div className="modal-actions">
                    <button
                      className="link-button"
                      onClick={() => setCreatingBranch(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="primary"
                      onClick={commitNewBranch}
                      disabled={!newBranchName.trim() || !newBranchBase}
                    >
                      Create branch
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {step === 'commit' && selectedRepo && selectedBranch && (
            <>
              <div className="push-summary">
                Pushing to{' '}
                <code>
                  {selectedRepo.owner}/{selectedRepo.repo}@{selectedBranch}
                </code>
              </div>

              <div className="push-files-toggle">
                <label>
                  <input
                    type="radio"
                    checked={!pushAll}
                    onChange={() => setPushAll(false)}
                    disabled={!onlyDirty}
                  />
                  Only edited files ({dirtyPaths.size})
                </label>
                <label>
                  <input
                    type="radio"
                    checked={pushAll}
                    onChange={() => setPushAll(true)}
                  />
                  All files ({files.length})
                </label>
              </div>

              <details className="push-files-list">
                <summary>
                  {filesToPush.length} file{filesToPush.length === 1 ? '' : 's'}{' '}
                  to push
                </summary>
                <div className="push-files-inner">
                  {filesToPush.slice(0, 200).map((f) => (
                    <div key={f.path} className="push-file">
                      {f.path}
                    </div>
                  ))}
                  {filesToPush.length > 200 && (
                    <div className="push-file push-file-more">
                      … and {filesToPush.length - 200} more
                    </div>
                  )}
                </div>
              </details>

              <label className="push-commit-msg">
                Commit message
                <textarea
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>

              {pushErr && <div className="error-text">{pushErr}</div>}

              <div className="modal-actions">
                <button className="link-button" onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="primary"
                  onClick={doPush}
                  disabled={pushing || filesToPush.length === 0}
                >
                  {pushing
                    ? 'Pushing…'
                    : `Push ${filesToPush.length} file${
                        filesToPush.length === 1 ? '' : 's'
                      }`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
