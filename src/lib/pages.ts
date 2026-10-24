// Queries and writes on the `pages` table (ported from probe/db.mjs). Everything user-supplied is a bound parameter.
import 'server-only';
import { z } from 'zod';
import { getDb } from './db';
import { buildWhere, STAGES, VERDICTS, type Filters } from './filters';
import { HAS_WEBSITE, REVIEW_WEBSITE, type WebsiteStatus } from './parse';
import { bad, HttpError } from './errors';
import type { PageRow } from './ingest';
import type { AdSignals, PostSignals } from './signals';
import { fitSort, matchesPitch, scorePage, type Pitch, type Score, type ScoreInput } from './score';

const FROM = 'from pages left join signals using (fb_page_id)'; // filters may use signal columns
const SCORE_COLS = 'fb_page_id, followers, country, verdict, website_status, whatsapp_source, ad_running, enriched_at, last_post_at, posts_fetched, posts_30d, inbox_posts, cod_posts, shop_link_posts, comments_total, ads_checked, ads_active, ads_message_cta';

// node:sqlite returns null-prototype objects, which React refuses to pass to client components: copy rows into plain objects here, once.
const rows = <T>(sql: string, params: Record<string, string | number | null> = {}) => getDb().prepare(sql).all(params).map((r) => ({ ...r })) as unknown as T[];
const one = <T>(sql: string, params: Record<string, string | number | null> = {}) => { const r = getDb().prepare(sql).get(params); return (r ? { ...r } : undefined) as unknown as T | undefined; };

// The score is computed in TypeScript (it also produces the reasons), so a "pitch" filter is resolved here to the ids that match and passed as one JSON
// parameter. Every consumer of Filters (the list, the CSV, the enrich and check jobs) goes through this, so the filter means the same thing everywhere.
function whereOf(f: Filters) {
  const { where, params } = buildWhere(f);
  if (!f.pitch) return { where, params };
  const want = f.pitch;
  const ids = rows<ScoreInput & { fb_page_id: string }>(`select ${SCORE_COLS} ${FROM} ${where}`, params).filter((r) => matchesPitch(scorePage(r), want)).map((r) => r.fb_page_id);
  return { where: `${where}${where ? ' and' : 'where'} fb_page_id in (select value from json_each(:pitchIds))`, params: { ...params, pitchIds: JSON.stringify(ids) } };
}

// ---- writes ----
// Ingest owns the Facebook-side columns; website_* and stage/notes/verdict are never touched here, so re-ingesting keeps them.
const UPSERT = `insert into pages (fb_page_id, url, title, categories, category, business_type, followers, country, city, district, location_source,
    phone, email, wa, whatsapp, whatsapp_source, ad_running, website_listed, website_listed_class, raw, discovered_by, first_seen, last_seen)
  values (:fb_page_id, :url, :title, :categories, :category, :business_type, :followers, :country, :city, :district, :location_source,
    :phone, :email, :wa, :whatsapp, :whatsapp_source, :ad_running, :website_listed, :website_listed_class, :raw, :discovered_by, :now, :now)
  on conflict(fb_page_id) do update set url=excluded.url, title=excluded.title, categories=excluded.categories, category=excluded.category,
    business_type=excluded.business_type, followers=excluded.followers,
    country=excluded.country, city=excluded.city, district=excluded.district, location_source=excluded.location_source,
    phone=excluded.phone, email=excluded.email, wa=excluded.wa, whatsapp=excluded.whatsapp, whatsapp_source=excluded.whatsapp_source,
    ad_running=excluded.ad_running, website_listed=excluded.website_listed, website_listed_class=excluded.website_listed_class, raw=excluded.raw,
    discovered_by=case when instr(',' || discovered_by || ',', ',' || excluded.discovered_by || ',') > 0 then discovered_by else discovered_by || ',' || excluded.discovered_by end,
    last_seen=excluded.last_seen`;
export function upsertPage(row: PageRow): 'inserted' | 'updated' {
  const existed = !!one('select 1 x from pages where fb_page_id = :id', { id: row.fb_page_id });
  getDb().prepare(UPSERT).run({ ...row, now: new Date().toISOString() });
  return existed ? 'updated' : 'inserted';
}

export type WebsiteResult = { url?: string | null; domain?: string | null; status: WebsiteStatus; evidence?: unknown; cost?: number | null };
export function saveWebsite(id: string, r: WebsiteResult) {
  getDb().prepare(`update pages set website_url=:url, website_domain=:domain, website_status=:status, website_evidence=:evidence,
    website_checked_at=:at, agent_cost_usd=:cost where fb_page_id=:id`).run({ id, url: r.url ?? null, domain: r.domain ?? null, status: r.status, evidence: JSON.stringify(r.evidence ?? {}), at: new Date().toISOString(), cost: r.cost ?? null });
}

