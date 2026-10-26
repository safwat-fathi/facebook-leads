import { jobId, readJson } from '@/lib/body';
import { HttpError } from '@/lib/errors';
import { getJob, setLabel } from '@/lib/jobs';
import { withAuth } from '@/lib/route';

export const GET = withAuth<{ id: string }>(async (_req, { params }) => {
  const job = getJob(jobId((await params).id));
  if (!job) throw new HttpError(404, 'no such job');
  return Response.json(job);
});
// Rename a Find-pages search; a blank label clears it.
export const PATCH = withAuth<{ id: string }>(async (req, { params }) => Response.json(setLabel(jobId((await params).id), await readJson(req))));
