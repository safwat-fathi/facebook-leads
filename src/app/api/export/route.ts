import { toCsv } from '@/lib/csv';
import { parseFilters } from '@/lib/filters';
import { selectForExport } from '@/lib/pages';
import { withAuth } from '@/lib/route';

const COLS = ['title', 'url', 'followers', 'city', 'country', 'business_type', 'category', 'whatsapp', 'whatsapp_source', 'phone', 'email', 'website_status', 'website_domain', 'shop_fit', 'wa_fit', 'pitch', 'stage', 'verdict', 'notes'];
export const GET = withAuth(async (req) => {
  const rows = selectForExport(parseFilters(req.nextUrl.searchParams));
  return new Response(toCsv(COLS, rows.map((r) => COLS.map((c) => r[c]))), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="leads.csv"' },
  });
});
