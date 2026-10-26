import { notFound } from 'next/navigation';
import { JobView } from '@/components/JobView';
import { requireAuth } from '@/lib/auth';
import { filtersToQuery } from '@/lib/filters';
import { getJob } from '@/lib/jobs';
import type { CheckParams } from '@/lib/jobs-schema';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const id = Number((await params).id);
  const job = Number.isInteger(id) && id > 0 ? getJob(id) : null;
  if (!job) notFound();
  // "View pages" opens the Leads list limited to what this job was about (a search's own pages, or the job's filters), not the whole list.
  const scope = job.kind === 'discover' ? { job: job.id } : (job.params as CheckParams).filters;
  const to = (extra: Record<string, string>) => `/?${new URLSearchParams({ ...Object.fromEntries(filtersToQuery(scope)), ...extra })}`;
  const links = job.kind === 'discover' ? [{ href: to({}), text: 'View pages found' }]
    : job.kind === 'enrich' ? [{ href: to({ enriched: 'yes' }), text: 'View enriched pages' }]
    : [{ href: to({ website: 'none' }), text: 'View pages with no website found' }];
  return <JobView initial={job} links={links} />;
}
