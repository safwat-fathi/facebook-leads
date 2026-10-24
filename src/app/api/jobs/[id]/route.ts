import { jobId } from '@/lib/body';
import { HttpError } from '@/lib/errors';
import { getJob } from '@/lib/jobs';
import { withAuth } from '@/lib/route';

export const GET = withAuth<{ id: string }>(async (_req, { params }) => {
  const job = getJob(jobId((await params).id));
  if (!job) throw new HttpError(404, 'no such job');
  return Response.json(job);
});
