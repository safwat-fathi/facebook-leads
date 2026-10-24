// Job engine: a queue in SQLite and ONE worker that runs one job at a time (bounds spend and Apify load).
// Budgets, in three layers: per job (checked before every paid step, against its worst case), MAX_JOB_USD at creation,
// and DAILY_BUDGET_USD across jobs (from the spend ledger). Cancel aborts the in-flight Apify run; a restart marks
// interrupted jobs failed and aborts their runs so they stop charging.
import 'server-only';
import { getDb } from './db';
import { getEnv } from './env';
import { HttpError, bad } from './errors';
import { apifyPort, type ApifyPort } from './apify';
import { openRouterLlm, type LlmPort } from './llm';
import { recordToRow } from './ingest';
import { countForCheck, countForEnrich, saveSignals, saveWebsite, selectForCheck, selectForEnrich, upsertPage } from './pages';
import { adSignals, groupByPage, postSignals } from './signals';
import { classifyWebsite, listedStatus, type PageRef, type SiteCheck, type WebsiteStatus } from './parse';
import { webInfo } from './present';
import { checkSite } from './website-check';
import { LLM_TURN_WORST_USD, pageRef, runAgent, SEARCH_WORST_USD, type Charger } from './website-agent';
import { ADS_PER_PAGE, CreateJob, ENRICH_BATCH, enrichBatchCost, estimateCheck, estimateDiscover, estimateEnrich, POSTS_PER_PAGE, searchCost, suggestedBudget, type CheckParams, type DiscoverParams } from './jobs-schema';

export type JobKind = 'discover' | 'website_check' | 'enrich';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type JobRow = {
  id: number; kind: JobKind; params: DiscoverParams | CheckParams; status: JobStatus; budget_usd: number; spent_usd: number;
  progress: string | null; error: string | null; cancel_requested: number; created_at: string; started_at: string | null; finished_at: string | null;
};
export type JobDetail = JobRow & { log: string };
export type JobDeps = { apify?: ApifyPort; llm?: LlmPort; check: (url: string, page: PageRef, signal?: AbortSignal) => Promise<SiteCheck>; model?: string };

const db = () => getDb();
const q = <T>(sql: string, p: Record<string, string | number | null> = {}) => db().prepare(sql).all(p).map((r) => ({ ...r })) as unknown as T[];
const q1 = <T>(sql: string, p: Record<string, string | number | null> = {}) => { const r = db().prepare(sql).get(p); return (r ? { ...r } : undefined) as unknown as T | undefined; };
const hydrate = <T extends { params: unknown }>(r: T): T => ({ ...r, params: JSON.parse(r.params as string) });
const COLS = 'id, kind, params, status, budget_usd, spent_usd, progress, error, cancel_requested, created_at, started_at, finished_at';
const nowIso = () => new Date().toISOString();

// ---- reads ----
export const listJobs = (limit = 30): JobRow[] => q<JobRow>(`select ${COLS} from jobs order by id desc limit :limit`, { limit }).map(hydrate);
export const getJob = (id: number): JobDetail | null => { const r = q1<JobDetail>(`select ${COLS}, log from jobs where id = :id`, { id }); return r ? hydrate(r) : null; };
export const spentLast24h = () => q1<{ s: number }>("select coalesce(sum(usd), 0) s from spend where at > :since", { since: new Date(Date.now() - 24 * 3600_000).toISOString() })!.s;
// Money already promised to queued/running jobs but not spent yet.
const committed = () => q1<{ s: number }>("select coalesce(sum(max(budget_usd - spent_usd, 0)), 0) s from jobs where status in ('queued', 'running')")!.s;
export const budgetStatus = () => { const env = getEnv(); const spent = spentLast24h(); return { spent24h: spent, dailyLimit: env.DAILY_BUDGET_USD, maxJob: env.MAX_JOB_USD, available: Math.max(0, env.DAILY_BUDGET_USD - spent - committed()) }; };

