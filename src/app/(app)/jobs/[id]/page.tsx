import { notFound } from 'next/navigation';
import { JobView } from '@/components/JobView';
import { requireAuth } from '@/lib/auth';
import { getJob } from '@/lib/jobs';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const id = Number((await params).id);
  const job = Number.isInteger(id) && id > 0 ? getJob(id) : null;
  if (!job) notFound();
  return <JobView initial={job} />;
}
