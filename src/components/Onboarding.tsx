import { useState } from 'react';

export interface OnboardingProps {
  hasGitHub: boolean;
  hasAgent: boolean;
  hasNetlify: boolean;
  onDismiss: () => void;
}

export default function Onboarding({
  hasGitHub,
  hasAgent,
  hasNetlify,
  onDismiss,
}: OnboardingProps) {
  const [collapsed, setCollapsed] = useState(false);

  const steps = [
    {
      done: hasGitHub,
      title: 'Connect GitHub',
      desc: 'Click "Connect GitHub" in the toolbar. Pulls from any repo you have access to — public or private.',
    },
    {
      done: hasAgent,
      title: 'Install the local agent',
      desc: 'Optional but powerful. Click "Agent" in the toolbar and paste the npx command into your laptop\'s terminal. Unlocks chat with Claude/Codex on your subscription, local dev server, and native builds.',
    },
    {
      done: hasNetlify,
      title: 'Add your Netlify token',
      desc: 'Optional. Click "Deploy to Netlify" and paste your token once. One-click deploys forever.',
    },
  ];

  const remaining = steps.filter((s) => !s.done).length;
  if (remaining === 0) return null;

  return (
    <div className={`onboarding ${collapsed ? 'collapsed' : ''}`}>
      <div className="onboarding-head">
        <div className="onboarding-title">
          👋 Welcome to GetXsite.com
          <span className="onboarding-count">
            {remaining} step{remaining === 1 ? '' : 's'} left
          </span>
        </div>
        <div className="onboarding-head-actions">
          <button
            className="link-button"
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? 'Show' : 'Hide'}
          </button>
          <button className="link-button" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="onboarding-steps">
          {steps.map((s, i) => (
            <div
              key={s.title}
              className={`onboarding-step ${s.done ? 'done' : ''}`}
            >
              <div className="onboarding-step-num">
                {s.done ? '✓' : i + 1}
              </div>
              <div className="onboarding-step-body">
                <div className="onboarding-step-title">{s.title}</div>
                <div className="onboarding-step-desc">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
