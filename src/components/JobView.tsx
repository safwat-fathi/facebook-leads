'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { isActive, KIND_LABEL, STATUS_LABEL } from '@/lib/job-present';
import { usd } from '@/lib/present';
import type { JobDetail } from '@/lib/jobs';
import { postJson } from './api';
import { AppliesTo } from './AppliesTo';

export function JobView({ initial, links }: { initial: JobDetail; links: { href: string; text: string }[] }) {
  const [job, setJob] = useState(initial);
  const [error, setError] = useState('');
  const active = isActive(job.status);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      try { const r = await fetch(`/api/jobs/${job.id}`); if (r.ok) setJob((await r.json()) as JobDetail); } catch { /* next tick */ }
    }, 2000);
    return () => clearInterval(t);
  }, [active, job.id]);
  async function cancel() {
    setError('');
    const r = await postJson(`/api/jobs/${job.id}/cancel`, {});
    if (r.ok) setJob({ ...job, ...(r.data as JobDetail) }); else setError(r.error);
  }
  return (
    <main className="page narrow" id="main-content">
      <Link className="back" href="/jobs">&larr; All jobs</Link>
      <div className="pagehead">
        <div>
          <h1 className="jobtitle">{KIND_LABEL[job.kind]} <span className="note">#{job.id}</span></h1>
          <AppliesTo job={job} />
        </div>
        <span className={`status s-${job.status}`}>{STATUS_LABEL[job.status]}</span>
      </div>
      <section className="panel jobfacts" aria-label="Progress">
        <p aria-live="polite">{job.progress ?? (active ? 'Waiting for the first step…' : '')}</p>
        {job.error && job.status !== 'done' && <p className="note">{job.error}</p>}
        <progress value={Math.min(job.spent_usd, job.budget_usd)} max={job.budget_usd} aria-label="Budget used" />
        <p>Spent <b>{usd(job.spent_usd)}</b> of the <b>{usd(job.budget_usd)}</b> budget.</p>
        <p className="row-actions">
          {active && <button type="button" className="quiet" onClick={cancel}>Cancel</button>}
          {job.status !== 'queued' && links.map((l) => <Link key={l.href} className="quiet" href={l.href}>{l.text}</Link>)}
        </p>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      <h2 className="section">Log</h2>
      <pre className="evidence log" dir="ltr">{job.log}</pre>
    </main>
  );
}
