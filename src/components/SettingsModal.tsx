import { useState } from 'react';
import { supabase } from '../lib/supabase';

export interface SettingsModalProps {
  email: string;
  userId: string;
  ghToken: string;
  netlifyToken: string;
  projectCount: number;
  onResetGhToken: () => void;
  onResetNetlifyToken: () => void;
  onSignOut: () => void;
  onClose: () => void;
}

function masked(value: string): string {
  if (!value) return '(not set)';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export default function SettingsModal({
  email,
  userId,
  ghToken,
  netlifyToken,
  projectCount,
  onResetGhToken,
  onResetNetlifyToken,
  onSignOut,
  onClose,
}: SettingsModalProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const deleteAccount = async () => {
    const confirmText = window.prompt(
      'This will permanently delete your account, all projects, and all stored tokens. Type "delete" to confirm:',
    );
    if (confirmText !== 'delete') return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('delete_my_account');
      if (error) throw error;
      await supabase.auth.signOut();
      window.location.assign('/');
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
      setDeleting(false);
    }
  };

  return (
    <div className="modal-shell" onClick={onClose}>
      <div
        className="modal-card settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">Settings</div>
          <button className="icon-button" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <section className="settings-section">
          <h3>Account</h3>
          <div className="settings-row">
            <div className="settings-key">Email</div>
            <div className="settings-val">{email || '(unknown)'}</div>
          </div>
          <div className="settings-row">
            <div className="settings-key">User ID</div>
            <div className="settings-val settings-mono">
              {userId}
              <button
                className="icon-button"
                onClick={() => copy(userId, 'uid')}
                title="Copy"
              >
                {copied === 'uid' ? '✓' : '⧉'}
              </button>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-key">Projects</div>
            <div className="settings-val">{projectCount}</div>
          </div>
        </section>

        <section className="settings-section">
          <h3>Connected accounts</h3>
          <div className="settings-row">
            <div className="settings-key">GitHub token</div>
            <div className="settings-val settings-mono">
              {masked(ghToken)}
              <button onClick={onResetGhToken} disabled={!ghToken}>
                Reset
              </button>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-key">Netlify token</div>
            <div className="settings-val settings-mono">
              {masked(netlifyToken)}
              <button onClick={onResetNetlifyToken} disabled={!netlifyToken}>
                Reset
              </button>
            </div>
          </div>
          <div className="hint-text">
            Tokens are stored encrypted-at-rest in your private Supabase row.
            Only you can read them.
          </div>
        </section>

        <section className="settings-section">
          <h3>Session</h3>
          <div className="settings-actions">
            <button onClick={onSignOut}>Sign out of this browser</button>
          </div>
        </section>

        <section className="settings-section settings-danger">
          <h3>Danger zone</h3>
          <div className="hint-text" style={{ marginBottom: 8 }}>
            Permanently delete your account, all projects, and all saved
            tokens. Your code on GitHub and Netlify is untouched.
          </div>
          <div className="settings-actions">
            <button
              className="settings-danger-btn"
              onClick={deleteAccount}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete my account'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
