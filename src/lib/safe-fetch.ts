// Fetching URLs that Facebook page owners and search results control is an SSRF risk on a server: a page could list
// http://127.0.0.1:5432, an internal host, or the cloud metadata address 169.254.169.254. Everything that fetches a
// third-party site goes through safeFetch, which:
//   - allows only http(s) on ports 80/443 and no credentials in the URL;
//   - refuses private/loopback/link-local/reserved addresses (IPv4 and IPv6, incl. IPv4-mapped IPv6);
//   - checks the address AT CONNECT TIME (undici `lookup` hook), so a DNS answer can't change between check and use (rebinding);
//   - follows redirects itself (max 5) and re-checks every hop;
//   - streams the body with a hard size cap and a timeout, and skips non-text content.
import 'server-only';
import dns from 'node:dns';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

export class SafeFetchError extends Error {
  constructor(public code: 'EBLOCKED_URL' | 'EBLOCKED_ADDRESS' | 'EREDIRECTS' | 'ETIMEOUT' | 'ENETWORK' | 'EABORT', message: string, public cause?: unknown) {
    super(message);
  }
}

// ---- address classification ----
const v4 = (ip: string): number[] | null => {
  const p = ip.split('.');
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return p.map(Number);
};
function publicV4(b: number[]): boolean {
  const [a, c] = b;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this-net, private, loopback, multicast + reserved + broadcast
  if (a === 100 && c >= 64 && c <= 127) return false; // CGNAT 100.64/10
  if (a === 169 && c === 254) return false; // link-local, includes 169.254.169.254 (cloud metadata)
  if (a === 172 && c >= 16 && c <= 31) return false;
  if (a === 192 && c === 168) return false;
  if (a === 192 && c === 0 && (b[2] === 0 || b[2] === 2)) return false; // 192.0.0.0/24, 192.0.2.0/24
  if (a === 198 && (c === 18 || c === 19)) return false; // benchmarking
  if (a === 198 && c === 51 && b[2] === 100) return false;
  if (a === 203 && c === 0 && b[2] === 113) return false;
  return true;
}
// IPv6 text -> 16 bytes (handles "::" and a dotted IPv4 tail), or null.
function parseV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) { const b = v4(tail[1]); if (!b) return null; s = s.slice(0, -tail[1].length) + ((b[0] << 8) | b[1]).toString(16) + ':' + ((b[2] << 8) | b[3]).toString(16); }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [], rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const groups = [...head, ...(halves.length === 2 ? Array(fill).fill('0') : []), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 255]);
}
export function isPublicIp(ip: string): boolean {
  const f = isIP(ip);
  if (f === 4) return publicV4(v4(ip)!);
  if (f !== 6) return false;
  const b = parseV6(ip);
  if (!b) return false;
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 255 && b[11] === 255) return publicV4(b.slice(12)); // ::ffff:a.b.c.d (IPv4-mapped)
  if ((b[0] & 0xe0) !== 0x20) return false; // only global unicast 2000::/3; rejects ::, ::1, fc00::/7, fe80::/10, ff00::/8, NAT64, ...
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false; // 2001:db8::/32 documentation
  if (b[0] === 0x20 && b[1] === 0x02) return false; // 6to4 embeds an IPv4 address: refuse
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return false; // Teredo
  return true;
}

// ---- URL validation ----
export function assertSafeUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new SafeFetchError('EBLOCKED_URL', 'not a valid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new SafeFetchError('EBLOCKED_URL', `scheme ${u.protocol} is not allowed`);
  if (u.username || u.password) throw new SafeFetchError('EBLOCKED_URL', 'credentials in a URL are not allowed');
  if (u.port && u.port !== '80' && u.port !== '443') throw new SafeFetchError('EBLOCKED_URL', `port ${u.port} is not allowed`);
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) throw new SafeFetchError('EBLOCKED_ADDRESS', 'host is not a public site');
  if (isIP(host) && !isPublicIp(host)) throw new SafeFetchError('EBLOCKED_ADDRESS', 'address is not public');
  return u;
}

