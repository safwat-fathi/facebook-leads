import { NextResponse } from 'next/server';
import { sessionCookieOptions } from '@/lib/auth';
import { sessionCookieName } from '@/lib/auth-shared';
import { publicRoute } from '@/lib/route';

export const POST = publicRoute(() => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieName(), '', sessionCookieOptions(0));
  return res;
});
