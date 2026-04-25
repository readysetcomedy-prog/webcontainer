import { useState } from 'react';
import type { Project } from '../lib/projects';

export interface ProjectsSectionProps {
  projects: Project[];
  activeId: string | null;
  canSave: boolean;
  currentRepoKey: string | null;
  currentBranch: string | null;
  onOpen: (project: Project) => void;
  onSaveCurrent: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export default function ProjectsSection({
  projects,
  activeId,
  canSave,
  currentRepoKey,
  currentBranch,
  onOpen,
  onSaveCurrent,
  onRename,
  onDelete,
}: ProjectsSectionProps) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
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
          title={canSave ? 'Save current as project' : 'Open a repo first'}
          onClick={startAdd}
          disabled={!canSave}
        >
          +
        </button>
      </div>
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
