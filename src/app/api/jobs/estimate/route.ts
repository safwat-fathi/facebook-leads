import { readJson } from '@/lib/body';
import { budgetStatus, estimate } from '@/lib/jobs';
import { withAuth } from '@/lib/route';

export const POST = withAuth(async (req) => {
  const { job: _job, ...e } = estimate(await readJson(req)); // the parsed job is echoed back only through its estimate
  return Response.json({ ...e, budget: budgetStatus() });
});