const Update = z.object({
  stage: z.enum(STAGES).optional(),
  verdict: z.enum(VERDICTS).nullable().optional(),
  notes: z.string().max(5000, 'notes must be at most 5000 characters').optional(),
}).strict();
export function savePage(id: string, body: unknown) {
  const r = Update.safeParse(body);
  if (!r.success) throw bad(r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  const u = r.data;
  const keys = (Object.keys(u) as (keyof typeof u)[]).filter((k) => u[k] !== undefined);
  if (!keys.length) throw bad('nothing to update');
  const sets = keys.map((k) => `${k} = :${k}`).join(', '); // keys come from the fixed schema above, never from the client
  const res = getDb().prepare(`update pages set ${sets} where fb_page_id = :id`).run({ ...Object.fromEntries(keys.map((k) => [k, u[k] ?? null])), id });
  if (!res.changes) throw new HttpError(404, 'no such page');
}

// ---- reads ----
export type ListRow = {
  fb_page_id: string; title: string | null; url: string; followers: number; city: string | null; country: string | null; location_source: string | null;
  business_type: string | null; category: string | null; whatsapp: string | null; whatsapp_source: string | null; phone: string | null;
  website_listed_class: string | null; website_status: WebsiteStatus | null; website_url: string | null; website_domain: string | null; stage: string; verdict: string | null;
  enriched_at: string | null; inbox_posts: number | null; cod_posts: number | null; shop_link_posts: number | null; posts_30d: number | null; ads_active: number | null; ads_message_cta: number | null;
  ad_running: number | null; last_post_at: string | null; posts_fetched: number | null; comments_total: number | null; ads_checked: number | null;
  shop_fit: number; wa_fit: number; pitch: Pitch | null;
};
const SORTS: Record<string, string> = { followers: 'followers', title: 'title collate nocase', city: 'city', website: 'website_status', stage: 'stage' };
export const SORT_KEYS = [...Object.keys(SORTS), 'fit']; // 'fit' is sorted in memory (see queryPages)
const LIST_COLS = 'fb_page_id, title, url, followers, city, country, location_source, business_type, category, whatsapp, whatsapp_source, phone, website_listed_class, website_status, website_url, website_domain, stage, verdict, enriched_at, inbox_posts, cod_posts, shop_link_posts, posts_30d, ads_active, ads_message_cta, ad_running, last_post_at, posts_fetched, comments_total, ads_checked';
export type PageOpts = { sort?: string; dir?: string; limit?: number; offset?: number };
type RawRow = Omit<ListRow, 'shop_fit' | 'wa_fit' | 'pitch'>;
const withFit = (r: RawRow): { row: ListRow; score: Score } => { const score = scorePage(r); return { row: { ...r, shop_fit: score.shop, wa_fit: score.wa, pitch: score.pitch }, score }; };
export function queryPages(f: Filters, o: PageOpts = {}): { total: number; rows: ListRow[] } {
  const { where, params } = whereOf(f);
  const limit = Math.min(Math.max(Math.trunc(o.limit ?? 50) || 50, 1), 200), offset = Math.max(Math.trunc(o.offset ?? 0) || 0, 0);
  const dir = o.dir === 'asc' ? 'asc' : 'desc';
  const total = one<{ n: number }>(`select count(*) n ${FROM} ${where}`, params)!.n;
  if (o.sort === 'fit') {
    // ponytail: the score lives in TypeScript, so a fit sort scores the whole filtered set in memory. Fine for thousands of pages; store the score in a column if this ever lags.
    const all = rows<RawRow>(`select ${LIST_COLS} ${FROM} ${where}`, params).map(withFit);
    const sign = dir === 'asc' ? 1 : -1;
    all.sort((a, b) => sign * (fitSort(a.score) - fitSort(b.score)) || b.row.followers - a.row.followers);
    return { total, rows: all.slice(offset, offset + limit).map((x) => x.row) };
  }
  const order = `${SORTS[o.sort ?? ''] ?? SORTS.followers} ${dir}`;
  return { total, rows: rows<RawRow>(`select ${LIST_COLS} ${FROM} ${where} order by ${order}, followers desc limit :limit offset :offset`, { ...params, limit, offset }).map((r) => withFit(r).row) };
}

// One page for the drawer. The raw Apify record is not returned (it holds signed WhatsApp link tokens); only what the UI shows.
type Col = string | number | null;
export type PageDetail = {
  fb_page_id: string; url: string; title: string | null; categories: string | null; category: string | null; business_type: string | null; followers: number;
  country: string | null; city: string | null; district: string | null; location_source: string | null;
  phone: string | null; email: string | null; whatsapp: string | null; whatsapp_source: string | null; ad_running: number;
  website_listed_class: string | null; website_url: string | null; website_domain: string | null; website_status: WebsiteStatus | null; website_checked_at: string | null; agent_cost_usd: number | null;
  stage: string; notes: string | null; verdict: string | null; discovered_by: string | null; first_seen: string | null; last_seen: string | null;
  wa: string[]; website_listed: { url: string; cls: string }[]; website_evidence: Record<string, unknown> | null;
  intro: string | null; address: string | null; ad_status: string | null; creation_date: string | null;
  signals: SignalsRow | null;
  score: Score;
};
export function pageDetail(id: string): PageDetail | null {
  const r = one<Record<string, Col>>('select * from pages where fb_page_id = :id', { id });
  if (!r) return null;
  const { raw, wa, website_listed, website_evidence, ...rest } = r;
  const rec = JSON.parse(String(raw ?? '{}'));
  return {
    ...(rest as Omit<PageDetail, 'wa' | 'website_listed' | 'website_evidence' | 'intro' | 'address' | 'ad_status' | 'creation_date' | 'score'>),
    wa: JSON.parse(String(wa ?? '[]')), website_listed: JSON.parse(String(website_listed ?? '[]')),
    website_evidence: website_evidence ? JSON.parse(String(website_evidence)) : null,
    intro: rec.intro ?? null, address: rec.address ?? null, ad_status: rec.ad_status ?? null, creation_date: rec.creation_date ?? null,
    signals: signalsFor(id),
    score: scorePage(one<ScoreInput>(`select ${SCORE_COLS} ${FROM} where fb_page_id = :id`, { id })!),
  };
}

// ---- enrichment signals ----
export type SignalsRow = Omit<PostSignals, 'post_phones' | 'quotes'> & AdSignals & { enriched_at: string; ads_checked: number; post_phones: string[]; quotes: string[]; cost_usd: number | null };
export function signalsFor(id: string): SignalsRow | null {
  const r = one<Record<string, Col>>('select * from signals where fb_page_id = :id', { id });
  if (!r) return null;
  const { fb_page_id: _id, post_phones, quotes, ads_message_cta, ...rest } = r;
  return { ...(rest as unknown as SignalsRow), ads_message_cta: !!ads_message_cta, post_phones: JSON.parse(String(post_phones ?? '[]')), quotes: JSON.parse(String(quotes ?? '[]')) };
}
const EMPTY_POSTS: PostSignals = { posts_fetched: 0, posts_30d: 0, last_post_at: null, inbox_posts: 0, cod_posts: 0, shop_link_posts: 0, price_posts: 0, comments_total: 0, post_phones: [], quotes: [] };
const EMPTY_ADS: AdSignals = { ads_active: 0, ads_message_cta: false, ads_first_start: null };
export function saveSignals(id: string, s: { posts: PostSignals | null; ads: AdSignals | null; adsChecked: boolean; cost: number }) {
  const ps = s.posts ?? EMPTY_POSTS, ads = s.ads ?? EMPTY_ADS;
  getDb().prepare(`insert into signals (fb_page_id, enriched_at, posts_fetched, posts_30d, last_post_at, inbox_posts, cod_posts, shop_link_posts, price_posts, comments_total, post_phones, quotes, ads_checked, ads_active, ads_message_cta, ads_first_start, cost_usd)
    values (:id, :at, :pf, :p30, :last, :inbox, :cod, :shop, :price, :comments, :phones, :quotes, :checked, :aa, :amc, :afs, :cost)
    on conflict(fb_page_id) do update set enriched_at=excluded.enriched_at, posts_fetched=excluded.posts_fetched, posts_30d=excluded.posts_30d, last_post_at=excluded.last_post_at,
      inbox_posts=excluded.inbox_posts, cod_posts=excluded.cod_posts, shop_link_posts=excluded.shop_link_posts, price_posts=excluded.price_posts, comments_total=excluded.comments_total,
      post_phones=excluded.post_phones, quotes=excluded.quotes, ads_checked=excluded.ads_checked, ads_active=excluded.ads_active, ads_message_cta=excluded.ads_message_cta,
      ads_first_start=excluded.ads_first_start, cost_usd=excluded.cost_usd`).run({
    id, at: new Date().toISOString(), pf: ps.posts_fetched, p30: ps.posts_30d, last: ps.last_post_at, inbox: ps.inbox_posts, cod: ps.cod_posts, shop: ps.shop_link_posts, price: ps.price_posts,
    comments: ps.comments_total, phones: JSON.stringify(ps.post_phones), quotes: JSON.stringify(ps.quotes), checked: s.adsChecked ? 1 : 0, aa: ads.ads_active, amc: ads.ads_message_cta ? 1 : 0, afs: ads.ads_first_start, cost: s.cost,
  });
}
export type EnrichRow = { fb_page_id: string; url: string; title: string | null; ad_running: number };
// Pages for an enrichment job: in the filter, not enriched yet (or all, with recheck), biggest first. A page needs a URL to be scraped.
export function selectForEnrich(f: Filters, o: { limit: number; recheck: boolean }): EnrichRow[] {
  const { where, params } = whereOf(f);
  const extra = ['url is not null', ...(o.recheck ? [] : ['enriched_at is null'])].join(' and ');
  return rows<EnrichRow>(`select fb_page_id, url, title, ad_running ${FROM} ${where}${where ? ' and ' : 'where '}${extra} order by followers desc limit :limit`, { ...params, limit: o.limit });
}
export function countForEnrich(f: Filters, o: { limit: number; recheck: boolean }) {
  const picked = selectForEnrich(f, o);
  return { total: picked.length, adsPages: picked.filter((p) => p.ad_running).length };
}

export function facets() {
  const col = (c: 'country' | 'city') => rows<{ v: string; n: number }>(`select ${c} v, count(*) n from pages where ${c} is not null group by 1 order by 2 desc`);
  const types: Record<string, number> = {};
  for (const r of rows<{ t: string | null }>('select business_type t from pages')) for (const t of (r.t ?? '').split(',')) if (t) types[t] = (types[t] ?? 0) + 1;
  return { countries: col('country'), cities: col('city'), types: Object.entries(types).sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ v, n })) };
}
const inList = (a: readonly string[]) => a.map((s) => `'${s}'`).join(',');
export function stats() {
  const n = (where: string) => one<{ n: number }>(`select count(*) n from pages where ${where}`)!.n;
  return {
    total: n('1=1'), whatsappConfirmed: n("whatsapp_source = 'page'"), whatsappGuess: n("whatsapp_source = 'phone_guess'"),
    hasWebsite: n(`website_status in (${inList(HAS_WEBSITE)})`), review: n(`website_status in (${inList(REVIEW_WEBSITE)})`),
    enriched: one<{ n: number }>('select count(*) n from signals')!.n, noneFound: n("website_status = 'none_found'"), unchecked: n('website_status is null'),
    sellerYes: n("verdict = 'seller_yes'"), sellerNo: n("verdict = 'seller_no'"),
  };
}

