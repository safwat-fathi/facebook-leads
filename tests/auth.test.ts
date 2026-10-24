import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSession, generateKey, hashKey, sameOrigin, verifyKey, verifySession } from '@/lib/auth';
import { sessionCookieName } from '@/lib/auth-shared';
import { LoginLimiter } from '@/lib/rate-limit';
import { resetEnvForTests } from '@/lib/env';
import { HttpError } from '@/lib/errors';
import { publicRoute, withAuth } from '@/lib/route';
import { POST as login } from '@/app/api/login/route';
import { POST as logout } from '@/app/api/logout/route';

const KEY = generateKey();
const SECRET = 'x'.repeat(48);
const ORIGIN = 'https://leads.example.com';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_API_KEY_HASH', hashKey(KEY));
  vi.stubEnv('SESSION_SECRET', SECRET);
  vi.stubEnv('APP_ORIGIN', ORIGIN);
  resetEnvForTests();
});

describe('api key', () => {
  it('generated keys have the fbl_ prefix and 256 bits', () => {
    expect(KEY).toMatch(/^fbl_[A-Za-z0-9_-]{43}$/);
    expect(generateKey()).not.toBe(KEY);
  });
  it('accepts only the exact key', () => {
    expect(verifyKey(KEY)).toBe(true);
    for (const wrong of ['', ' ', KEY + ' ', KEY.slice(0, -1), KEY.toUpperCase(), 'fbl_', hashKey(KEY)]) expect(verifyKey(wrong)).toBe(false);
  });
});

describe('session cookie', () => {
  const now = 1_800_000_000_000;
  it('round-trips and expires after 7 days', () => {
    const s = createSession(now);
    expect(verifySession(s, now + 1000)).toBe(true);
    expect(verifySession(s, now + 7 * 24 * 3600 * 1000 - 1000)).toBe(true);
    expect(verifySession(s, now + 7 * 24 * 3600 * 1000 + 1000)).toBe(false);
  });
  it('rejects tampering, another secret, and malformed values', () => {
    const [v, payload, sig] = createSession(now).split('.');
    const forged = Buffer.from(JSON.stringify({ iat: 1, exp: 9_999_999_999 })).toString('base64url'); // far-future expiry, original signature
    for (const bad of [`${v}.${forged}.${sig}`, `${v}.${payload}.${sig.slice(0, -2)}AA`, `${v}.${payload}`, `${v}.${payload}.${sig}.x`, `v2.${payload}.${sig}`, '', 'v1', 'v1..', '...', 'garbage']) {
      expect(verifySession(bad, now + 1000)).toBe(false);
    }
    expect(verifySession(createSession(now, 'another-secret-another-secret-another!!'), now + 1000)).toBe(false);
    expect(verifySession(undefined)).toBe(false);
    expect(verifySession(null)).toBe(false);
  });
  it('a payload whose exp is not a number is refused even if correctly signed', async () => {
    const { createHmac } = await import('node:crypto');
    const payload = Buffer.from(JSON.stringify({ exp: '9999999999' })).toString('base64url');
    const sig = createHmac('sha256', SECRET).update(`v1.${payload}`).digest('base64url');
    expect(verifySession(`v1.${payload}.${sig}`, now)).toBe(false);
  });
});

describe('same-origin (CSRF) check', () => {
  const post = (h: HeadersInit) => new Request('http://x/api', { method: 'POST', headers: h });
  it('reads are always fine', () => expect(sameOrigin(new Request('http://x/api'))).toBe(true));
  it('POST needs our exact origin', () => {
    expect(sameOrigin(post({ origin: ORIGIN }))).toBe(true);
    expect(sameOrigin(post({ origin: ORIGIN, 'sec-fetch-site': 'same-origin' }))).toBe(true);
    for (const h of [{} as Record<string, string>, { origin: 'https://evil.example' }, { origin: 'null' }, { origin: ORIGIN + '.evil.example' }, { origin: 'http://leads.example.com' }, { origin: ORIGIN, 'sec-fetch-site': 'cross-site' }, { origin: ORIGIN, 'sec-fetch-site': 'same-site' }]) {
      expect(sameOrigin(post(h))).toBe(false);
    }
  });
});

describe('login limiter', () => {
  it('blocks after 5 failures per address, per window, and a success clears it', () => {
    let t = 0;
    const l = new LoginLimiter({ perIp: 5, global: 50, windowMs: 900_000 }, () => t);
    for (let i = 0; i < 5; i++) { expect(l.blockedFor('a')).toBe(0); l.fail('a'); }
    expect(l.blockedFor('a')).toBeGreaterThan(0);
    expect(l.blockedFor('b')).toBe(0);
    t = 900_001; expect(l.blockedFor('a')).toBe(0); // window passed
    l.fail('c'); l.success('c'); expect(l.blockedFor('c')).toBe(0);
  });
  it('has a global ceiling across addresses', () => {
    const l = new LoginLimiter({ perIp: 5, global: 10, windowMs: 900_000 }, () => 0);
    for (let i = 0; i < 10; i++) l.fail('ip' + i);
    expect(l.blockedFor('someone-new')).toBeGreaterThan(0);
  });
});

