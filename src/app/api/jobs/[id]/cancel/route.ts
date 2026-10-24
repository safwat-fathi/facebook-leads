import { jobId } from '@/lib/body';
import { cancelJob } from '@/lib/jobs';
import { withAuth } from '@/lib/route';

export const POST = withAuth<{ id: string }>(async (_req, { params }) => Response.json(cancelJob(jobId((await params).id))));
