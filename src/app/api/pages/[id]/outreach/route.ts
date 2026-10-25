import { readJson } from '@/lib/body';
import { bad } from '@/lib/errors';
import { draftMessage, sendEmail, setDoNotContact, whatsappLink } from '@/lib/outreach';
import { withAuth } from '@/lib/route';

// One endpoint for the drawer's outreach actions: { action: 'draft' | 'send' | 'whatsapp' | 'dnc', ... }.
export const POST = withAuth<{ id: string }>(async (req, { params }) => {
  const { id } = await params;
  const body = await readJson(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('invalid body');
  const { action, ...rest } = body as { action?: string; [k: string]: unknown };
  switch (action) {
    case 'draft': return Response.json(await draftMessage(id));
    case 'send': return Response.json(await sendEmail(id, rest));
    case 'whatsapp': return Response.json(whatsappLink(id, rest));
    case 'dnc': setDoNotContact(id, rest.on === true); return Response.json({ ok: true });
    default: throw bad('unknown action');
  }
});
