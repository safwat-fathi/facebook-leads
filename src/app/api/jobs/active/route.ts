import { activeJobCount, budgetStatus } from '@/lib/jobs';
import { withAuth } from '@/lib/route';

// The sidebar polls this: whether a job is running, and today's spend against the daily limit.
export const GET = withAuth(() => { const b = budgetStatus(); return Response.json({ active: activeJobCount(), spent24h: b.spent24h, dailyLimit: b.dailyLimit }); });
