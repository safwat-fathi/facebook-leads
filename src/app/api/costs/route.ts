import { toCsv } from '@/lib/csv';
import { listSpend } from '@/lib/costs';
import { withAuth } from '@/lib/route';

const MAX = 5000;
export const GET = withAuth(() => {
  const { rows } = listSpend({ limit: MAX, offset: 0 });
  return new Response(toCsv(['when_utc', 'provider', 'usd', 'what', 'job_id', 'job_kind'], rows.map((r) => [r.at, r.provider, r.usd, r.note, r.job_id, r.kind])), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="costs.csv"' },
  });
});
