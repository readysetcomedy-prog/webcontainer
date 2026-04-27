import { useEffect, useMemo, useRef, useState } from 'react';
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
  onCreateLocal: (
    name: string,
    path: string,
    groupName?: string | null,
  ) => Promise<void>;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSetGroup: (id: string, groupName: string | null) => void;
  onRenameGroup: (fromName: string, toName: string) => void;
}

const UNGROUPED = '__ungrouped__';

interface ProjectGroup {
  key: string; // UNGROUPED or the actual group name
  label: string | null; // null = render as ungrouped (no header)
  projects: Project[];
}

function groupProjects(projects: Project[]): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>();
  for (const p of projects) {
    const key = p.groupName?.trim() ? p.groupName : UNGROUPED;
    const label = p.groupName?.trim() ?? null;
    let g = map.get(key);
    if (!g) {
      g = { key, label, projects: [] };
      map.set(key, g);
    }
    g.projects.push(p);
  }
  // Groups first (alphabetical), ungrouped last.
  return Array.from(map.values()).sort((a, b) => {
    if (a.key === UNGROUPED) return 1;
    if (b.key === UNGROUPED) return -1;
    return (a.label ?? '').localeCompare(b.label ?? '');
  });
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
  onSetGroup,
  onRenameGroup,
}: ProjectsSectionProps) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [addingLocal, setAddingLocal] = useState(false);
  const [localName, setLocalName] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [localGroup, setLocalGroup] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [pathStatus, setPathStatus] = useState<
    'idle' | 'checking' | 'exists' | 'missing'
  >('idle');
  const probeToken = useRef(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [groupRenameValue, setGroupRenameValue] = useState('');

  const groups = useMemo(() => groupProjects(projects), [projects]);
  const knownGroupNames = useMemo(
    () =>
      Array.from(
        new Set(
          projects
            .map((p) => p.groupName?.trim())
            .filter((g): g is string => !!g),
        ),
      ).sort(),
    [projects],
  );

  const defaultName = currentRepoKey
    ? currentBranch
      ? `${currentRepoKey.split('/')[1]} (${currentBranch})`
      : currentRepoKey.split('/')[1]
    : '';

  const startAdd = () => {
    setNewName(defaultName);
    setNewGroup('');
    setAdding(true);
  };
  const commitAdd = () => {
    const name = newName.trim();
    if (!name) return;
    onSaveCurrent(name);
    // The save flow will hit App.tsx's saveCurrentProject, which only
    // takes a name. If the user typed a group, set it after the save
    // completes. Easiest: let App look up "current" project after this
    // call returns, but we don't have its id here. Compromise: emit a
    // group-set on the active project right after.
    if (newGroup.trim() && activeId) {
      onSetGroup(activeId, newGroup.trim());
    }
    setAdding(false);
    setNewName('');
    setNewGroup('');
  };

  // Live existence probe for the local-folder path field.
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
    setLocalGroup('');
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
      await onCreateLocal(name, path, localGroup.trim() || null);
      setAddingLocal(false);
      setLocalName('');
      setLocalPath('');
      setLocalGroup('');
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

  const promptSetGroup = (p: Project) => {
    const suggestion = knownGroupNames.length > 0
      ? `Existing groups: ${knownGroupNames.join(', ')}`
      : 'Type a group name (or leave blank to ungroup)';
    const next = window.prompt(
      `Set group for "${p.name}":\n${suggestion}`,
      p.groupName ?? '',
    );
    if (next === null) return; // cancelled
    onSetGroup(p.id, next.trim() || null);
  };

  const startGroupRename = (label: string) => {
    setRenamingGroup(label);
    setGroupRenameValue(label);
  };
  const commitGroupRename = () => {
    if (!renamingGroup) return;
    const next = groupRenameValue.trim();
    if (next && next !== renamingGroup) {
      onRenameGroup(renamingGroup, next);
    } else if (next === '') {
      onRenameGroup(renamingGroup, '');
    }
    setRenamingGroup(null);
    setGroupRenameValue('');
  };

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderProjectRow = (p: Project) => {
    if (renamingId === p.id) {
      return (
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
      );
    }
    return (
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
            title={p.groupName ? `Group: ${p.groupName} — click to change` : 'Set group'}
            onClick={() => promptSetGroup(p)}
          >
            ⌃
          </button>
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
    );
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
              if (e.key === 'Escape') setAddingLocal(false);
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
          <input
            list="known-groups"
            value={localGroup}
            onChange={(e) => setLocalGroup(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pathStatus === 'exists') commitAddLocal();
              if (e.key === 'Escape') setAddingLocal(false);
            }}
            placeholder="Group (optional)"
            disabled={localBusy}
            className="project-group-input"
          />
          <datalist id="known-groups">
            {knownGroupNames.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
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
          <input
            list="known-groups"
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAdd();
              if (e.key === 'Escape') setAdding(false);
            }}
            placeholder="Group (optional)"
            className="project-group-input"
          />
          <datalist id="known-groups">
            {knownGroupNames.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
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
      {groups.map((g) => {
        const hidden = collapsed.has(g.key);
        if (g.key === UNGROUPED) {
          // No header for the ungrouped bucket.
          return (
            <div key={g.key} className="project-group ungrouped">
              {g.projects.map(renderProjectRow)}
            </div>
          );
        }
        return (
          <div key={g.key} className="project-group">
            {renamingGroup === g.label ? (
              <div className="project-group-header editing">
                <input
                  autoFocus
                  value={groupRenameValue}
                  onChange={(e) => setGroupRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitGroupRename();
                    if (e.key === 'Escape') setRenamingGroup(null);
                  }}
                  placeholder="Group name (blank to ungroup)"
                />
                <button className="icon-button" onClick={commitGroupRename}>
                  ✓
                </button>
                <button
                  className="icon-button"
                  onClick={() => setRenamingGroup(null)}
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                className="project-group-header"
                onClick={() => toggleCollapse(g.key)}
                title={hidden ? 'Expand' : 'Collapse'}
              >
                <span className="project-group-caret">{hidden ? '▸' : '▾'}</span>
                <span className="project-group-name">{g.label}</span>
                <span className="project-group-count">{g.projects.length}</span>
                <span
                  className="icon-button project-group-rename"
                  role="button"
                  tabIndex={0}
                  title="Rename group (renames every project under it)"
                  onClick={(e) => {
                    e.stopPropagation();
                    startGroupRename(g.label!);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      startGroupRename(g.label!);
                    }
                  }}
                >
                  ✎
                </span>
              </button>
            )}
            {!hidden && g.projects.map(renderProjectRow)}
          </div>
        );
      })}
    </div>
  );
}
