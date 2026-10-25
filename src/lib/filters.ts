// Filter parameters: validated with zod, then turned into a parameterised SQL where-clause (values are never concatenated into SQL).
import { z } from 'zod';
import { canonCity, HAS_WEBSITE, PLATFORMS, REVIEW_WEBSITE } from './parse';
import { bad } from './errors';
import { PITCH_FILTERS } from './score';

export const STAGES = ['new', 'reviewed', 'qualified', 'contacted', 'replied', 'converted', 'rejected'] as const;
export const VERDICTS = ['seller_yes', 'seller_no'] as const;

const text = (max = 80) => z.string().trim().max(max).optional();
const count = z.coerce.number().int().min(0).max(1e9).optional();
export const FilterSchema = z.object({
  q: text(), country: text(), city: text(), type: text(30), category: text(),
  minFollowers: count, maxFollowers: count,
  website: z.enum(['real', 'review', 'none', 'unknown']).optional(),
  platform: z.enum([...PLATFORMS, 'none']).optional(), // 'none' = a site was found but no store platform detected
  whatsapp: z.enum(['confirmed', 'any', 'none']).optional(),
  stage: z.enum(STAGES).optional(),
  verdict: z.enum(['seller_yes', 'seller_no', 'none']).optional(),
  job: z.coerce.number().int().positive().optional(),
  enriched: z.enum(['yes', 'no']).optional(),
  signal: z.enum(['inbox', 'cod', 'active', 'ads', 'message_ads', 'shop_link']).optional(),
  pitch: z.enum(PITCH_FILTERS).optional(), // resolved in pages.ts (the score is not SQL), so buildWhere ignores it
  includeUnknown: z.boolean().optional(),
});
export type Filters = z.infer<typeof FilterSchema>;

// URL/query names -> schema names. Empty strings mean "any" (a cleared <select>), so they are dropped.
const KEYS: Record<string, keyof Filters> = {
  q: 'q', country: 'country', city: 'city', type: 'type', category: 'category', website: 'website', platform: 'platform', whatsapp: 'whatsapp', stage: 'stage', verdict: 'verdict', job: 'job', enriched: 'enriched', signal: 'signal', pitch: 'pitch',
  'min-followers': 'minFollowers', 'max-followers': 'maxFollowers',
};
const LABEL: Record<string, string> = { minFollowers: 'Followers from', maxFollowers: 'Followers up to', q: 'Page name', country: 'Country', city: 'City', type: 'Business type', category: 'Category', website: 'Website', platform: 'Store platform', whatsapp: 'WhatsApp', stage: 'Stage', verdict: 'Seller check', job: 'Job', enriched: 'Enriched', signal: 'Signal', pitch: 'Pitch' };
const NUMERIC = new Set(['minFollowers', 'maxFollowers', 'job']);
function say(i: z.core.$ZodIssue): string {
  const key = String(i.path[0]);
  const name = LABEL[key] ?? key;
  if (NUMERIC.has(key)) return `${name} must be a whole number${key === 'job' ? ' above 0' : ' of 0 or more'}`;
  if (i.code === 'invalid_value') return `${name} is not one of the available options`;
  if (i.code === 'too_big') return `${name} is too long`;
  return `${name} is not valid`;
}
export type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;
export function parseFilters(raw: RawParams): Filters {
  const get = (k: string) => { const v = raw instanceof URLSearchParams ? raw.get(k) : raw[k]; return Array.isArray(v) ? v[0] : v ?? undefined; };
  const input: Record<string, unknown> = {};
  for (const [param, key] of Object.entries(KEYS)) { const v = get(param); if (v !== undefined && v !== '') input[key] = v; }
  if (get('include-unknown') === '1') input.includeUnknown = true;
  const r = FilterSchema.safeParse(input);
  if (!r.success) throw bad(`Invalid filter: ${r.error.issues.map(say).join('; ')}`);
  return r.data;
}
// Back to a URL query (for links that keep the current filters, and for the export link).
export function filtersToQuery(f: Filters): URLSearchParams {
  const q = new URLSearchParams();
  const rev = Object.fromEntries(Object.entries(KEYS).map(([param, key]) => [key, param]));
  for (const [key, v] of Object.entries(f)) if (v !== undefined && key !== 'includeUnknown') q.set(rev[key], String(v));
  if (f.includeUnknown) q.set('include-unknown', '1');
  return q;
}

const list = (a: readonly string[]) => a.map((s) => `'${s}'`).join(','); // constants only, never user input
export function buildWhere(f: Filters): { where: string; params: Record<string, string | number> } {
  const w: string[] = [], p: Record<string, string | number> = {};
  const unk = (col: string) => (f.includeUnknown ? ` or ${col} is null` : '');
  if (f.minFollowers != null) { w.push('followers >= :minF'); p.minF = f.minFollowers; }
  if (f.maxFollowers != null) { w.push('followers <= :maxF'); p.maxF = f.maxFollowers; }
  if (f.country) { w.push(`(lower(country) = lower(:country)${unk('country')})`); p.country = f.country; }
  if (f.city) { w.push(`(lower(city) = lower(:city)${unk('city')})`); p.city = canonCity(f.city) ?? f.city; }
  if (f.type) { w.push("instr(',' || business_type || ',', ',' || lower(:type) || ',') > 0"); p.type = f.type; } // business_type is a comma list
  if (f.category) { w.push("lower(categories) like '%' || lower(:category) || '%'"); p.category = f.category; }
  if (f.q) { w.push("lower(title) like '%' || lower(:q) || '%'"); p.q = f.q; }
  if (f.stage) { w.push('stage = :stage'); p.stage = f.stage; }
  if (f.verdict === 'none') w.push('verdict is null');
  else if (f.verdict) { w.push('verdict = :verdict'); p.verdict = f.verdict; }
  if (f.job) { w.push("instr(',' || discovered_by || ',', ',job:' || :job || ',') > 0"); p.job = String(f.job); } // a string: node:sqlite binds JS numbers as floats, so 12 would concatenate as "12.0"
  if (f.enriched === 'yes') w.push('enriched_at is not null'); else if (f.enriched === 'no') w.push('enriched_at is null');
  const SIGNAL: Record<string, string> = { inbox: 'inbox_posts >= 1', cod: 'cod_posts >= 1', active: 'posts_30d >= 4', ads: 'ads_active >= 1', message_ads: 'ads_message_cta = 1', shop_link: 'shop_link_posts >= 1' };
  if (f.signal) w.push(SIGNAL[f.signal]); // fixed strings, chosen by a validated enum
  if (f.whatsapp === 'confirmed') w.push("whatsapp_source = 'page'");
  else if (f.whatsapp === 'any') w.push('whatsapp is not null');
  else if (f.whatsapp === 'none') w.push('whatsapp is null');
  if (f.website === 'real') w.push(`website_status in (${list(HAS_WEBSITE)})`);
  else if (f.website === 'review') w.push(`website_status in (${list(REVIEW_WEBSITE)})`);
  else if (f.website === 'none') w.push("website_status = 'none_found'");
  else if (f.website === 'unknown') w.push('website_status is null');
  if (f.platform === 'none') w.push(`website_status in (${list(HAS_WEBSITE)}) and store_platform is null`);
  else if (f.platform) { w.push('store_platform = :platform'); p.platform = f.platform; }
  return { where: w.length ? 'where ' + w.join(' and ') : '', params: p };
}
