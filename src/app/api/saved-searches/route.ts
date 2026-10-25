import { readJson } from '@/lib/body';
import { bad } from '@/lib/errors';
import { deleteSaved, listSaved, saveSearch } from '@/lib/saved-searches';
import { withAuth } from '@/lib/route';

export const GET = withAuth(() => Response.json({ saved: listSaved() }));
export const POST = withAuth(async (req) => { saveSearch(await readJson(req)); return Response.json({ saved: listSaved() }, { status: 201 }); });
export const DELETE = withAuth((req) => {
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isInteger(id) || id < 1) throw bad('invalid id');
  deleteSaved(id);
  return Response.json({ saved: listSaved() });
});
