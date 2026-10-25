import { describe, expect, it } from 'vitest';
import { fitSort, matchesPitch, scorePage, THRESHOLD, WEIGHTS as W, type ScoreInput } from '@/lib/score';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const base: ScoreInput = {
  followers: 20_000, country: 'Egypt', verdict: null, website_status: null, whatsapp_source: null, ad_running: 0,
  enriched_at: null, last_post_at: null, posts_fetched: null, posts_30d: null, inbox_posts: null, cod_posts: null, shop_link_posts: null, comments_total: null,
  ads_checked: null, ads_active: null, ads_message_cta: null,
};
// A page whose posts and ads were read: posting daily, nothing notable in the posts.
const read = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  ...base, enriched_at: '2026-10-24T10:00:00Z', last_post_at: '2026-10-23T10:00:00Z', posts_fetched: 8, posts_30d: 8,
  inbox_posts: 0, cod_posts: 0, shop_link_posts: 0, comments_total: 0, ads_checked: 1, ads_active: 0, ads_message_cta: 0, ...over,
});
const s = (i: ScoreInput) => scorePage(i, NOW);
const pts = (i: ScoreInput, side: 'shop' | 'wa') => s(i)[side];

describe('gates', () => {
  it('a page you marked as not a seller, or one outside Egypt, scores zero and is skipped', () => {
    for (const [over, why] of [[{ verdict: 'seller_no' }, /not a real seller/], [{ country: 'Saudi Arabia' }, /Saudi Arabia, not Egypt/]] as const) {
      expect(s(read({ ...over, website_status: 'none_found' }))).toMatchObject({ shop: 0, wa: 0, pitch: 'skip', blocked: expect.stringMatching(why) });
    }
  });
  it('an unknown country is not a reason to drop a page, only a note', () => {
    const r = s({ ...base, country: null, website_status: 'none_found' });
    expect(r.blocked).toBeNull(); expect(r.missing).toContain('Location unknown'); expect(r.shop).toBeGreaterThan(0);
  });
  it('an abandoned page (last post more than 90 days ago) is skipped; 90 days is still alive', () => {
    const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
    expect(s(read({ last_post_at: ago(91), posts_30d: 0 }))).toMatchObject({ pitch: 'skip', blocked: expect.stringMatching(/91 days ago.*abandoned/) });
    expect(s(read({ last_post_at: ago(90), posts_30d: 0 })).blocked).toBeNull();
  });
});

describe('not enough data', () => {
  it('a page whose posts were not read has no pitch yet, only provisional scores from what we do know', () => {
    const r = s({ ...base, website_status: 'none_found' });
    expect(r.pitch).toBeNull();
    expect(r.shop).toBe(W.shop.noSite + W.shop.followers);
    expect(r.missing).toContain('Posts and ads not read yet');
  });
  it('a private or empty page (no posts could be read) has no pitch either', () => {
    const r = s(read({ posts_fetched: 0, posts_30d: 0, last_post_at: null }));
    expect(r.pitch).toBeNull(); expect(r.missing).toContain('No posts could be read (private or empty page)');
  });
});

describe('store platform (shop_fit)', () => {
  it('a detected store is a reason against pitching a web shop; a site with none detected is explained, not penalised', () => {
    const up = { website_status: 'listed_verified', inbox_posts: 3, ads_active: 2 }; // enough other points that the score is not clamped at 0
    const plain = read(up), withStore = read({ ...up, store_platform: 'salla' });
    expect(pts(withStore, 'shop') - pts(plain, 'shop')).toBe(W.shop.hasStore);
    const store = s(withStore);
    expect(store.reasons.some((r) => r.text.includes('salla'))).toBe(true);
  });
});

describe('website (shop_fit)', () => {
  it('no website found earns the points; a site earns none but is explained; unknown is a note, not a penalty', () => {
    expect(pts(read({ website_status: 'none_found' }), 'shop') - pts(read({ website_status: 'listed_verified' }), 'shop')).toBe(W.shop.noSite);
    for (const w of ['listed_verified', 'listed_unverified', 'listed_blocked', 'found_verified']) {
      const r = s(read({ website_status: w }));
      expect(r.reasons.find((x) => /Has a website/.test(x.text))).toMatchObject({ side: 'shop', points: 0 });
    }
    expect(s(read({ website_status: null })).missing).toContain('Website not checked yet');
    for (const w of ['listed_unreachable', 'listed_dead', 'found_probable']) expect(s(read({ website_status: w })).missing).toContain('Website needs a human look');
    expect(pts(read({ website_status: 'listed_dead' }), 'shop')).toBe(pts(read({ website_status: null }), 'shop'));
  });
});