// Pages a website-check job will process: those passing the filters that have no result yet (or all, with recheck), biggest first.
export type CheckRow = { fb_page_id: string; url: string | null; title: string | null; city: string | null; phone: string | null; wa: string | null; categories: string | null; website_listed: string | null; website_listed_class: string | null; raw: string };
export function selectForCheck(f: Filters, o: { limit: number; recheck: boolean }): CheckRow[] {
  const { where, params } = whereOf(f);
  const extra = o.recheck ? '' : `${where ? ' and' : 'where'} website_status is null`;
  return rows<CheckRow>(`select fb_page_id, url, title, city, phone, wa, categories, website_listed, website_listed_class, raw ${FROM} ${where}${extra} order by followers desc limit :limit`, { ...params, limit: o.limit });
}
// Same selection, counts only (for the cost estimate).
export function countForCheck(f: Filters, o: { limit: number; recheck: boolean }): { total: number; listed: number; needAgent: number } {
  const picked = selectForCheck(f, o);
  const listed = picked.filter((p) => p.website_listed_class === 'real').length;
  return { total: picked.length, listed, needAgent: picked.length - listed };
}

// CSV export of the current filters (capped; a spreadsheet of thousands of leads is plenty for one person).
export const EXPORT_MAX = 5000;
export function selectForExport(f: Filters): Record<string, string | number | null>[] {
  const { where, params } = whereOf(f);
  return rows<Record<string, string | number | null> & ScoreInput>(
    `select title, url, city, business_type, category, whatsapp, phone, email, website_domain, stage, notes, ${SCORE_COLS}
     ${FROM} ${where} order by followers desc limit :limit`, { ...params, limit: EXPORT_MAX }).map((r) => { const s = scorePage(r); return { ...r, shop_fit: s.shop, wa_fit: s.wa, pitch: s.pitch }; });
}
