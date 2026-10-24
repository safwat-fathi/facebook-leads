'use client';
import { useState } from 'react';

export function LoginForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError('');
    const key = String(new FormData(e.currentTarget).get('key') ?? '');
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
      if (r.ok) { window.location.assign('/'); return; }
      setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Sign-in failed (HTTP ${r.status})`);
    } catch { setError('Could not reach the server. Check your connection and try again.'); }
    setBusy(false);
  }
  return (
    <form onSubmit={submit} className="login-form">
      <label>
        API key
        <input name="key" type="password" autoComplete="current-password" required autoFocus spellCheck={false} />
      </label>
      <button type="submit" className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <p className="error" role="alert" aria-live="assertive">{error}</p>
    </form>
  );
}