describe('signals from posts', () => {
  it('orders by message: half the points for one post, full for two or more, on both scores', () => {
    const none = read(), one = read({ inbox_posts: 1 }), many = read({ inbox_posts: 3 });
    expect(pts(one, 'shop') - pts(none, 'shop')).toBe(W.shop.inbox / 2); expect(pts(many, 'shop') - pts(none, 'shop')).toBe(W.shop.inbox);
    expect(pts(one, 'wa') - pts(none, 'wa')).toBe(W.wa.inbox / 2); expect(pts(many, 'wa') - pts(none, 'wa')).toBe(W.wa.inbox);
  });
  it('posting often needs 4 posts in 30 days', () => {
    expect(pts(read({ posts_30d: 3 }), 'shop') + W.shop.active).toBe(pts(read({ posts_30d: 4 }), 'shop'));
    expect(pts(read({ posts_30d: 3 }), 'wa') + W.wa.active).toBe(pts(read({ posts_30d: 4 }), 'wa'));
  });
  it('cash on delivery helps the shop score only', () => {
    const r = read({ cod_posts: 2 });
    expect(pts(r, 'shop') - pts(read(), 'shop')).toBe(W.shop.cod); expect(pts(r, 'wa')).toBe(pts(read(), 'wa'));
  });
  it('an order link (already sells through a site) lowers the shop score, never below zero', () => {
    const r = s(read({ shop_link_posts: 8, followers: 100 })); // nothing else scores except posting often
    expect(r.shop).toBe(0); expect(r.reasons.find((x) => x.points < 0)!.text).toMatch(/order link in 8 of 8 posts/);
    const site = { website_status: 'none_found' };
    expect(pts(read({ ...site, shop_link_posts: 1 }), 'shop')).toBe(pts(read(site), 'shop') + W.shop.orderLink);
  });
  it('many comments per post helps the WhatsApp score (a proxy: we keep counts, not what people ask)', () => {
    expect(pts(read({ comments_total: 80 }), 'wa') - pts(read({ comments_total: 79 }), 'wa')).toBe(W.wa.comments); // 10 per post
  });
});

describe('ads', () => {
  it('a successful ads lookup wins over the page flag', () => {
    expect(pts(read({ ad_running: 1, ads_checked: 1, ads_active: 0 }), 'shop')).toBe(pts(read(), 'shop'));
    expect(pts(read({ ad_running: 0, ads_checked: 1, ads_active: 2 }), 'shop')).toBe(pts(read(), 'shop') + W.shop.ads);
  });
  it('if the lookup failed, the page flag is used and the gap is noted', () => {
    const r = s(read({ ad_running: 1, ads_checked: 0 }));
    expect(r.shop).toBe(pts(read(), 'shop') + W.shop.ads); expect(r.missing).toContain('Ads lookup failed');
  });
  it('only a message or WhatsApp button helps the WhatsApp score', () => {
    expect(pts(read({ ads_active: 3, ads_message_cta: 1 }), 'wa')).toBe(pts(read(), 'wa') + W.wa.messageAds);
    expect(pts(read({ ads_active: 3, ads_message_cta: 0 }), 'wa')).toBe(pts(read(), 'wa'));
  });
});

describe('contact and size', () => {
  it('WhatsApp linked on the page is worth full points; a mobile guess half', () => {
    expect(pts(read({ whatsapp_source: 'page' }), 'wa') - pts(read(), 'wa')).toBe(W.wa.whatsapp);
    expect(pts(read({ whatsapp_source: 'phone_guess' }), 'wa') - pts(read(), 'wa')).toBe(W.wa.whatsapp / 2);
  });
  it('the follower sweet spot is 2,000 to 200,000, inclusive', () => {
    const f = (n: number) => pts(read({ followers: n }), 'shop');
    expect([f(1999), f(2000), f(200_000), f(200_001)]).toEqual([f(1999), f(1999) + W.shop.followers, f(1999) + W.shop.followers, f(1999)]);
  });
});

