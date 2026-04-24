import { useState } from 'react';
import { supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup';

export default function LoginGate() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const reset = () => {
    setError(null);
    setInfo(null);
  };

  const submit = async () => {
    const e = email.trim();
    if (!e || !password) return;
    setSubmitting(true);
    reset();
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: e,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (data.session) {
          // Email confirmation disabled — user is logged in directly.
          return;
        }
        setConfirmSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: e,
          password,
        });
        if (error) throw error;
        if (window.location.pathname !== '/app') {
          window.location.assign('/app');
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const resendConfirmation = async () => {
    reset();
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setInfo('Confirmation email resent.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmSent) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="login-brand">GetXsite.com</div>
          <div className="login-title">Confirm your email</div>
          <div className="login-hint">
            We sent a confirmation link to <b>{email}</b>. Click it to finish
            creating your account, then come back and sign in.
          </div>
          {error && <div className="error-text">{error}</div>}
          {info && <div className="login-info">{info}</div>}
          <button
            className="primary"
            onClick={() => {
              setConfirmSent(false);
              setMode('signin');
              setPassword('');
              reset();
            }}
          >
            I've confirmed — sign in
          </button>
          <button
            className="link-button"
            onClick={resendConfirmation}
            disabled={submitting}
          >
            {submitting ? 'Resending…' : 'Resend confirmation email'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">GetXsite.com</div>
        <div className="login-title">
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </div>
        <div className="login-hint">
          {mode === 'signin'
            ? 'Enter your email and password.'
            : 'Create an account with your email and a password. We\'ll send a confirmation email to finish setup.'}
        </div>
        <label>
          Email
          <input
            autoFocus
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="you@example.com"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="••••••••"
            minLength={6}
          />
        </label>
        {error && <div className="error-text">{error}</div>}
        {info && <div className="login-info">{info}</div>}
        <button
          className="primary"
          onClick={submit}
          disabled={submitting || !email.trim() || !password}
        >
          {submitting
            ? mode === 'signin'
              ? 'Signing in…'
              : 'Creating account…'
            : mode === 'signin'
            ? 'Sign in'
            : 'Create account'}
        </button>
        <button
          className="link-button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            reset();
          }}
        >
          {mode === 'signin'
            ? 'Need an account? Create one'
            : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
