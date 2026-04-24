import { useEffect, useRef, useState } from 'react';
import { listBranches } from '../lib/github';
import type { GhBranch } from '../lib/github';

export interface BranchPickerProps {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  onPick: (branch: string) => void;
}

export default function BranchPicker({
  token,
  owner,
  repo,
  branch,
  onPick,
}: BranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<GhBranch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || !token) return;
    setBranches(null);
    setError(null);
    setLoading(true);
    listBranches(token, owner, repo)
      .then((b) => setBranches(b))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, token, owner, repo]);

  const filtered =
    branches?.filter((b) =>
      b.name.toLowerCase().includes(filter.trim().toLowerCase()),
    ) ?? [];

  return (
    <div className="branch-picker" ref={rootRef}>
      <button
        className="branch-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        title={`Branch: ${branch}`}
      >
        <span className="branch-picker-icon">⎇</span>
        <span className="branch-picker-name">{branch}</span>
        <span className="chevron">▾</span>
      </button>
      {open && (
        <div className="branch-picker-menu">
          <input
            className="branch-picker-search"
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter branches…"
          />
          <div className="branch-picker-list">
            {loading && <div className="branch-picker-empty">Loading…</div>}
            {error && <div className="error-text">{error}</div>}
            {!loading &&
              !error &&
              filtered.length === 0 &&
              branches !== null && (
                <div className="branch-picker-empty">No branches match.</div>
              )}
            {filtered.map((b) => (
              <button
                key={b.name}
                className={`branch-picker-row ${b.name === branch ? 'active' : ''}`}
                onClick={() => {
                  setOpen(false);
                  if (b.name !== branch) onPick(b.name);
                }}
              >
                {b.name}
                {b.name === branch && (
                  <span className="branch-picker-current">current</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