// ---- estimates and creation ----
export function estimate(input: unknown) {
  const r = CreateJob.safeParse(input);
  if (!r.success) throw bad(r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  const job = r.data;
  if (job.kind === 'discover') {
    const e = estimateDiscover(job.params);
    return { kind: job.kind, usd: e.usd, suggestedBudgetUsd: suggestedBudget(e.usd), detail: { searches: e.searches, perSearch: job.params.perSearch, pricePerSearch: searchCost(job.params.perSearch) }, job };
  }
  if (job.kind === 'enrich') {
    const c = countForEnrich(job.params.filters, { limit: job.params.limit, recheck: job.params.recheck });
    return { kind: job.kind, usd: estimateEnrich(c).usd, suggestedBudgetUsd: suggestedBudget(estimateEnrich(c).usd), detail: c, job };
  }
  const c = countForCheck(job.params.filters, { limit: job.params.limit, recheck: job.params.recheck });
  const e = estimateCheck(c);
  return { kind: job.kind, usd: e.usd, suggestedBudgetUsd: suggestedBudget(e.usd), detail: c, job };
}

export function createJob(input: unknown, deps?: { kick?: () => void }): JobRow {
  const env = getEnv();
  const est = estimate(input);
  const job = est.job;
  const budgetUsd = job.budgetUsd ?? est.suggestedBudgetUsd;
  const needsApify = job.kind !== 'website_check' || (est.detail as { needAgent: number }).needAgent > 0;
  const needsLlm = job.kind === 'website_check' && (est.detail as { needAgent: number }).needAgent > 0;
  if (needsApify && !env.APIFY_TOKEN) throw bad('APIFY_TOKEN is not set on the server, so searches cannot run.');
  if (needsLlm && !env.OPENROUTER_API_KEY) throw bad('OPENROUTER_API_KEY is not set on the server, so the website agent cannot run.');
  if (job.kind !== 'discover' && (est.detail as { total: number }).total === 0) throw bad(`No pages match: nothing to ${job.kind === 'enrich' ? 'enrich' : 'check'}. Widen the filters or tick "recheck".`);
  if (budgetUsd > env.MAX_JOB_USD) throw bad(`Budget $${budgetUsd} is above the per-job limit of $${env.MAX_JOB_USD} (MAX_JOB_USD).`);
  const b = budgetStatus();
  if (budgetUsd > b.available) throw bad(`Daily budget: $${b.spent24h.toFixed(2)} spent in the last 24 h of $${b.dailyLimit} (DAILY_BUDGET_USD), $${b.available.toFixed(2)} available.`);
  if ((q1<{ n: number }>("select count(*) n from jobs where status = 'queued'")!.n) >= 10) throw bad('Too many jobs are waiting. Let some finish or cancel one.');
  const res = db().prepare("insert into jobs (kind, params, budget_usd, log, created_at) values (:kind, :params, :budget, :log, :at)")
    .run({ kind: job.kind, params: JSON.stringify(job.params), budget: budgetUsd, log: `${nowIso().slice(11, 19)} queued (budget $${budgetUsd.toFixed(2)}, estimate $${est.usd.toFixed(2)})\n`, at: nowIso() });
  deps?.kick?.();
  return getJob(Number(res.lastInsertRowid))!;
}

// ---- cancel ----
// Process-wide state lives on globalThis: Next bundles instrumentation.ts (the worker) and the route handlers (Cancel) as separate
// module instances, so a module-level Map would not be shared between them.
const g = globalThis as unknown as { __fblWorker?: { stop(): void; kick(): void }; __fblLive?: Map<number, AbortController> };
const live = (g.__fblLive ??= new Map<number, AbortController>());
export function cancelJob(id: number): JobRow {
  const j = getJob(id);
  if (!j) throw new HttpError(404, 'no such job');
  if (j.status === 'queued') db().prepare("update jobs set status = 'cancelled', finished_at = :at, error = 'cancelled before it started' where id = :id and status = 'queued'").run({ id, at: nowIso() });
  else if (j.status === 'running') { db().prepare('update jobs set cancel_requested = 1 where id = :id').run({ id }); live.get(id)?.abort(); }
  else throw bad(`The job already ${j.status}.`);
  return getJob(id)!;
}

// ---- running ----
function makeCtx(id: number, ac: AbortController) {
  const log = (line: string) => db().prepare("update jobs set log = substr(log || :line, -20000) where id = :id").run({ id, line: `${nowIso().slice(11, 19)} ${line}\n` });
  const ctx: Charger & { log(m: string): void; progress(m: string): void; spent(): number } = {
    signal: ac.signal,
    spent: () => q1<{ s: number }>('select spent_usd s from jobs where id = :id', { id })!.s,
    remaining: () => q1<{ b: number }>('select budget_usd - spent_usd b from jobs where id = :id', { id })!.b,
    charge(provider, usd, note) {
      if (!(usd > 0)) return;
      db().prepare('insert into spend (job_id, provider, usd, note, at) values (:id, :provider, :usd, :note, :at)').run({ id, provider, usd, note, at: nowIso() });
      db().prepare('update jobs set spent_usd = spent_usd + :usd where id = :id').run({ id, usd });
    },
    apifyRunStarted(runId) { db().prepare("update jobs set apify_runs = json_insert(apify_runs, '$[#]', :run) where id = :id").run({ id, run: runId }); },
    log, progress: (m) => db().prepare('update jobs set progress = :m where id = :id').run({ id, m }),
  };
  return ctx;
}
type Ctx = ReturnType<typeof makeCtx>;
// Callers ledger the cost of runs that succeed. A run that fails or is cancelled may already have charged: the port puts that cost on the error, and this records it once for every call site.
function chargeFailures(port: ApifyPort, ctx: Ctx): ApifyPort {
  return {
    ...port,
    async run(actor, input, o) {
      try { return await port.run(actor, input, o); }
      catch (e) { const c = (e as { costUsd?: number }).costUsd; if (c) ctx.charge('apify', c, `${actor} (not completed)`); throw e; }
    },
  };
}
const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`;

async function runDiscover(jobId: number, p: DiscoverParams, d: JobDeps, ctx: Ctx) {
  if (!d.apify) throw new Error('Apify is not configured');
  const pairs = p.terms.flatMap((t) => p.locations.map((l) => [t, l] as const));
  const worst = searchCost(p.perSearch);
  let created = 0, updated = 0, skipped = 0, failures = 0;
  for (const [i, [term, loc]] of pairs.entries()) {
    if (ctx.signal.aborted) break;
    if (ctx.remaining() < worst) { ctx.log(`Stopped before search ${i + 1}/${pairs.length}: ${usd(ctx.remaining())} left, the next search could cost up to ${usd(worst)}.`); break; }
    ctx.progress(`Search ${i + 1}/${pairs.length}: ${term} in ${loc} (${created} new pages so far)`);
    try {
      const run = await d.apify.run('apify/facebook-search-scraper', { categories: [term], locations: [loc], searchType: 'pages-google', resultsLimit: p.perSearch }, { maxChargeUsd: Math.max(0.5, worst * 1.5), signal: ctx.signal, onStarted: ctx.apifyRunStarted });
      ctx.charge('apify', run.costUsd, `search "${term}" in ${loc}`);
      let c = 0;
      for (const item of run.items) {
        const row = recordToRow(item, `job:${jobId}`);
        if (!row) { skipped++; continue; }
        if (upsertPage(row) === 'inserted') { created++; c++; } else updated++;
      }
      failures = 0;
      ctx.log(`"${term}" in ${loc}: ${run.items.length} results, ${c} new, cost ${usd(run.costUsd)}`);
    } catch (e) {
      if (ctx.signal.aborted) break;
      ctx.log(`"${term}" in ${loc}: failed (${String((e as Error).message).slice(0, 160)})`);
      if (++failures >= 3) throw new Error('Three searches in a row failed; stopping.');
    }
  }
  ctx.progress(`${created} new pages, ${updated} already known${skipped ? `, ${skipped} results without a page id skipped` : ''}`);
}

// Recent posts + ads for the pages in a filter, five pages per Apify run. Pages the scraper reports nothing for are still marked
// enriched (posts_fetched = 0: private or empty), so they are not paid for again. Ads are only fetched for pages Facebook says run ads.
async function runEnrich(p: CheckParams, d: JobDeps, ctx: Ctx) {
  if (!d.apify) throw new Error('Apify is not configured');
  const pages = selectForEnrich(p.filters, { limit: p.limit, recheck: p.recheck });
  let saved = 0, failedBatches = 0, consecutive = 0, i = 0;
  while (i < pages.length) {
    if (ctx.signal.aborted) break;
    const cost = (n: number) => enrichBatchCost(n, pages.slice(i, i + n).filter((x) => x.ad_running).length);
    let k = Math.min(ENRICH_BATCH, pages.length - i);
    while (k > 0 && cost(k) > ctx.remaining()) k--; // the largest batch whose worst case still fits
    if (k === 0) { ctx.log(`Stopped before page ${i + 1}/${pages.length}: ${usd(ctx.remaining())} left, the next page could cost up to ${usd(cost(1))}.`); break; }
    const batch = pages.slice(i, i + k); i += k;
    ctx.progress(`Pages ${i - k + 1}-${i} of ${pages.length}`);
    const opts = { maxChargeUsd: Math.max(0.5, cost(k) * 1.5), signal: ctx.signal, onStarted: ctx.apifyRunStarted };
    try {
      const posts = await d.apify.run('apify/facebook-posts-scraper', { startUrls: batch.map((b) => ({ url: b.url })), resultsLimit: POSTS_PER_PAGE }, opts);
      ctx.charge('apify', posts.costUsd, `posts for ${k} pages`);
      let runCost = posts.costUsd;
      const adPages = batch.filter((b) => b.ad_running);
      let ads: Record<string, unknown>[] | null = adPages.length ? null : [];
      if (adPages.length) {
        try {
          const r = await d.apify.run('apify/facebook-ads-scraper', { startUrls: adPages.map((b) => ({ url: b.url })), resultsLimit: ADS_PER_PAGE, activeStatus: 'active' }, opts);
          ctx.charge('apify', r.costUsd, `ads for ${adPages.length} pages`); runCost += r.costUsd; ads = r.items;
        } catch (e) { if (ctx.signal.aborted) break; ctx.log(`ads for ${adPages.length} pages failed (${String((e as Error).message).slice(0, 120)}); saving their posts without ad data`); }
      }
      const byPost = groupByPage(posts.items, batch, ['facebookId'], ['facebookUrl', 'inputUrl']);
      // The scraper's own page id is the Ad Library's, not ours (it differs for newer pages), but it echoes the URL we sent.
      const byAd = groupByPage(ads ?? [], batch, ['pageID', 'pageId'], ['inputUrl']);
      for (const b of batch) {
        saveSignals(b.fb_page_id, {
          posts: postSignals(byPost.get(b.fb_page_id) ?? []),
          ads: b.ad_running ? (ads ? adSignals(byAd.get(b.fb_page_id) ?? []) : null) : null,
          adsChecked: !b.ad_running || ads !== null, // no ads reported by Facebook = known; an ads run that failed = unknown
          cost: runCost / k,
        });
        saved++;
      }
      consecutive = 0;
      ctx.log(`${k} pages: ${posts.items.filter((x) => !x.error).length} posts${adPages.length ? `, ${ads ? ads.filter((x) => !Array.isArray(x.results)).length : 'no'} ads` : ''}, cost ${usd(runCost)}`);
    } catch (e) {
      if (ctx.signal.aborted) break;
      failedBatches++;
      ctx.log(`pages ${i - k + 1}-${i}: failed (${String((e as Error).message).slice(0, 160)})`);
      if (++consecutive >= 3) throw new Error('Three batches in a row failed; stopping.');
    }
  }
  ctx.progress(`${saved} pages enriched${failedBatches ? `, ${failedBatches} batch(es) failed` : ''}`);
}

async function runCheck(p: CheckParams, d: JobDeps, ctx: Ctx) {
  const pages = selectForCheck(p.filters, { limit: p.limit, recheck: p.recheck });
  const tally: Record<string, number> = {};
  const count = (s: string) => { tally[s] = (tally[s] ?? 0) + 1; };
  for (const [i, page] of pages.entries()) {
    if (ctx.signal.aborted) break;
    ctx.progress(`Page ${i + 1}/${pages.length}: ${(page.title ?? '').slice(0, 40)}`);
    try {
      const web = classifyWebsite(JSON.parse(page.raw));
      if (web.cls === 'real' && web.url) { // the page lists its own site: free check
        const r = await d.check(web.url, pageRef(page), ctx.signal);
        const status = listedStatus(r);
        saveWebsite(page.fb_page_id, { url: web.url, domain: web.domain, status, evidence: { source: 'facebook_listed', hosted_on: web.hosted_on, check: r } });
        count(status); ctx.log(`${page.title}: ${status} (${web.domain}, http ${r.status ?? r.error})`);
        continue;
      }
      if (!d.apify || !d.llm) { ctx.log(`${page.title}: skipped (search is not configured)`); continue; }
      if (ctx.remaining() < SEARCH_WORST_USD + LLM_TURN_WORST_USD) { ctx.log(`Stopped before "${page.title}": ${usd(ctx.remaining())} left.`); break; }
      const before = ctx.spent();
      const out = await runAgent(page, { apify: d.apify, llm: d.llm, check: d.check, ctx });
      const cost = ctx.spent() - before;
      if (!out.status) { ctx.log(`${page.title}: not saved (${out.note})`); if (out.note === 'budget reached') break; continue; }
      saveWebsite(page.fb_page_id, { url: out.url, domain: out.domain, status: out.status, cost, evidence: { source: 'agent', model: d.model, note: out.note, ...out.evidence, cost_usd: cost } });
      count(out.status); ctx.log(`${page.title}: ${out.status}${out.url ? ' ' + out.url : ''} (${usd(cost)}) ${out.note}`);
    } catch (e) {
      if (ctx.signal.aborted) break;
      ctx.log(`${page.title}: failed (${String((e as Error).message).slice(0, 160)})`);
    }
  }
  ctx.progress(`Checked ${Object.values(tally).reduce((a, b) => a + b, 0)} of ${pages.length}: ${Object.entries(tally).map(([k, v]) => `${v} ${webInfo({ website_status: k as WebsiteStatus, website_listed_class: null }).text.toLowerCase()}`).join(', ') || 'nothing saved'}`);
}

/** Claim the oldest queued job and run it. Returns false when there was nothing to do. */
export async function processNext(d: JobDeps): Promise<boolean> {
  const claimed = q1<{ id: number }>("update jobs set status = 'running', started_at = :at where id = (select id from jobs where status = 'queued' order by id limit 1) returning id", { at: nowIso() });
  if (!claimed) return false;
  const job = getJob(claimed.id)!;
  const ac = new AbortController();
  live.set(job.id, ac);
  const ctx = makeCtx(job.id, ac);
  ctx.log(`started (${job.kind}, budget ${usd(job.budget_usd)})`);
  let status: JobStatus = 'done', error: string | null = null;
  const dd: JobDeps = { ...d, apify: d.apify && chargeFailures(d.apify, ctx) };
  try {
    if (job.kind === 'discover') await runDiscover(job.id, job.params as DiscoverParams, dd, ctx);
    else if (job.kind === 'enrich') await runEnrich(job.params as CheckParams, dd, ctx);
    else await runCheck(job.params as CheckParams, dd, ctx);
    if (ac.signal.aborted || getJob(job.id)!.cancel_requested) { status = 'cancelled'; error = 'cancelled while running'; }
  } catch (e) {
    if (ac.signal.aborted) { status = 'cancelled'; error = 'cancelled while running'; }
    else { status = 'failed'; error = String((e as Error).message).slice(0, 300); }
  } finally { live.delete(job.id); }
  ctx.log(`${status}${error ? `: ${error}` : ''} (spent ${usd(ctx.spent())})`);
  db().prepare('update jobs set status = :status, error = :error, finished_at = :at where id = :id').run({ id: job.id, status, error, at: nowIso() });
  return true;
}

/** At startup: jobs left "running" by a crash/restart cannot continue; abort their Apify runs so they stop charging. */
export async function recoverInterrupted(apify?: ApifyPort): Promise<number> {
  const stuck = q<{ id: number; apify_runs: string }>("select id, apify_runs from jobs where status = 'running'");
  for (const j of stuck) {
    for (const run of JSON.parse(j.apify_runs) as string[]) await apify?.abort(run).catch(() => {});
    db().prepare("update jobs set status = 'failed', error = 'interrupted by a server restart', finished_at = :at, log = substr(log || :line, -20000) where id = :id").run({ id: j.id, at: nowIso(), line: `${nowIso().slice(11, 19)} interrupted by a server restart; its Apify runs were aborted\n` });
  }
  return stuck.length;
}

// ---- the worker ----
export function defaultDeps(): JobDeps {
  const env = getEnv();
  return {
    apify: env.APIFY_TOKEN ? apifyPort(env.APIFY_TOKEN) : undefined,
    llm: env.OPENROUTER_API_KEY ? openRouterLlm(env.OPENROUTER_API_KEY, env.AGENT_MODEL) : undefined,
    check: (url, page, signal) => checkSite(url, page, { signal }),
    model: env.AGENT_MODEL,
  };
}
export function startWorker(deps: JobDeps = defaultDeps()) {
  if (g.__fblWorker) return g.__fblWorker; // `next dev` can run register() more than once
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { while (await processNext(deps)); } catch (e) { console.error('job worker error', e); } finally { busy = false; }
  };
  void recoverInterrupted(deps.apify).then((n) => { if (n) console.warn(`marked ${n} interrupted job(s) as failed`); }).then(tick);
  const timer = setInterval(tick, 2000);
  timer.unref();
  return (g.__fblWorker = { stop: () => { clearInterval(timer); g.__fblWorker = undefined; }, kick: () => void tick() });
}
export const kickWorker = () => g.__fblWorker?.kick();
