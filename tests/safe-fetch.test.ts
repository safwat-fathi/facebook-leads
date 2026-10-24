import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { Agent, fetch as undiciFetch } from 'undici';
import { assertSafeUrl, isPublicIp, makeGuardedLookup, netCode, safeFetch, SafeFetchError, type Transport } from '@/lib/safe-fetch';

describe('isPublicIp', () => {
  it.each(['0.0.0.0', '10.1.2.3', '127.0.0.1', '127.255.255.254', '100.64.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '192.0.2.1', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '64:ff9b::7f00:1', '2001:db8::1', '2002:7f00:1::1', '2001:0:0:1::1', 'not-an-ip', ''])('refuses %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'])('allows %s', (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });
});

describe('assertSafeUrl', () => {
  it.each([
    'file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)', 'data:text/html,hi', 'gopher://example.com/', 'not a url',
    'http://user:pw@example.com/', 'https://example.com:8080/', 'http://example.com:22/', 'http://example.com:5432/',
    'http://127.0.0.1/', 'http://127.0.0.1:80/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://192.168.0.1/',
    'http://2130706433/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://127.1/', 'http://localhost/', 'http://LOCALHOST/', 'http://foo.localhost/', 'http://metadata.google.internal/', 'http://printer.local/',
  ])('refuses %s', (u) => expect(() => assertSafeUrl(u)).toThrowError(SafeFetchError));
  it.each(['https://example.com', 'http://example.com:80/', 'https://example.com:443/a?b=1', 'https://xn--mgbaam7a8h.example/', 'http://93.184.216.34/'])('allows %s', (u) => {
    expect(assertSafeUrl(u).href).toBeTruthy();
  });
});

describe('connect-time guard (blocks DNS rebinding)', () => {
  const lookup = (resolver: (h: string) => Promise<{ address: string; family: number }[]>) => (host: string, all = true) =>
    new Promise<{ err: NodeJS.ErrnoException | null; res: unknown }>((ok) => makeGuardedLookup(resolver)(host, { all }, (err, address) => ok({ err, res: address })));
  it('refuses a name that resolves to a private address, even if one answer is public', async () => {
    expect((await lookup(async () => [{ address: '10.0.0.5', family: 4 }])('evil.example')).err?.code).toBe('EBLOCKED_ADDRESS');
    expect((await lookup(async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }])('evil.example')).err?.code).toBe('EBLOCKED_ADDRESS');
  });
  it('passes public answers through in both callback shapes; propagates DNS failures', async () => {
    const pub = async () => [{ address: '93.184.216.34', family: 4 }];
    expect((await lookup(pub)('ok.example', true)).res).toEqual([{ address: '93.184.216.34', family: 4 }]);
    expect((await lookup(pub)('ok.example', false)).res).toBe('93.184.216.34');
    expect((await lookup(async () => { throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' }); })('nx.example')).err?.code).toBe('ENOTFOUND');
    expect((await lookup(async () => [])('empty.example')).err?.code).toBe('ENOTFOUND');
  });
  it('the real system resolver refuses localhost', async () => {
    expect((await new Promise<NodeJS.ErrnoException | null>((ok) => makeGuardedLookup()('localhost', { all: true }, (e) => ok(e)))))?.toHaveProperty?.('code', 'EBLOCKED_ADDRESS');
  });
  it('undici really calls the hook: a real connection to a local server is refused before any byte is sent', async () => {
    let hits = 0;
    const srv = http.createServer((_, res) => { hits++; res.end('secret'); });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = (srv.address() as { port: number }).port;
    const guarded = new Agent({ connect: { lookup: makeGuardedLookup() as never } });
    try {
      // control: without the guard, this very request succeeds, so the refusal below is the guard's doing
      const open = await undiciFetch(`http://localhost:${port}/`, { dispatcher: new Agent() }).then((r) => r.text(), () => 'unreachable-without-guard');
      expect(['secret', 'unreachable-without-guard']).toContain(open);
      hits = 0;
      const err = await undiciFetch(`http://localhost:${port}/`, { dispatcher: guarded }).then(() => null, (e: { cause?: { code?: string } }) => e);
      expect(err?.cause?.code).toBe('EBLOCKED_ADDRESS');
      expect(hits).toBe(0);
    } finally { await guarded.close(); srv.close(); }
  });
});

// A fake network: each URL maps to a response factory. Every request made is recorded.
const fake = (routes: Record<string, () => Response>) => {
  const seen: string[] = [];
  const transport: Transport = async (url) => { seen.push(url); const r = routes[url]; if (!r) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); return r(); };
  return { transport, seen };
};
const html = (body: string, status = 200, headers: Record<string, string> = {}) => () => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const redirect = (to: string, status = 302) => () => new Response(null, { status, headers: { location: to } });

describe('safeFetch', () => {
  it('returns status, final url and body', async () => {
    const n = fake({ 'https://shop.example/': html('<title>مرحبا</title>') });
    const r = await safeFetch('https://shop.example/', { transport: n.transport });
    expect([r.status, r.finalUrl, r.body]).toEqual([200, 'https://shop.example/', '<title>مرحبا</title>']);
  });
  it('follows redirects (absolute and relative) and reports the final url', async () => {
    const n = fake({ 'http://a.example/': redirect('https://a.example/home'), 'https://a.example/home': redirect('/en/'), 'https://a.example/en/': html('ok') });
    const r = await safeFetch('http://a.example/', { transport: n.transport });
    expect([r.finalUrl, r.body]).toEqual(['https://a.example/en/', 'ok']);
  });
  it('never follows a redirect into a private address or a bad scheme', async () => {
    for (const to of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:80/', 'http://[::1]/', 'file:///etc/passwd', 'http://localhost/admin', 'https://a.example:6379/']) {
      const n = fake({ 'https://a.example/': redirect(to) });
      await expect(safeFetch('https://a.example/', { transport: n.transport })).rejects.toBeInstanceOf(SafeFetchError);
      expect(n.seen).toEqual(['https://a.example/']); // the dangerous URL was never requested
    }
  });
  it('stops redirect loops', async () => {
    const n = fake({ 'https://loop.example/': redirect('https://loop.example/') });
    await expect(safeFetch('https://loop.example/', { transport: n.transport })).rejects.toMatchObject({ code: 'EREDIRECTS' });
    expect(n.seen.length).toBe(6);
  });
  it('caps the body size and marks it truncated', async () => {
    const big = 'x'.repeat(2_000_000);
    const n = fake({ 'https://big.example/': html(big) });
    const r = await safeFetch('https://big.example/', { transport: n.transport, maxBytes: 100_000 });
    expect(r.body.length).toBe(100_000); expect(r.truncated).toBe(true);
  });
  it('does not download binary content', async () => {
    let read = false;
    const stream = new ReadableStream({ pull(c) { read = true; c.enqueue(new Uint8Array(10)); } }, { highWaterMark: 0 }); // pulls only on a real read
    const n = fake({ 'https://img.example/': () => new Response(stream, { headers: { 'content-type': 'application/pdf' } }) });
    const r = await safeFetch('https://img.example/', { transport: n.transport });
    expect(r.body).toBe(''); expect(r.status).toBe(200); expect(read).toBe(false);
  });
  it('decodes the declared charset (Arabic sites often use windows-1256)', async () => {
    const bytes = new Uint8Array([0xe3, 0xd1, 0xcd, 0xc8, 0xc7]); // "مرحبا" in windows-1256
    const n = fake({ 'https://ar.example/': () => new Response(bytes, { headers: { 'content-type': 'text/html; charset=windows-1256' } }) });
    expect((await safeFetch('https://ar.example/', { transport: n.transport })).body).toBe('مرحبا');
  });
  it('keeps 4xx/5xx bodies (bot-wall detection needs them)', async () => {
    const n = fake({ 'https://cf.example/': html('<title>Just a moment...</title>', 403, { server: 'cloudflare' }) });
    const r = await safeFetch('https://cf.example/', { transport: n.transport });
    expect([r.status, r.body, r.headers.get('server')]).toEqual([403, '<title>Just a moment...</title>', 'cloudflare']);
  });
  it('times out and can be cancelled', async () => {
    const hang: Transport = (_u, { signal }) => new Promise((_ok, fail) => signal.addEventListener('abort', () => fail(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    await expect(safeFetch('https://slow.example/', { transport: hang, timeoutMs: 30 })).rejects.toMatchObject({ code: 'ETIMEOUT' });
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 10);
    await expect(safeFetch('https://slow.example/', { transport: hang, signal: ctl.signal, timeoutMs: 5000 })).rejects.toMatchObject({ code: 'EABORT' });
  });
  it('surfaces the DNS error code', async () => {
    const e = await safeFetch('https://nx.example/', { transport: fake({}).transport }).catch((x) => x);
    expect(netCode(e)).toBe('ENOTFOUND');
  });
  it('a blocked address is reported as such, not as a network error', async () => {
    const e = await safeFetch('http://10.1.1.1/', { transport: fake({}).transport }).catch((x) => x);
    expect(e).toMatchObject({ code: 'EBLOCKED_ADDRESS' });
  });
});