// ---- connect-time guard ----
type LookupCb = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;
export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
const systemResolver: Resolver = (host) => dns.promises.lookup(host, { all: true });
export function makeGuardedLookup(resolve: Resolver = systemResolver) {
  return (hostname: string, options: { all?: boolean; family?: number }, cb: LookupCb) => {
    resolve(hostname).then((addrs) => {
      if (!addrs.length) return cb(Object.assign(new Error('no address'), { code: 'ENOTFOUND' }), []);
      if (addrs.some((a) => !isPublicIp(a.address))) return cb(Object.assign(new Error(`${hostname} resolves to a non-public address`), { code: 'EBLOCKED_ADDRESS' }), []);
      if (options?.all) cb(null, addrs); else cb(null, addrs[0].address, addrs[0].family);
    }, (err) => cb(err, []));
  };
}
const agent = new Agent({ connect: { lookup: makeGuardedLookup() as never }, headersTimeout: 15_000, bodyTimeout: 15_000 });

// ---- the fetch ----
export type SafeResponse = { status: number; finalUrl: string; headers: Headers; contentType: string; body: string; truncated: boolean };
export type Transport = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TEXTUAL = /^(text\/|application\/(xhtml\+xml|xml|json))/i;

export async function safeFetch(
  url: string,
  o: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; signal?: AbortSignal; transport?: Transport } = {},
): Promise<SafeResponse> {
  const { timeoutMs = 12_000, maxBytes = 400_000, maxRedirects = 5 } = o;
  const transport: Transport = o.transport ?? ((u, init) => undiciFetch(u, { ...init, redirect: 'manual', dispatcher: agent }) as unknown as Promise<Response>);
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(o.signal ? [o.signal] : [])]);
  let current = assertSafeUrl(url);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res: Response;
    try {
      res = await transport(current.href, { signal, headers: { 'user-agent': UA, 'accept-language': 'ar,en;q=0.8', accept: 'text/html,*/*' } });
    } catch (e) {
      throw wrap(e, o.signal);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel().catch(() => {});
      current = assertSafeUrl(new URL(res.headers.get('location')!, current).href); // every hop is validated again
      continue;
    }
    const contentType = res.headers.get('content-type') ?? '';
    let body = '', truncated = false;
    if (res.body && (TEXTUAL.test(contentType) || !contentType)) {
      try { ({ body, truncated } = await readCapped(res, maxBytes, contentType)); } catch (e) { throw wrap(e, o.signal); }
    } else await res.body?.cancel().catch(() => {}); // binary: don't download it
    return { status: res.status, finalUrl: current.href, headers: res.headers, contentType, body, truncated };
  }
  throw new SafeFetchError('EREDIRECTS', `more than ${maxRedirects} redirects`);
}

async function readCapped(res: Response, max: number, contentType: string) {
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0, truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    chunks.push(size > max ? value.slice(0, value.length - (size - max)) : value);
    if (size >= max) { truncated = true; await reader.cancel().catch(() => {}); break; } // stop reading: the rest is not needed
  }
  const buf = Buffer.concat(chunks);
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? 'utf-8';
  let text: string;
  try { text = new TextDecoder(charset).decode(buf); } catch { text = new TextDecoder('utf-8').decode(buf); }
  return { body: text, truncated };
}

function wrap(e: unknown, outer?: AbortSignal): SafeFetchError {
  if (e instanceof SafeFetchError) return e;
  const err = e as { name?: string; code?: string; cause?: { code?: string } };
  const code = err?.cause?.code ?? err?.code;
  if (outer?.aborted) return new SafeFetchError('EABORT', 'cancelled', e);
  if (code === 'EBLOCKED_ADDRESS') return new SafeFetchError('EBLOCKED_ADDRESS', 'host resolves to a non-public address', e);
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') return new SafeFetchError('ETIMEOUT', 'timed out', e);
  return new SafeFetchError('ENETWORK', String(code ?? (e as Error)?.message ?? 'network error'), e);
}
/** The OS-level error code behind a failure (ENOTFOUND, ECONNREFUSED, ...), for status decisions. */
export const netCode = (e: unknown): string | null => {
  if (!(e instanceof SafeFetchError)) return null;
  if (e.code !== 'ENETWORK' && e.code !== 'EBLOCKED_ADDRESS') return e.code;
  const c = (e.cause as { cause?: { code?: string }; code?: string } | undefined);
  return c?.cause?.code ?? c?.code ?? (e.code === 'ENETWORK' ? e.message : e.code);
};
