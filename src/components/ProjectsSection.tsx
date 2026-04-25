import { useEffect, useRef, useState } from 'react';
import type { Project } from '../lib/projects';
import type { AgentClient, AgentInfo } from '../lib/agentClient';

export interface ProjectsSectionProps {
  projects: Project[];
  activeId: string | null;
  canSave: boolean;
  currentRepoKey: string | null;
  currentBranch: string | null;
  agent: AgentClient | null;
  agentInfo: AgentInfo | null;
  onOpen: (project: Project) => void;
  onSaveCurrent: (name: string) => void;
  onCreateLocal: (name: string, path: string) => Promise<void>;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export default function ProjectsSection({
  projects,
  activeId,
  canSave,
  currentRepoKey,
  currentBranch,
  agent,
  agentInfo,
  onOpen,
  onSaveCurrent,
  onCreateLocal,
  onRename,
  onDelete,
}: ProjectsSectionProps) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [addingLocal, setAddingLocal] = useState(false);
  const [localName, setLocalName] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [pathStatus, setPathStatus] = useState<
    'idle' | 'checking' | 'exists' | 'missing'
  >('idle');
  const probeToken = useRef(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const defaultName = currentRepoKey
    ? currentBranch
      ? `${currentRepoKey.split('/')[1]} (${currentBranch})`
      : currentRepoKey.split('/')[1]
    : '';

  const startAdd = () => {
    setNewName(defaultName);
    setAdding(true);
  };
  const commitAdd = () => {
    const name = newName.trim();
    if (name) onSaveCurrent(name);
    setAdding(false);
    setNewName('');
  };

  // Live existence probe for the local-folder path field — same UX as
  // the AgentPanel's path input.
  useEffect(() => {
    if (!agent || !agentInfo || !addingLocal) {
      setPathStatus('idle');
      return;
    }
    const trimmed = localPath.trim();
    if (!trimmed) {
      setPathStatus('idle');
      return;
    }
    const token = ++probeToken.current;
    setPathStatus('checking');
    const t = setTimeout(() => {
      agent
        .exists(trimmed)
        .then((r) => {
          if (probeToken.current !== token) return;
          setPathStatus(r.exists ? 'exists' : 'missing');
        })
        .catch(() => {
          if (probeToken.current !== token) return;
          setPathStatus('idle');
        });
    }, 400);
    return () => clearTimeout(t);
  }, [agent, agentInfo, addingLocal, localPath]);

  const startAddLocal = () => {
    setLocalName('');
    setLocalPath('');
    setLocalErr(null);
    setAddingLocal(true);
  };
  const commitAddLocal = async () => {
    const name = localName.trim();
    const path = localPath.trim();
    if (!name || !path) return;
    setLocalBusy(true);
    setLocalErr(null);
    try {
      await onCreateLocal(name, path);
      setAddingLocal(false);
      setLocalName('');
      setLocalPath('');
    } catch (e) {
      setLocalErr((e as Error).message);
    } finally {
      setLocalBusy(false);
    }
  };

  const startRename = (p: Project) => {
    setRenamingId(p.id);
    setRenameValue(p.name);
  };
  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue.trim());
    setRenamingId(null);
    setRenameValue('');
  };

  return (
    <div className="projects-section">
      <div className="projects-header">
        <span>Projects</span>
        <button
          className="icon-button"
          title={
            agentInfo
              ? 'Open a folder on your laptop as a project'
              : 'Connect the local agent first'
          }
          onClick={startAddLocal}
          disabled={!agentInfo || addingLocal}
        >
          ▣
        </button>
        <button
          className="icon-button"
          title={canSave ? 'Save current repo as project' : 'Open a repo first'}
          onClick={startAdd}
          disabled={!canSave}
        >
          +
        </button>
      </div>
      {addingLocal && (
        <div className="project-row editing project-row-local">
          <input
            autoFocus
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAddingLocal(false);
              }
            }}
            placeholder="Project name (e.g. medicgame)"
            disabled={localBusy}
          />
          <input
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pathStatus === 'exists') commitAddLocal();
              if (e.key === 'Escape') setAddingLocal(false);
            }}
            placeholder={
              (agentInfo?.platform ?? '').toLowerCase() === 'win32'
                ? 'C:\\Users\\you\\projects\\medicgame'
                : '~/projects/medicgame'
            }
            disabled={localBusy}
          />
          <span
            className={`path-status path-status-${pathStatus}`}
            title={
              pathStatus === 'exists'
                ? 'Folder exists'
                : pathStatus === 'missing'
                ? "Folder doesn't exist on your laptop"
                : pathStatus === 'checking'
                ? 'Checking…'
                : ''
            }
          >
            {pathStatus === 'exists'
              ? '✓'
              : pathStatus === 'missing'
              ? '✗'
              : pathStatus === 'checking'
              ? '⟳'
              : ''}
          </span>
          <button
            className="icon-button"
            onClick={commitAddLocal}
            disabled={
              localBusy ||
              !localName.trim() ||
              !localPath.trim() ||
              pathStatus !== 'exists'
            }
            title={
              pathStatus === 'exists'
                ? 'Open this folder as a project'
                : 'Path must exist on your laptop'
            }
          >
            {localBusy ? '…' : '✓'}
          </button>
          <button
            className="icon-button"
            onClick={() => setAddingLocal(false)}
            disabled={localBusy}
            title="Cancel"
          >
            ✕
          </button>
          {localErr && <div className="project-local-err">{localErr}</div>}
        </div>
      )}
      {adding && (
        <div className="project-row editing">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAdd();
              if (e.key === 'Escape') {
                setAdding(false);
                setNewName('');
              }
            }}
            placeholder="Project name"
          />
          <button className="icon-button" onClick={commitAdd} title="Save">
            ✓
          </button>
          <button
            className="icon-button"
            onClick={() => setAdding(false)}
            title="Cancel"
          >
            ✕
          </button>
        </div>
      )}
      {projects.length === 0 && !adding && (
        <div className="projects-empty">
          {canSave
            ? 'Click + to save this repo as a project.'
            : 'Open a repo to create a project.'}
        </div>
      )}
      {projects.map((p) =>
        renamingId === p.id ? (
          <div key={p.id} className="project-row editing">
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenamingId(null);
              }}
            />
            <button className="icon-button" onClick={commitRename}>
              ✓
            </button>
            <button className="icon-button" onClick={() => setRenamingId(null)}>
              ✕
            </button>
          </div>
        ) : (
          <div
            key={p.id}
            className={`project-row ${activeId === p.id ? 'active' : ''}`}
          >
            <button
              className="project-main"
              onClick={() => onOpen(p)}
              title={
                p.owner && p.repo
                  ? `Open ${p.owner}/${p.repo}${p.branch ? `@${p.branch}` : ''}`
                  : `Open ${p.localPath ?? p.name} (local folder)`
              }
            >
              <div className="project-name">{p.name}</div>
              <div className="project-meta">
                {p.owner && p.repo ? (
                  <>
                    <span className="project-icon" title="Backed by a GitHub repo">⌥</span>
                    {p.owner}/{p.repo}
                    {p.branch && <span className="project-branch">@{p.branch}</span>}
                  </>
                ) : (
                  <>
                    <span className="project-icon" title="Local folder only">▣</span>
                    <span className="project-local-path">
                      {p.localPath ?? '(no path set)'}
                    </span>
                  </>
                )}
              </div>
            </button>
            <div className="project-actions">
              <button
                className="icon-button"
                title="Rename"
                onClick={() => startRename(p)}
              >
                ✎
              </button>
              <button
                className="icon-button"
                title="Delete"
                onClick={() => {
                  if (confirm(`Delete project "${p.name}"?`)) onDelete(p.id);
                }}
              >
                🗑
              </button>
            </div>
          </div>
        ),
      )}
    </div>
  );
}
