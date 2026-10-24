import { NextResponse, type NextRequest } from 'next/server';
import { sessionCookieName } from '@/lib/auth-shared';

// Optimistic only (Next.js docs): redirect people with no session cookie to /login and attach a per-request CSP nonce.
// The real check is requireAuth() in every page and withAuth() in every route handler, because a proxy alone is not a security boundary.
export function proxy(req: NextRequest) {
  const dev = process.env.NODE_ENV !== 'production';
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-inline'" : ''}`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  if (req.nextUrl.pathname !== '/login' && !req.cookies.has(sessionCookieName())) {
    const res = NextResponse.redirect(new URL('/login', req.nextUrl));
    res.headers.set('Content-Security-Policy', csp);
    return res;
  }
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: [{
    source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
    missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }],
  }],
};
