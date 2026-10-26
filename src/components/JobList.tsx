'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { isActive, KIND_LABEL, STATUS_LABEL } from '@/lib/job-present';
import { usd } from '@/lib/present';
import type { JobKind, JobRow } from '@/lib/jobs';
import { AppliesTo } from './AppliesTo';
import { KindIcon } from './KindIcon';

// Shows the jobs and refreshes them every 2 s while any is waiting or running. `kind` narrows the list to one kind of job.
export function JobList({ initial, kind }: { initial: JobRow[]; kind?: JobKind }) {
  const [jobs, setJobs] = useState(initial);
  const active = jobs.some((j) => isActive(j.status));
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      try { const r = await fetch('/api/jobs'); if (r.ok) setJobs(((await r.json()) as { jobs: JobRow[] }).jobs); } catch { /* try again next tick */ }
    }, 2000);
    return () => clearInterval(t);
  }, [active]);
  const shown = kind ? jobs.filter((j) => j.kind === kind) : jobs;
  if (!shown.length) return <div className="panel empty"><p>{kind ? `No ${KIND_LABEL[kind].toLowerCase()} jobs yet.` : 'No jobs yet. Start a search from the Searches page.'}</p><Link className="primary" href="/searches">Go to Searches</Link></div>;
  return (
    <ul className="joblist" aria-live="polite">
      {shown.map((j) => {
        const p = j.params as { limit?: number; recheck?: boolean };
        return (
          <li key={j.id} className="job">
            <span className="kind"><KindIcon kind={j.kind} /></span>
            <div className="main">
              <h2><Link href={`/jobs/${j.id}`}>{KIND_LABEL[j.kind]} <span className="note">#{j.id}</span></Link></h2>
              <AppliesTo job={j} />
              <p className="note">{j.kind !== 'discover' && `Up to ${p.limit} pages${p.recheck ? ', including already checked' : ''}. `}{j.progress ?? ''}</p>
            </div>
            <div className="usage">
              <span className={`status s-${j.status}`}>{STATUS_LABEL[j.status]}</span>
              <progress value={Math.min(j.spent_usd, j.budget_usd)} max={j.budget_usd} aria-label="Budget used" />
              <span>{usd(j.spent_usd)} of {usd(j.budget_usd)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
