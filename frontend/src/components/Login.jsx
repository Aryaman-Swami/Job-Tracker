import { useState } from 'react';
import { login } from '../auth.js';
import Mark from './Mark.jsx';

export default function Login({ onLoggedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username, password);
      onLoggedIn();
    } catch (err) {
      setError(err.message || 'Sign-in failed. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <div className="panel login-card">
        <Mark large />
        <h1>Sign in to Job Tracker</h1>
        <p className="sub">Your personal workspace for scraped and saved jobs.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field-label"><span>Username</span>
            <input className="control" type="text" autoComplete="username" value={username}
              onChange={e => setUsername(e.target.value)} autoFocus required />
          </label>
          <div className="field-label">
            <label htmlFor="login-password">Password</label>
            <div className="pw-wrap">
              <input id="login-password" className="control" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                value={password} onChange={e => setPassword(e.target.value)} required />
              <button type="button" className="btn ghost" aria-pressed={showPassword} aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(v => !v)}>{showPassword ? 'Hide' : 'Show'}</button>
            </div>
          </div>
          <button type="submit" className="btn primary block" disabled={submitting} aria-busy={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
          {error && <p className="error-line" role="alert">{error}</p>}
        </form>
      </div>
    </main>
  );
}
