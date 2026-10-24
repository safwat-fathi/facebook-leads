import { JobList } from '@/components/JobList';
import { NewSearch } from '@/components/NewSearch';
import { requireAuth } from '@/lib/auth';
import { budgetStatus, listJobs } from '@/lib/jobs';
import { usd } from '@/lib/present';

export default async function JobsPage() {
  await requireAuth();
  const b = budgetStatus();
  const jobs = listJobs(30);
  return (
    <main className="jobpage">
      <p className="summary">Spent <b>{usd(b.spent24h)}</b> in the last 24 hours of the <b>{usd(b.dailyLimit)}</b> daily limit.</p>
      <NewSearch />
      <h2>Recent searches</h2>
      <JobList initial={jobs} />
    </main>
  );
}
