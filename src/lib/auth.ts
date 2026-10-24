import 'server-only';
import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getEnv } from './env';
import { sessionCookieName, SESSION_TTL_S } from './auth-shared';
import { LoginLimiter } from './rate-limit';

const sha256 = (s: string) => createHash('sha256').update(s).digest();
const eq = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

// ---- the API key ----
export const hashKey = (key: string) => sha256(key).toString('hex');
export function verifyKey(key: string, expectedHashHex = getEnv().APP_API_KEY_HASH): boolean {
  return eq(sha256(key), Buffer.from(expectedHashHex, 'hex')); // compares digests, so length/timing don't leak the key
}
export const generateKey = () => 'fbl_' + randomBytes(32).toString('base64url');

// ---- signed session cookie: v1.<payload>.<hmac> ----
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const mac = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest();
export function createSession(now = Date.now(), secret = getEnv().SESSION_SECRET): string {
  const payload = b64(JSON.stringify({ iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + SESSION_TTL_S }));
  return `v1.${payload}.${mac(`v1.${payload}`, secret).toString('base64url')}`;
}
export function verifySession(value: string | undefined | null, now = Date.now(), secret = getEnv().SESSION_SECRET): boolean {
  if (!value) return false;
  const [v, payload, sig, extra] = value.split('.');
  if (v !== 'v1' || !payload || !sig || extra !== undefined) return false;
  if (!eq(mac(`v1.${payload}`, secret), Buffer.from(sig, 'base64url'))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: unknown };
    return typeof exp === 'number' && exp * 1000 > now;
  } catch { return false; }
}
export const sessionCookieOptions = (maxAge = SESSION_TTL_S) => ({
  httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/', maxAge,
});

// ---- pages: call at the top of every page (layouts do not re-run on client navigation, so a layout check alone is not enough) ----
export async function requireAuth(): Promise<void> {
  const v = (await cookies()).get(sessionCookieName())?.value;
  if (!verifySession(v)) redirect('/login');
}

// ---- CSRF: a mutating request must come from our own origin ----
export function sameOrigin(req: Request, appOrigin = getEnv().APP_ORIGIN): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const site = req.headers.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) return false;
  return req.headers.get('origin') === appOrigin; // browsers always send Origin on POST; "null" and absent are refused
}

export const loginLimiter = new LoginLimiter();
// Behind Caddy the client address arrives in X-Forwarded-For (Caddy overwrites any client-supplied value; the app port is never published).
export const clientIp = (req: Request) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
