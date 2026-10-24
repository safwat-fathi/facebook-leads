'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { describeJob, isActive, STATUS_LABEL } from '@/lib/job-present';
import { usd } from '@/lib/present';
import type { JobRow } from '@/lib/jobs';

// Shows the jobs and refreshes them every 2 s while any is waiting or running.
export function JobList({ initial }: { initial: JobRow[] }) {
  const [jobs, setJobs] = useState(initial);
  const active = jobs.some((j) => isActive(j.status));
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      try { const r = await fetch('/api/jobs'); if (r.ok) setJobs(((await r.json()) as { jobs: JobRow[] }).jobs); } catch { /* try again next tick */ }
    }, 2000);
    return () => clearInterval(t);
  }, [active]);
  if (!jobs.length) return <p className="empty">No searches yet. Start one above.</p>;
  return (
    <ul className="joblist" aria-live="polite">
      {jobs.map((j) => (
        <li key={j.id} className={`job s-${j.status}`}>
          <Link href={`/jobs/${j.id}`}><span className="state">{STATUS_LABEL[j.status]}</span> {describeJob(j.kind, j.params)}</Link>
          <span className="sub">{j.progress ?? ''} &middot; {usd(j.spent_usd)} of {usd(j.budget_usd)}</span>
        </li>
      ))}
    </ul>
  );
}
