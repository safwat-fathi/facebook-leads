// Job parameters and cost estimates. Pure (no I/O) so the UI and the server share them.
import { z } from 'zod';
import { FilterSchema } from './filters';

export const PRICE_PER_PAGE_USD = 0.012; // apify/facebook-search-scraper, searchType "pages-google" (measured in Phase 0)
export const SEARCH_START_USD = 0.001;
export const AGENT_PAGE_USD = 0.025; // measured $0.023 per page in the Phase 0b trial

const words = (max: number, n: number) => z.array(z.string().trim().min(1).max(80)).min(1).max(max).transform((a) => [...new Map(a.map((s) => [s.toLowerCase(), s])).values()]).pipe(z.array(z.string()).max(n));
export const DiscoverParams = z.object({
  terms: words(8, 8), locations: words(3, 3), perSearch: z.coerce.number().int().min(5).max(40),
}).strict();
export const CheckParams = z.object({
  filters: FilterSchema, limit: z.coerce.number().int().min(1).max(50), recheck: z.boolean().default(false),
}).strict();
export const EnrichParams = CheckParams; // same shape: the pages in a filter, how many, recheck
export type EnrichParams = CheckParams;
// Enrichment prices (Apify pay-per-event, measured in Phase 0): $0.005 per post, $0.0058 per ad, $0.001 per run start.
export const POST_USD = 0.005, AD_USD = 0.0058, RUN_START_USD = 0.001;
export const POSTS_PER_PAGE = 8, ADS_PER_PAGE = 3, ENRICH_BATCH = 5; // pages are scraped five at a time to save run-start fees
export const enrichBatchCost = (pages: number, adsPages: number) =>
  pages * POSTS_PER_PAGE * POST_USD + RUN_START_USD + (adsPages ? adsPages * ADS_PER_PAGE * AD_USD + RUN_START_USD : 0);
export function estimateEnrich(c: { total: number; adsPages: number }) {
  const batches = Math.ceil(c.total / ENRICH_BATCH), adBatches = Math.ceil(c.adsPages / ENRICH_BATCH);
  return { usd: c.total * POSTS_PER_PAGE * POST_USD + c.adsPages * ADS_PER_PAGE * AD_USD + (batches + adBatches) * RUN_START_USD };
}
export type DiscoverParams = z.infer<typeof DiscoverParams>;
export type CheckParams = z.infer<typeof CheckParams>;

const budget = z.coerce.number().min(0.01, 'budget must be at least $0.01').max(1000).optional();
export const CreateJob = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('discover'), params: DiscoverParams, budgetUsd: budget }).strict(),
  z.object({ kind: z.literal('website_check'), params: CheckParams, budgetUsd: budget }).strict(),
  z.object({ kind: z.literal('enrich'), params: EnrichParams, budgetUsd: budget }).strict(),
]);
export type CreateJobInput = z.infer<typeof CreateJob>;

export const searchCost = (perSearch: number) => perSearch * PRICE_PER_PAGE_USD + SEARCH_START_USD;
export function estimateDiscover(p: DiscoverParams) {
  const searches = p.terms.length * p.locations.length;
  return { searches, usd: searches * searchCost(p.perSearch) };
}
export const estimateCheck = (c: { needAgent: number }) => ({ usd: c.needAgent * AGENT_PAGE_USD });
export const suggestedBudget = (usd: number) => Math.max(0.05, Math.ceil(usd * 1.25 * 100) / 100);
