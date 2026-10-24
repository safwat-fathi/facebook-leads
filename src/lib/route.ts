import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { sameOrigin, verifySession } from './auth';
import { sessionCookieName } from './auth-shared';
import { HttpError } from './errors';

// Every route handler MUST be exported through one of these two wrappers (tests/route-guard.test.ts fails otherwise).
type Ctx<P> = { params: Promise<P> };
type Handler<P> = (req: NextRequest, ctx: Ctx<P>) => Promise<Response> | Response;

const json = (body: unknown, status: number, extra?: HeadersInit) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', ...extra } });
async function run<P>(fn: Handler<P>, req: NextRequest, ctx: Ctx<P>): Promise<Response> {
  try {
    if (!sameOrigin(req)) return json({ error: 'cross-site request refused' }, 403);
    const res = await fn(req, ctx);
    res.headers.set('cache-control', 'no-store');
    return res;
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('route error', e); // details stay in the server log, never in the response
    return json({ error: 'server error' }, 500);
  }
}

/** Requires a valid session cookie. */
export const withAuth = <P = Record<string, never>>(fn: Handler<P>) => (req: NextRequest, ctx: Ctx<P>) => {
  if (!verifySession(req.cookies.get(sessionCookieName())?.value)) return Promise.resolve(json({ error: 'not signed in' }, 401));
  return run(fn, req, ctx);
};
/** No session required (login/logout only). Still enforces same-origin on POST. */
export const publicRoute = <P = Record<string, never>>(fn: Handler<P>) => (req: NextRequest, ctx: Ctx<P>) => run(fn, req, ctx);
