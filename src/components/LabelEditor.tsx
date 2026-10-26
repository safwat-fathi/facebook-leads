'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { patchJson } from './api';

// The name of a search, editable in place. Blank clears it, and the search goes back to being named after its terms and cities.
export function LabelEditor({ id, label, fallback }: { id: number; label: string | null; fallback: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const r = await patchJson(`/api/jobs/${id}`, { label: value });
    setBusy(false);
    if (r.ok) { setEditing(false); router.refresh(); } else setError(r.error);
  }
  if (!editing) {
    return (
      <span className="labeledit">
        {label ? <h2 dir="auto">{label}</h2> : <h2 className="unnamed" dir="auto">{fallback}</h2>}
        <button type="button" className="iconbtn" aria-label={label ? `Rename search ${label}` : 'Add a label to this search'} title={label ? 'Rename' : 'Add a label'} onClick={() => { setValue(label ?? ''); setEditing(true); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" /></svg>
        </button>
      </span>
    );
  }
  return (
    <form className="labeledit" onSubmit={save} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}>
      <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} placeholder={fallback} dir="auto" autoFocus aria-label="Search label" />
      <button type="submit" className="primary small" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      <button type="button" className="quiet small" onClick={() => setEditing(false)}>Cancel</button>
      {error && <span className="error" role="alert">{error}</span>}
    </form>
  );
}
