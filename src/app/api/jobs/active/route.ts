import { activeJobCount } from '@/lib/jobs';
import { withAuth } from '@/lib/route';

export const GET = withAuth(() => Response.json({ active: activeJobCount() }));
