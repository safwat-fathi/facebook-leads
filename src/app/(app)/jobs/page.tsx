import Link from 'next/link';
import { JobList } from '@/components/JobList';
import { requireAuth } from '@/lib/auth';
import { KIND_LABEL } from '@/lib/job-present';
import { budgetStatus, listJobs, type JobKind } from '@/lib/jobs';
import { usd } from '@/lib/present';

const KINDS = Object.keys(KIND_LABEL) as JobKind[];

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAuth();
  const raw = (await searchParams).kind;
  const kind = KINDS.find((k) => k === (Array.isArray(raw) ? raw[0] : raw));
  const b = budgetStatus();
  const jobs = listJobs(60);
  return (
    <main className="page narrow" id="main-content">
      <div className="pagehead">
        <div>
          <h1>Jobs</h1>
          <p className="lede">Everything the app runs in the background, and what each run applied to. Spent <b>{usd(b.spent24h)}</b> in the last 24 hours of the <b>{usd(b.dailyLimit)}</b> daily limit.</p>
        </div>
        <Link className="primary" href="/searches">New search</Link>
      </div>
      <nav className="tabs" aria-label="Kind of job">
        <Link href="/jobs" aria-current={kind ? undefined : 'page'}>All</Link>
        {KINDS.map((k) => <Link key={k} href={`/jobs?kind=${k}`} aria-current={kind === k ? 'page' : undefined}>{KIND_LABEL[k]}</Link>)}
      </nav>
      <JobList initial={jobs} kind={kind} />
    </main>
  );
}
