'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { postJson } from './api';

// ✓ / ✕ "real Egyptian seller" mark; clicking the active one clears it.
export function VerdictButtons({ id, verdict, title }: { id: string; verdict: string | null; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function set(v: 'seller_yes' | 'seller_no') {
    setBusy(true); setError('');
    const r = await postJson(`/api/pages/${encodeURIComponent(id)}`, { verdict: verdict === v ? null : v });
    if (r.ok) router.refresh(); else setError(r.error);
    setBusy(false);
  }
  return (
    <span className="judge">
      <button type="button" className="yes" disabled={busy} aria-pressed={verdict === 'seller_yes'} aria-label={`Real Egyptian seller: ${title}`} title="Real Egyptian seller" onClick={() => set('seller_yes')}>{'✓'}</button>
      <button type="button" className="no" disabled={busy} aria-pressed={verdict === 'seller_no'} aria-label={`Not a seller: ${title}`} title="Not a seller" onClick={() => set('seller_no')}>{'✕'}</button>
      {error && <span className="error" role="alert">{error}</span>}
    </span>
  );
}
