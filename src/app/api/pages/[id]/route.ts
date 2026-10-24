import { readJson } from '@/lib/body';
import { pageDetail, savePage } from '@/lib/pages';
import { withAuth } from '@/lib/route';

export const POST = withAuth<{ id: string }>(async (req, { params }) => {
  const { id } = await params;
  savePage(id, await readJson(req));
  return Response.json(pageDetail(id));
});
