import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp, createSession, loginLimiter, sessionCookieOptions, verifyKey } from '@/lib/auth';
import { sessionCookieName } from '@/lib/auth-shared';
import { bad, HttpError } from '@/lib/errors';
import { publicRoute } from '@/lib/route';

const Body = z.object({ key: z.string().min(1).max(200) });

export const POST = publicRoute(async (req) => {
  const ip = clientIp(req);
  const wait = loginLimiter.blockedFor(ip);
  if (wait) throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.`);
  const text = await req.text();
  if (text.length > 1000) throw bad('request too large');
  let body: z.infer<typeof Body>;
  try { body = Body.parse(JSON.parse(text)); } catch { throw bad('send {"key": "..."} as JSON'); }
  if (!verifyKey(body.key)) { loginLimiter.fail(ip); throw new HttpError(401, 'Invalid API key'); }
  loginLimiter.success(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieName(), createSession(), sessionCookieOptions());
  return res;
});
