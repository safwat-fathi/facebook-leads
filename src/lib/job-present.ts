// How a job or a search is described to a person. Pure; shared by server and client components.
import type { JobKind, JobStatus } from './jobs';
import { PITCH_LABEL, PLATFORM_LABEL, STAGE_LABEL } from './present';

export const STATUS_LABEL: Record<JobStatus, string> = { queued: 'Waiting', running: 'Running', done: 'Finished', failed: 'Failed', cancelled: 'Cancelled' };
export const KIND_LABEL: Record<JobKind, string> = { discover: 'Find pages', website_check: 'Check websites', enrich: 'Enrich' };
export const isActive = (s: JobStatus) => s === 'queued' || s === 'running';
/** What a Check or Enrich job was pointed at when that is a whole search or label (resolved on the server). */
export type JobTarget = { kind: 'search' | 'label'; id?: number; name: string };

type P = { terms?: string[]; locations?: string[]; perSearch?: number; minFollowers?: number; maxFollowers?: number; filters?: Record<string, unknown>; limit?: number; recheck?: boolean };
const nf = new Intl.NumberFormat('en');
const city = (l: string) => l.replace(/,\s*Egypt$/i, '');
// A bidi isolate (only around non-English text): Arabic inside an English line keeps its own order and does not reorder what is around it.
const iso = (text: string) => (/[^\x00-\x7f]/.test(text) ? `\u2068${text}\u2069` : text);

/**
 * What a person calls a search: their label, or its terms and cities when there is none. The Arabic terms sit inside a Unicode bidi isolate
 * (U+2068 ... U+2069), so a name that starts in Arabic still reads left to right: terms, then "+2", then the cities.
 */
export function searchName(s: { label?: string | null; params: { terms?: string[]; locations?: string[] } }): string {
  if (s.label?.trim()) return s.label.trim();
  const terms = s.params.terms ?? [];
  const shown = terms.slice(0, 2).join(', ');
  const lead = iso(shown); // a left-to-right mark in front keeps `dir="auto"` from reading the whole name as Arabic
  return `${lead === shown ? '' : '\u200e'}${lead}${terms.length > 2 ? ` +${terms.length - 2}` : ''} · ${(s.params.locations ?? []).map(city).join(', ')}`;
}
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en', { day: 'numeric', month: 'short' });

const WORD: Record<string, Record<string, string>> = {
  website: { real: 'has a website', review: 'website needs review', none: 'no website found', unknown: 'website not checked yet' },
  whatsapp: { confirmed: 'WhatsApp linked on the page', any: 'WhatsApp linked or guessed', none: 'no WhatsApp' },
  verdict: { seller_yes: 'marked real seller', seller_no: 'marked not a seller', none: 'not marked yet' },
  enriched: { yes: 'enriched', no: 'not enriched yet' },
  signal: { inbox: 'orders by message', cod: 'cash on delivery', active: 'posts often', ads: 'runs ads', message_ads: 'message or WhatsApp ads', shop_link: 'has an order link' },
};
const FILTER_TEXT: [string, (x: string) => string][] = [
  ['q', (x) => `name has “${iso(x)}”`], ['country', (x) => x], ['city', (x) => iso(x)], ['type', (x) => `type ${iso(x)}`], ['category', (x) => `category ${iso(x)}`],
  ['website', (x) => WORD.website[x] ?? x], ['platform', (x) => PLATFORM_LABEL[x] ?? 'site without a store platform'], ['whatsapp', (x) => WORD.whatsapp[x] ?? x],
  ['stage', (x) => `stage ${STAGE_LABEL[x] ?? x}`], ['verdict', (x) => WORD.verdict[x] ?? x], ['job', (x) => `search #${x}`], ['label', (x) => `label “${iso(x)}”`],
  ['enriched', (x) => WORD.enriched[x] ?? x], ['signal', (x) => WORD.signal[x] ?? x],
  ['pitch', (x) => (x === 'none' ? 'not scored yet' : `fit: ${(PITCH_LABEL as Record<string, string>)[x] ?? x}`)],
];
/** Every filter in a Check/Enrich job, in words. `skip` leaves out keys that are shown some other way (the search or label link). */
export function describeFilters(f: Record<string, unknown> = {}, skip: readonly string[] = []): string {
  const v = (k: string) => (skip.includes(k) || f[k] == null || f[k] === '' ? null : String(f[k]));
  const lo = v('minFollowers'), hi = v('maxFollowers');
  const parts = [lo && hi ? `${nf.format(Number(lo))}–${nf.format(Number(hi))} followers` : lo ? `from ${nf.format(Number(lo))} followers` : hi ? `up to ${nf.format(Number(hi))} followers` : null];
  for (const [k, say] of FILTER_TEXT) { const x = v(k); if (x) parts.push(say(x)); }
  if (f.includeUnknown && !skip.includes('includeUnknown')) parts.push('including unknown locations');
  return parts.filter(Boolean).join(', ');
}
/** The terms, cities and limits of a Find-pages search. */
export function describeSearch(p: P): string {
  const range = [p.minFollowers != null && `from ${nf.format(p.minFollowers)} followers`, p.maxFollowers != null && `up to ${nf.format(p.maxFollowers)} followers`].filter(Boolean).join(' ');
  return `${iso((p.terms ?? []).join(', '))} · ${(p.locations ?? []).map(city).join(', ')} · ${p.perSearch} per search${range ? ` · ${range}` : ''}`;
}
export function describeJob(kind: JobKind, params: unknown): string {
  const p = params as P;
  if (kind === 'discover') return `Find pages: ${describeSearch(p)}`;
  const what = kind === 'enrich' ? 'Enrich with posts and ads' : 'Check websites';
  const f = describeFilters(p.filters);
  return `${what}: up to ${p.limit} pages${f ? ` (${f})` : ''}${p.recheck ? ', including already checked' : ''}`;
}

/** Where one search lives on the Searches page (the hash scrolls to it and highlights it). */
export const searchHref = (id: number) => `/searches?open=${id}#s-${id}`;

/** What a job applied to: its own search, the search or label it was scoped to, or just its filters. */
export type AppliesTo = { scope: 'own' | 'search' | 'label' | 'filters'; text: string; href?: string; detail: string };
export function appliesTo(j: { id: number; kind: JobKind; label?: string | null; params: unknown; target?: JobTarget | null }): AppliesTo {
  const p = j.params as P;
  if (j.kind === 'discover') return { scope: 'own', text: searchName({ label: j.label, params: p }), href: searchHref(j.id), detail: describeSearch(p) };
  const detail = describeFilters(p.filters, ['job', 'label']);
  if (j.target?.kind === 'search') return { scope: 'search', text: j.target.name, href: searchHref(j.target.id!), detail };
  if (j.target?.kind === 'label') return { scope: 'label', text: j.target.name, href: `/searches?label=${encodeURIComponent(j.target.name)}`, detail };
  return { scope: 'filters', text: 'Pages matching the filters', detail: detail || 'all pages' };
}
