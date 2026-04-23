import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function LoginGate() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendLink = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">GetXsite.com</div>
        {sent ? (
          <>
            <div className="login-title">Check your email</div>
            <div className="login-hint">
              We sent a sign-in link to <b>{email}</b>. Click it to continue.
            </div>
            <button
              className="link-button"
              onClick={() => {
                setSent(false);
                setEmail('');
              }}
            >
              Use a different email
            </button>
          </>
        ) : (
          <>
            <div className="login-title">Sign in</div>
            <div className="login-hint">
              Enter your email and we'll send you a one-click sign-in link.
            </div>
            <label>
              Email
              <input
                autoFocus
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendLink();
                }}
                placeholder="you@example.com"
              />
            </label>
            {error && <div className="error-text">{error}</div>}
            <button
              className="primary"
              onClick={sendLink}
              disabled={sending || !email.trim()}
            >
              {sending ? 'Sending…' : 'Send sign-in link'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