const req = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string; cookie?: string } = {}) =>
  new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? 'GET', body: init.body, headers: { ...(init.cookie ? { cookie: `${sessionCookieName()}=${init.cookie}` } : {}), ...init.headers } });
const ctx = { params: Promise.resolve({}) };

describe('route wrappers', () => {
  const ok = () => Response.json({ ok: true });
  it('withAuth: 401 without a valid session, runs with one', async () => {
    const h = withAuth(ok);
    expect((await h(req('/api/x'), ctx)).status).toBe(401);
    expect((await h(req('/api/x', { cookie: 'nonsense' }), ctx)).status).toBe(401);
    const good = await h(req('/api/x', { cookie: createSession() }), ctx);
    expect(good.status).toBe(200);
    expect(good.headers.get('cache-control')).toBe('no-store');
  });
  it('withAuth: a signed-in POST from another origin is refused', async () => {
    const h = withAuth(ok);
    const r = await h(req('/api/x', { method: 'POST', cookie: createSession(), headers: { origin: 'https://evil.example' } }), ctx);
    expect(r.status).toBe(403);
    expect((await h(req('/api/x', { method: 'POST', cookie: createSession(), headers: { origin: ORIGIN } }), ctx)).status).toBe(200);
  });
  it('errors: HttpError shows its message, anything else is a generic 500 with no details', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = await withAuth(() => { throw new HttpError(418, 'teapot'); })(req('/api/x', { cookie: createSession() }), ctx);
    expect([a.status, (await a.json()).error]).toEqual([418, 'teapot']);
    const b = await withAuth(() => { throw new Error('SELECT secret FROM somewhere failed'); })(req('/api/x', { cookie: createSession() }), ctx);
    expect(b.status).toBe(500);
    expect(JSON.stringify(await b.json())).not.toContain('SELECT');
    spy.mockRestore();
  });
  it('publicRoute does not need a session but still checks origin on POST', async () => {
    const h = publicRoute(ok);
    expect((await h(req('/api/login'), ctx)).status).toBe(200);
    expect((await h(req('/api/login', { method: 'POST' }), ctx)).status).toBe(403);
  });
});

describe('POST /api/login and /api/logout', () => {
  const attempt = (key: string, ip: string) => login(req('/api/login', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ key }) }), ctx);
  it('wrong key: 401 and no cookie', async () => {
    const r = await attempt('fbl_wrong', '10.0.0.1');
    expect(r.status).toBe(401);
    expect(r.headers.get('set-cookie')).toBeNull();
  });
  it('right key: session cookie that is HttpOnly + SameSite=Strict, and it verifies', async () => {
    const r = await attempt(KEY, '10.0.0.2');
    expect(r.status).toBe(200);
    const c = r.headers.get('set-cookie')!;
    expect(c).toMatch(/HttpOnly/i); expect(c).toMatch(/SameSite=strict/i); expect(c).toMatch(/Path=\//i); expect(c).toMatch(/Max-Age=604800/i);
    const value = c.split(';')[0].split('=').slice(1).join('=');
    expect(verifySession(decodeURIComponent(value))).toBe(true);
    expect(c.startsWith('fbl_session=')).toBe(true); // plain name outside production
  });
  it('in production: __Host- prefix and Secure', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const c = (await attempt(KEY, '10.0.0.3')).headers.get('set-cookie')!;
    expect(c.startsWith('__Host-fbl_session=')).toBe(true);
    expect(c).toMatch(/Secure/i);
    expect(c).not.toMatch(/Domain=/i);
  });
  it('malformed bodies are 400, oversized is 400, cross-origin is 403', async () => {
    const send = (body: string, origin = ORIGIN) => login(req('/api/login', { method: 'POST', headers: { origin, 'x-forwarded-for': '10.0.0.4' }, body }), ctx);
    expect((await send('not json')).status).toBe(400);
    expect((await send('{"key": 5}')).status).toBe(400);
    expect((await send('{"key":"' + 'a'.repeat(2000) + '"}')).status).toBe(400);
    expect((await send(JSON.stringify({ key: KEY }), 'https://evil.example')).status).toBe(403);
  });
  it('6th attempt from one address is 429 even with the right key; another address is unaffected', async () => {
    for (let i = 0; i < 5; i++) expect((await attempt('fbl_wrong', '10.0.0.5')).status).toBe(401);
    const blocked = await attempt(KEY, '10.0.0.5');
    expect(blocked.status).toBe(429);
    expect((await attempt(KEY, '10.0.0.6')).status).toBe(200);
  });
  it('logout clears the cookie', async () => {
    const r = await logout(req('/api/logout', { method: 'POST', headers: { origin: ORIGIN } }), ctx);
    expect(r.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
  });
});
