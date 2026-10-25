// Fetch a site and decide what we can say about it (ported from probe/lib.mjs checkSite, now through the SSRF guard).
import 'server-only';
import { detectPlatform, domainOf, signalsFor, type PageRef, type SiteCheck } from './parse';
import { netCode, safeFetch } from './safe-fetch';

const BOT_WALL = /just a moment|attention required|cf-chl|checking your browser|captcha|access denied/i;
const WALL_SERVER = /cloudflare|akamai|sucuri|incapsula/i;
export type Fetcher = typeof safeFetch;

export async function checkSite(url: string, page: PageRef, o: { signal?: AbortSignal; fetcher?: Fetcher } = {}): Promise<SiteCheck> {
  const out: SiteCheck = { url, final_url: null, dns: true, status: null, bot_wall: false, platform: null, signals: { fb_link: false, phone: false, name: false }, title: '', error: null };
  if (!domainOf(url)) return { ...out, dns: false, error: 'bad url' };
  const fetcher = o.fetcher ?? safeFetch;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetcher(url, { signal: o.signal });
      out.status = r.status; out.final_url = r.finalUrl; out.error = null;
      out.bot_wall = r.status >= 400 && (BOT_WALL.test(r.body) || WALL_SERVER.test(r.headers.get('server') ?? ''));
      out.platform = detectPlatform(r.body, r.headers, r.finalUrl ?? url);
      if (r.status < 400) { const { title, ...s } = signalsFor(r.body, page); out.signals = s; out.title = title; }
      return out;
    } catch (e) {
      const code = netCode(e) ?? 'ENETWORK';
      if (code === 'EABORT') throw e; // cancelled: let the job stop
      if (code === 'ENOTFOUND') return { ...out, dns: false, error: code }; // the domain does not exist
      out.error = code;
      if (code === 'EBLOCKED_ADDRESS' || code === 'EBLOCKED_URL' || code === 'ECONNREFUSED') return out; // retrying won't change these
    }
  }
  return out; // resolves but never answered: reported as "unreachable", for a human to look at
}
