'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { describeJob, isActive, STATUS_LABEL } from '@/lib/job-present';
import { usd } from '@/lib/present';
import type { JobDetail } from '@/lib/jobs';
import { postJson } from './api';

export function JobView({ initial }: { initial: JobDetail }) {
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
    <main className="jobpage">
      <p><Link href="/jobs">&larr; All searches</Link></p>
      <h1 className="jobtitle">{describeJob(job.kind, job.params)}</h1>
      <p className="summary" aria-live="polite"><span className={`state s-${job.status}`}>{STATUS_LABEL[job.status]}</span>{job.progress ? `. ${job.progress}` : ''}</p>
      {job.error && job.status !== 'done' && <p className="note">{job.error}</p>}
      <p>Spent <b>{usd(job.spent_usd)}</b> of the <b>{usd(job.budget_usd)}</b> budget.</p>
      <progress className="meter" value={Math.min(job.spent_usd, job.budget_usd)} max={job.budget_usd} aria-label="Budget used" />
      <p className="row-actions">
        {active && <button type="button" className="quiet" onClick={cancel}>Cancel</button>}
        {job.kind === 'discover' && job.status !== 'queued' && <Link className="quiet" href={`/?job=${job.id}`}>View pages found</Link>}
        {job.kind === 'enrich' && job.status !== 'queued' && <Link className="quiet" href="/?enriched=yes">View enriched pages</Link>}
        {job.kind === 'website_check' && job.status !== 'queued' && <Link className="quiet" href="/?website=none">View pages with no website found</Link>}
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <h2>Log</h2>
      <pre className="evidence log" dir="ltr">{job.log}</pre>
    </main>
  );
}
