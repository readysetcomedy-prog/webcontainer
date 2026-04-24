import type { TourStep } from '../components/Tour';

export function getTourSteps(opts: {
  setBottomTab: (tab: 'terminal' | 'chat') => void;
}): TourStep[] {
  return [
    {
      target: 'brand',
      title: 'GetXsite.com',
      desc: 'Your entire dev environment in a browser tab — edit, preview, and ship web + mobile apps without installing anything (or using your local machine when you want).',
    },
    {
      target: 'branch-picker',
      title: 'Branch picker',
      desc: 'When a project is open, switch branches without losing your env vars or Netlify site id — those are saved per repo, not per branch.',
    },
    {
      target: 'btn-github',
      title: 'Connect GitHub',
      desc: 'Sign in to GitHub to pull any public or private repo. Your token is stored in your Supabase row and follows you across devices.',
    },
    {
      target: 'btn-env',
      title: 'Env vars',
      desc: 'Drop a .env file or paste values. Saved per repo, auto-injected on every pull, and included when you Download the project.',
    },
    {
      target: 'btn-pull',
      title: 'Pull',
      desc: 'Refresh the project from GitHub. Reuses the existing project record so env + Netlify site stay.',
    },
    {
      target: 'btn-push',
      title: 'Push',
      desc: 'Commits every file you edited in the browser and pushes to the current branch. The number shows how many files are dirty.',
    },
    {
      target: 'btn-download',
      title: 'Download',
      desc: 'Zips the project including .env.local. Unzip anywhere, npm install, and run. Great for handoffs or local builds.',
    },
    {
      target: 'btn-deploy',
      title: 'Deploy to Netlify',
      desc: 'Builds and uploads to Netlify with one click. Each project remembers its Netlify site id, so future deploys update the same site.',
    },
    {
      target: 'btn-actions',
      title: 'Quick actions',
      desc: 'Install / test / lint / format / typecheck / build / git — run them on your laptop via the local agent with one click.',
    },
    {
      target: 'btn-agent',
      title: 'Local agent',
      desc: 'Run one command on your laptop and the studio can drive your real machine: chat with Claude / Codex on your subscription, run your dev server, do native builds.',
    },
    {
      target: 'btn-settings',
      title: 'Settings',
      desc: 'Manage your account, stored tokens, and chat models. Models are user-defined — add Claude Opus, Codex, Gemini, Aider, any CLI you want.',
    },
    {
      target: 'btn-tutorial',
      title: 'Tutorial',
      desc: 'Re-run this tour anytime from here.',
    },
    {
      target: 'projects-section',
      title: 'Projects',
      desc: 'Every repo you open auto-saves here. Click to re-open. Rename or delete with the icons that appear on hover.',
    },
    {
      target: 'file-tree',
      title: 'Files',
      desc: 'The project tree. In local-agent mode this IS your laptop\'s filesystem. Click any file to open it in the editor.',
    },
    {
      target: 'editor-pane',
      title: 'Editor',
      desc: 'Full Monaco editor. Edits write to the WebContainer (or your laptop in agent mode). Hot reload just works.',
    },
    {
      target: 'bottom-tabs',
      title: 'Terminal & Chat',
      desc: 'The bottom panel switches between live terminal output and a chat panel where you talk to Claude / Codex / whatever CLI you wired up.',
      onEnter: () => opts.setBottomTab('chat'),
    },
    {
      target: 'chat-panel',
      title: 'Chat with your own AI',
      desc: 'Pick a model preset, type a prompt. Runs on your machine via the local agent using your subscription. Token counters show you what you\'d be paying on the API if you weren\'t on a sub.',
    },
    {
      target: 'preview-pane',
      title: 'Preview',
      desc: 'Your app running live. Tabbed like a mini browser — open multiple pages, pop a URL into the address bar, refresh, open externally.',
      onEnter: () => opts.setBottomTab('terminal'),
    },
  ];
}
