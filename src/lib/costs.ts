// Read-only views over the spend ledger (written by ctx.charge in jobs.ts and by draftMessage in outreach.ts). Dates are UTC.
import 'server-only';
import { getDb } from './db';

const q = <T>(sql: string, p: Record<string, string | number | null> = {}) => getDb().prepare(sql).all(p).map((r) => ({ ...r })) as unknown as T[];
const sinceHours = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export type Provider = 'apify' | 'openrouter';
export const PROVIDER_LABEL: Record<Provider, string> = { apify: 'Apify', openrouter: 'LLM (OpenRouter)' };
export const WINDOWS = [['24 hours', 24], ['7 days', 24 * 7], ['30 days', 24 * 30], ['All time', 0]] as const;

/** One row per provider plus a total; one number per window in WINDOWS order. */
export function costTotals(): { provider: Provider | 'total'; usd: number[] }[] {
  const by = new Map<string, number[]>();
  for (const [i, [, h]] of WINDOWS.entries()) {
    for (const r of q<{ provider: Provider; s: number }>(`select provider, coalesce(sum(usd), 0) s from spend ${h ? 'where at > :since' : ''} group by provider`, h ? { since: sinceHours(h) } : {})) {
      const a = by.get(r.provider) ?? WINDOWS.map(() => 0); a[i] = r.s; by.set(r.provider, a);
    }
  }
  const list = (['apify', 'openrouter'] as const).map((provider) => ({ provider, usd: by.get(provider) ?? WINDOWS.map(() => 0) }));
  return [...list, { provider: 'total', usd: WINDOWS.map((_, i) => list.reduce((s, r) => s + r.usd[i], 0)) }];
}

export type DayCost = { day: string; apify: number; openrouter: number };
export function costByDay(days = 30): DayCost[] {
  return q<DayCost>(`select substr(at, 1, 10) day,
      coalesce(sum(case when provider = 'apify' then usd end), 0) apify, coalesce(sum(case when provider = 'openrouter' then usd end), 0) openrouter
    from spend where at > :since group by day order by day desc`, { since: sinceHours(days * 24) });
}

export type WorkCost = { work: string; apify: number; openrouter: number; charges: number };
/** Spend grouped by the kind of job that caused it; charges with no job are message drafts. */
export function costByWork(): WorkCost[] {
  return q<WorkCost>(`select coalesce(j.kind, 'outreach_draft') work,
      coalesce(sum(case when s.provider = 'apify' then s.usd end), 0) apify, coalesce(sum(case when s.provider = 'openrouter' then s.usd end), 0) openrouter, count(*) charges
    from spend s left join jobs j on j.id = s.job_id group by work order by apify + openrouter desc`);
}

export type SpendRow = { id: number; at: string; provider: Provider; usd: number; note: string | null; job_id: number | null; kind: string | null; label: string | null; params: string | null };
export function listSpend(o: { limit: number; offset: number }): { total: number; rows: SpendRow[] } {
  const total = q<{ n: number }>('select count(*) n from spend')[0].n;
  const rows = q<SpendRow>('select s.id, s.at, s.provider, s.usd, s.note, s.job_id, j.kind, j.label, j.params from spend s left join jobs j on j.id = s.job_id order by s.id desc limit :limit offset :offset', o);
  return { total, rows };
}

/** Emails are not a per-call cost; this is only how many were sent. */
export function emailsSent(): { last24h: number; all: number } {
  const n = (where: string, p = {}) => q<{ n: number }>(`select count(*) n from outreach_log where channel = 'email' and status = 'sent' ${where}`, p)[0].n;
  return { last24h: n('and created_at > :since', { since: sinceHours(24) }), all: n('') };
}
