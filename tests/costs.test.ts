import { beforeEach, describe, expect, it } from 'vitest';
import { costByDay, costByWork, costTotals, emailsSent, listSpend } from '@/lib/costs';
import { getDb, openDb, useDbForTests } from '@/lib/db';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const spend = (provider: string, usd: number, h: number, jobId: number | null, note = '') =>
  getDb().prepare('insert into spend (job_id, provider, usd, note, at) values (:jobId, :provider, :usd, :note, :at)').run({ jobId, provider, usd, note, at: hoursAgo(h) });

beforeEach(() => {
  useDbForTests(openDb(':memory:'));
  const job = (kind: string) => getDb().prepare("insert into jobs (kind, params, budget_usd, created_at) values (:kind, '{}', 1, :at)").run({ kind, at: hoursAgo(1) });
  job('discover'); job('website_check');
  spend('apify', 0.5, 1, 1, 'search "a"'); spend('apify', 0.25, 48, 1, 'search "b"'); spend('openrouter', 0.01, 2, 2, 'agent turn');
  spend('openrouter', 0.002, 3, null, 'outreach draft for 100'); spend('apify', 1, 24 * 40, 1, 'old');
});

describe('costs', () => {
  it('totals per provider for each window, and all time', () => {
    const [apify, llm, total] = costTotals();
    expect(apify.usd.map((x) => +x.toFixed(3))).toEqual([0.5, 0.75, 0.75, 1.75]);
    expect(llm.usd.map((x) => +x.toFixed(3))).toEqual([0.012, 0.012, 0.012, 0.012]);
    expect(total.provider).toBe('total');
    expect(total.usd[3]).toBeCloseTo(1.762);
  });
  it('groups by UTC day and leaves out charges older than the window', () => {
    const days = costByDay(30);
    expect(days.reduce((s, d) => s + d.apify + d.openrouter, 0)).toBeCloseTo(0.762);
    expect(days.map((d) => d.day)).toEqual([...days.map((d) => d.day)].sort().reverse());
  });
  it('groups by the kind of job, and charges with no job are message drafts', () => {
    const work = Object.fromEntries(costByWork().map((w) => [w.work, w]));
    expect(work.discover.apify).toBeCloseTo(1.75);
    expect(work.website_check.openrouter).toBeCloseTo(0.01);
    expect(work.outreach_draft).toMatchObject({ openrouter: 0.002, charges: 1 });
  });
  it('lists newest first and pages', () => {
    const first = listSpend({ limit: 2, offset: 0 });
    expect(first.total).toBe(5); expect(first.rows).toHaveLength(2);
    expect(first.rows[0].note).toBe('old');
    expect(listSpend({ limit: 2, offset: 4 }).rows).toHaveLength(1);
    expect(listSpend({ limit: 5, offset: 0 }).rows.find((r) => r.job_id === null)?.kind).toBeNull();
  });
  it('counts sent emails without pricing them', () => {
    expect(emailsSent()).toEqual({ last24h: 0, all: 0 });
  });
});
