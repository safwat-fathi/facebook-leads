import { readJson } from '@/lib/body';
import { budgetStatus, createJob, kickWorker, listJobs } from '@/lib/jobs';
import { withAuth } from '@/lib/route';

export const GET = withAuth(() => Response.json({ jobs: listJobs(60), budget: budgetStatus() }));
export const POST = withAuth(async (req) => Response.json(createJob(await readJson(req), { kick: kickWorker }), { status: 201 }));
