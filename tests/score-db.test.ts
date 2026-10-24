import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, useDbForTests } from '@/lib/db';
import { HttpError } from '@/lib/errors';
import { parseFilters } from '@/lib/filters';
import { recordToRow } from '@/lib/ingest';
import { pageDetail, queryPages, saveSignals, saveWebsite, selectForEnrich, selectForExport, upsertPage } from '@/lib/pages';
import { postSignals } from '@/lib/signals';

const mk = (id: string, followers: number) => recordToRow({ pageId: id, pageUrl: `https://www.facebook.com/p${id}/`, title: `Page ${id}`, followers, address: 'Cairo, Egypt' }, 'seed')!; // no phone: a mobile number would add WhatsApp points
const post = (text: string, comments = 0) => ({ text, time: new Date(Date.now() - 86_400_000).toISOString(), comments });
const posts = (n: number, f: (i: number) => ReturnType<typeof post>) => postSignals(Array.from({ length: n }, (_, i) => f(i)));
const noAds = { ads_active: 0, ads_message_cta: false, ads_first_start: null };

// a1: no website, orders by message and cash on delivery -> web shop.  b1: has a site, 15 comments a post and message ads -> WhatsApp.
// d1: read, nothing notable -> skip.  c1: the biggest page, posts not read yet -> no pitch.
beforeEach(() => {
  useDbForTests(openDb(':memory:'));
  for (const [id, n] of [['a1', 5000], ['b1', 80_000], ['c1', 900_000], ['d1', 3000]] as const) upsertPage(mk(id, n));
  saveWebsite('a1', { status: 'none_found' }); saveWebsite('b1', { status: 'listed_verified' }); saveWebsite('d1', { status: 'listed_verified' });
  saveSignals('a1', { posts: posts(8, (i) => post(i < 2 ? 'السعر في الخاص' : i === 2 ? 'الدفع عند الاستلام' : 'منتج جديد')), ads: noAds, adsChecked: true, cost: 0 });
  saveSignals('b1', { posts: posts(8, () => post('منتج جديد', 15)), ads: { ads_active: 2, ads_message_cta: true, ads_first_start: null }, adsChecked: true, cost: 0 });
  saveSignals('d1', { posts: posts(8, () => post('منتج')), ads: noAds, adsChecked: true, cost: 0 });
});
const ids = (q: Record<string, string>, o = {}) => queryPages(parseFilters(q), o).rows.map((r) => r.fb_page_id);

describe('scores in the list', () => {
  it('every row carries its scores and pitch', () => {
    const rows = Object.fromEntries(queryPages({}).rows.map((r) => [r.fb_page_id, r]));
    expect(rows.a1).toMatchObject({ shop_fit: 85, pitch: 'shop' });
    expect(rows.b1).toMatchObject({ wa_fit: 60, pitch: 'wa' });
    expect(rows.d1).toMatchObject({ pitch: 'skip' });
    expect(rows.c1.pitch).toBeNull();
  });
  it('sorts by fit: pages whose posts were read first, best score first; ascending reverses it', () => {
    expect(ids({}, { sort: 'fit', dir: 'desc' })).toEqual(['a1', 'b1', 'd1', 'c1']);
    expect(ids({}, { sort: 'fit', dir: 'asc' })).toEqual(['c1', 'd1', 'b1', 'a1']);
    expect(ids({}, { sort: 'fit', dir: 'desc', limit: 2, offset: 2 })).toEqual(['d1', 'c1']); // paging works on the sorted set
    expect(queryPages({}, { sort: 'fit', limit: 1 }).total).toBe(4);
  });
  it('the detail view explains the score with reasons', () => {
    const s = pageDetail('a1')!.score;
    expect(s).toMatchObject({ shop: 85, pitch: 'shop', blocked: null });
    expect(s.reasons.map((r) => r.text)).toEqual(expect.arrayContaining([expect.stringMatching(/No website found/), expect.stringMatching(/orders by message in 2 of 8/), expect.stringMatching(/Cash on delivery in 1 of 8/)]));
    expect(pageDetail('c1')!.score.missing).toContain('Posts and ads not read yet');
  });
});

describe('the pitch filter', () => {
  it('filters the list', () => {
    expect(ids({ pitch: 'shop' })).toEqual(['a1']);
    expect(ids({ pitch: 'wa' })).toEqual(['b1']);
    expect(ids({ pitch: 'skip' })).toEqual(['d1']);
    expect(ids({ pitch: 'none' })).toEqual(['c1']);
    expect(queryPages(parseFilters({ pitch: 'shop' })).total).toBe(1);
  });
  it('combines with other filters', () => {
    expect(ids({ pitch: 'wa', 'min-followers': '90000' })).toEqual([]);
    expect(ids({ pitch: 'skip', 'max-followers': '4000' })).toEqual(['d1']);
  });
  it('means the same for jobs and the CSV, which take the same filters', () => {
    expect(selectForEnrich({ pitch: 'none' }, { limit: 10, recheck: false }).map((p) => p.fb_page_id)).toEqual(['c1']);
    expect(selectForEnrich({ pitch: 'shop' }, { limit: 10, recheck: true }).map((p) => p.fb_page_id)).toEqual(['a1']);
    const csv = selectForExport({ pitch: 'shop' });
    expect(csv.map((r) => r.title)).toEqual(['Page a1']); expect(csv[0]).toMatchObject({ shop_fit: 85, wa_fit: expect.any(Number), pitch: 'shop' });
  });
  it('rejects values outside the list', () => expect(() => parseFilters({ pitch: "shop'; drop table pages" })).toThrowError(HttpError));
  it('your seller mark changes the pitch immediately (no stored score to go stale)', async () => {
    const { savePage } = await import('@/lib/pages');
    savePage('a1', { verdict: 'seller_no' });
    expect(ids({ pitch: 'shop' })).toEqual([]); expect(ids({ pitch: 'skip' }).sort()).toEqual(['a1', 'd1']);
  });
});
