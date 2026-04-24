import type { AgentClient, AgentInfo } from '../lib/agentClient';
import type { Project } from '../lib/projects';

type Kind = 'info' | 'success' | 'error';

export interface ActionsPanelProps {
  agent: AgentClient | null;
  agentInfo: AgentInfo | null;
  activeProject: Project | null;
  log: (text: string, kind?: 'info' | 'err' | 'out') => void;
  notify: (kind: Kind, message: string) => void;
  onClose: () => void;
}

interface Action {
  label: string;
  desc: string;
  command: string;
  args: string[];
  confirm?: string;
}

const ACTIONS: Action[] = [
  {
    label: 'Install deps',
    desc: 'npm install',
    command: 'npm',
    args: ['install'],
  },
  {
    label: 'Run tests',
    desc: 'npm test',
    command: 'npm',
    args: ['test'],
  },
  {
    label: 'Lint',
    desc: 'npm run lint',
    command: 'npm',
    args: ['run', 'lint'],
  },
  {
    label: 'Format',
    desc: 'npm run format',
    command: 'npm',
    args: ['run', 'format'],
  },
  {
    label: 'Type check',
    desc: 'npm run typecheck',
    command: 'npm',
    args: ['run', 'typecheck'],
  },
  {
    label: 'Build',
    desc: 'npm run build',
    command: 'npm',
    args: ['run', 'build'],
  },
  {
    label: 'Clean node_modules',
    desc: 'rm -rf node_modules',
    command: 'rm',
    args: ['-rf', 'node_modules'],
    confirm: 'Delete node_modules? You will need to re-install.',
  },
  {
    label: 'Git pull',
    desc: 'git pull',
    command: 'git',
    args: ['pull'],
  },
  {
    label: 'Git status',
    desc: 'git status',
    command: 'git',
    args: ['status'],
  },
];

export default function ActionsPanel({
  agent,
  agentInfo,
  activeProject,
  log,
  notify,
  onClose,
}: ActionsPanelProps) {
  const canRun = !!(agent && agentInfo && activeProject?.localPath);

  const run = (action: Action) => {
    if (!canRun || !agent || !activeProject?.localPath) return;
    if (action.confirm && !window.confirm(action.confirm)) return;
    const id = `act_${Date.now().toString(36)}`;
    log(`$ ${action.command} ${action.args.join(' ')} (on laptop)`, 'info');
    notify('info', `${action.label}…`);
    const off = agent.onEvent((evt) => {
      if (evt.type === 'output' && evt.id === id) {
        log(evt.data, evt.stream === 'stderr' ? 'err' : 'out');
      } else if (evt.type === 'exit' && evt.id === id) {
        off();
        if (evt.code === 0) {
          notify('success', `${action.label} done`);
        } else {
          notify('error', `${action.label} exited ${evt.code}`);
        }
      }
    });
    agent.exec({
      id,
      command: action.command,
      args: action.args,
      cwd: activeProject.localPath,
    });
    onClose();
  };

  return (
    <div className="popover actions-panel">
      <div className="popover-title">Quick actions</div>
      {!canRun && (
        <div className="popover-hint">
          Connect the agent and set a local path on the active project to
          enable these.
        </div>
      )}
      <div className="actions-grid">
        {ACTIONS.map((a) => (
          <button
            key={a.label}
            className="action-btn"
            onClick={() => run(a)}
            disabled={!canRun}
            title={a.desc}
          >
            <div className="action-label">{a.label}</div>
            <div className="action-desc">{a.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