describe('pitch', () => {
  const shopOnly = read({ website_status: 'none_found', inbox_posts: 2, cod_posts: 1 }); // 30+20+15+10+10 = 85, wa: 20+10+10 = 40
  const waOnly = read({ website_status: 'listed_verified', comments_total: 400, ads_active: 2, ads_message_cta: 1, whatsapp_source: 'page' });
  it('shop, wa, both, or skip, by which score reaches the threshold', () => {
    expect(s(shopOnly)).toMatchObject({ pitch: 'shop' });
    expect(s(waOnly)).toMatchObject({ pitch: 'wa' });
    expect(s(read({ website_status: 'none_found', inbox_posts: 2, comments_total: 400, whatsapp_source: 'page' })).pitch).toBe('both');
    expect(s(read({ website_status: 'listed_verified' })).pitch).toBe('skip');
  });
  it('the threshold itself counts', () => {
    const edge = { website_status: 'none_found', followers: 100, posts_30d: 3 }; // only "no website" (30) and orders by message can score
    expect(s(read({ ...edge, inbox_posts: 2 }))).toMatchObject({ shop: THRESHOLD, pitch: 'shop' }); // 30 + 20
    expect(s(read({ ...edge, inbox_posts: 1 }))).toMatchObject({ shop: THRESHOLD - 10, pitch: 'skip' }); // 30 + 10
  });
  it('every score is the sum of its reasons, kept between 0 and 100', () => {
    for (const i of [shopOnly, waOnly, read({ shop_link_posts: 5 }), read({ website_status: 'none_found', inbox_posts: 5, cod_posts: 5, ad_running: 1, ads_active: 3 })]) {
      const r = s(i);
      for (const side of ['shop', 'wa'] as const) {
        const sum = r.reasons.filter((x) => x.side === side).reduce((a, x) => a + x.points, 0);
        expect(r[side]).toBe(Math.max(0, Math.min(100, sum)));
      }
    }
  });
  it('filters and sorting', () => {
    const [a, b, c] = [s(shopOnly), s(waOnly), s(read({ website_status: 'listed_verified' }))];
    expect(matchesPitch(a, 'shop')).toBe(true); expect(matchesPitch(a, 'wa')).toBe(false); expect(matchesPitch(a, 'both')).toBe(false);
    expect(matchesPitch(s(read({ website_status: 'none_found', inbox_posts: 2, comments_total: 400, whatsapp_source: 'page' })), 'shop')).toBe(true); // "both" counts for each side
    expect(matchesPitch(c, 'skip')).toBe(true); expect(matchesPitch(s(base), 'none')).toBe(true); expect(matchesPitch(a, 'none')).toBe(false);
    expect(fitSort(a)).toBeGreaterThan(fitSort(b)); // best score 85 vs 80
    expect(fitSort(c)).toBeGreaterThan(fitSort(s({ ...base, website_status: 'none_found' }))); // a read page ranks above a provisional one, whatever its score
  });
});

describe('an unchecked website is unknown, not a reason to skip', () => {
  const rabie = read({ followers: 165_341, website_status: null, comments_total: 2 }); // posts daily, prices, website never checked: shop 25, would be 55 with no site
  it('"check website" when the missing website check could carry the shop score over the threshold', () => {
    expect(s(rabie)).toMatchObject({ shop: 25, pitch: 'check' });
    for (const w of ['listed_unreachable', 'listed_dead', 'found_probable']) expect(s(read({ website_status: w })).pitch).toBe('check');
  });
  it('but a known website, or a page that could not reach the threshold anyway, still skips', () => {
    expect(s(read({ website_status: 'listed_verified' })).pitch).toBe('skip');
    expect(s(read({ website_status: null, followers: 100, posts_30d: 0 })).pitch).toBe('skip'); // 0 + 30 is still below the threshold
  });
  it('a clear WhatsApp or shop result is not downgraded to "check"', () => {
    expect(s(read({ website_status: null, comments_total: 400, ads_active: 2, ads_message_cta: 1, whatsapp_source: 'page' })).pitch).toBe('wa');
  });
  it('is its own filter value', () => { expect(matchesPitch(s(rabie), 'check')).toBe(true); expect(matchesPitch(s(rabie), 'skip')).toBe(false); expect(matchesPitch(s(rabie), 'shop')).toBe(false); });
});

// The nine pages of the 2026-10-24 paid test, as stored. These are regression cases for the current weights; retune them together.
describe('on real pages', () => {
  it('Amen Home: cash on delivery, 3 "Send message" ads, 377 comments on 8 posts -> a WhatsApp prospect (and a shop one, pending its unreachable site)', () => {
    const r = s(read({ followers: 22_791, website_status: 'listed_unreachable', ad_running: 1, cod_posts: 6, comments_total: 377, ads_active: 3, ads_message_cta: 1 }));
    expect(r.pitch).toBe('both'); expect(r.missing).toContain('Website needs a human look');
    const texts = r.reasons.map((x) => x.text).join('|');
    expect(texts).toMatch(/Message or WhatsApp button/); expect(texts).toMatch(/Many comments: about 47 per post/);
  });
  it('Hawaaeg: has its own site and sells through an order link -> skip', () => {
    expect(s(read({ followers: 18_579, website_status: 'listed_verified', ad_running: 1, ads_active: 3, ads_message_cta: 0, shop_link_posts: 1, whatsapp_source: 'phone_guess', comments_total: 23 })).pitch).toBe('skip');
  });
  it('Rabie store: active clothing seller with an unchecked website -> check the website, not skip', () => {
    expect(s(read({ followers: 165_341, website_status: null, comments_total: 2 })).pitch).toBe('check');
  });
  it('Kitchen Market (last post October 2023) is abandoned, whatever else it shows', () => {
    expect(s(read({ followers: 10_000, website_status: 'none_found', whatsapp_source: 'page', last_post_at: '2023-10-13T10:00:00Z', posts_30d: 0, comments_total: 55 }))).toMatchObject({ pitch: 'skip', blocked: expect.stringMatching(/abandoned/) });
  });
});
