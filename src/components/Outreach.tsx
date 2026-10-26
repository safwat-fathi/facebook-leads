'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PageDetail } from '@/lib/pages';
import type { OutreachState } from '@/lib/outreach';
import { postJson } from './api';

const STATUS: Record<string, string> = { pending: 'sending', sent: 'sent', failed: 'failed', opened: 'WhatsApp opened' };
const when = (iso: string) => new Date(iso).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });

// Draft with the model, edit, then send. Nothing is sent without a click here; WhatsApp only opens a prefilled chat.
export function Outreach({ d, state }: { d: PageDetail; state: OutreachState }) {
  const router = useRouter();
  const [subject, setSubject] = useState(d.draft_subject ?? '');
  const [body, setBody] = useState(d.draft_body ?? '');
  const saved = useRef({ subject: d.draft_subject ?? '', body: d.draft_body ?? '' }); // what the server holds, so only real edits are saved
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [waUrl, setWaUrl] = useState('');
  const url = `/api/pages/${encodeURIComponent(d.fb_page_id)}/outreach`;

  async function act(action: string, extra: Record<string, unknown> = {}, done?: (data: Record<string, unknown>) => void) {
    setBusy(action); setMsg(''); setError('');
    const r = await postJson(url, { action, ...extra });
    setBusy('');
    if (!r.ok) { setError(r.error); router.refresh(); return; }
    done?.(r.data as Record<string, unknown>);
    router.refresh();
  }
  const draft = () => act('draft', {}, (x) => { const s = String(x.subject ?? ''), b = String(x.body ?? ''); setSubject(s); setBody(b); saved.current = { subject: s, body: b }; setWaUrl(''); setMsg('Draft ready and saved. Read and edit it before sending.'); });
  const send = () => act('send', { subject, body }, () => { setMsg('Email sent.'); setSubject(''); setBody(''); saved.current = { subject: '', body: '' }; });
  // Edits are saved when you leave a field, so closing the drawer keeps the draft.
  async function keep() {
    if (subject === saved.current.subject && body === saved.current.body) return;
    const r = await postJson(`/api/pages/${encodeURIComponent(d.fb_page_id)}`, { draft_subject: subject || null, draft_body: body || null });
    if (r.ok) { saved.current = { subject, body }; setMsg('Draft saved.'); } else setError(`Draft not saved: ${r.error}`);
  }
  const whatsapp = () => act('whatsapp', { body }, (x) => { const u = String(x.url ?? ''); setWaUrl(u); window.open(u, '_blank', 'noopener,noreferrer'); setMsg('WhatsApp opened with the message. Send it from there.'); });
  const dnc = () => act('dnc', { on: !state.dnc });

  const canEmail = !!d.email, canWa = !!d.whatsapp;
  return (
    <>
      <h3>Contact</h3>
      {state.dnc && <p className="note"><span className="pill">Do not contact</span> This page is on your do-not-contact list, so sending is blocked.</p>}
      {!canEmail && !canWa && <p className="note">No email or WhatsApp number on this page.</p>}
      <div className="review-row">
        <button type="button" className="quiet" disabled={!!busy || state.dnc} onClick={draft}>{busy === 'draft' ? 'Drafting…' : body ? 'Draft again (replaces this one)' : 'Draft message'}</button>
        <button type="button" className="quiet" aria-pressed={state.dnc} disabled={!!busy} onClick={dnc}>{state.dnc ? 'Remove from do-not-contact' : 'Do not contact'}</button>
      </div>
      {(body || subject) && (
        <>
          {canEmail && (<><label htmlFor="o-subject">Subject</label><input id="o-subject" dir="auto" maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={keep} /></>)}
          <label htmlFor="o-body">Message</label>
          <textarea id="o-body" dir="auto" maxLength={5000} rows={8} value={body} onChange={(e) => setBody(e.target.value)} onBlur={keep} />
          <p className="note">Emails get an opt-out line added at the end.</p>
          <div className="review-row">
            {canEmail && <button type="button" className="primary" disabled={!!busy || state.dnc || !subject.trim() || !body.trim()} onClick={send}>{busy === 'send' ? 'Sending…' : `Send email to ${d.email}`}</button>}
            {canWa && <button type="button" className="quiet" disabled={!!busy || state.dnc || !body.trim()} onClick={whatsapp}>Open in WhatsApp</button>}
          </div>
          {waUrl && <p className="note"><a href={waUrl} target="_blank" rel="noopener noreferrer">Open WhatsApp again</a></p>}
        </>
      )}
      <p className="saved" aria-live="polite">{msg}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {state.log.length > 0 && (
        <details>
          <summary>History ({state.log.length})</summary>
          <ul className="reasons">
            {state.log.map((l) => <li key={l.id}><span>{when(l.created_at)} &middot; {l.channel} &middot; {STATUS[l.status]}{l.error ? ` (${l.error})` : ''}<br /><span className="note" dir="auto">{l.subject ? `${l.subject}: ` : ''}{l.body.slice(0, 160)}</span></span></li>)}
          </ul>
        </details>
      )}
    </>
  );
}
