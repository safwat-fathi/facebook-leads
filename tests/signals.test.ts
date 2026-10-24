import { describe, expect, it } from 'vitest';
import { adSignals, groupByPage, normUrl, postSignals } from '@/lib/signals';
import posts from './fixtures/posts.json';
import ads from './fixtures/ads.json';

const NOW = Date.parse('2026-10-23T12:00:00Z');
const post = (text: string, daysAgo = 1, extra = {}) => ({ text, time: new Date(NOW - daysAgo * 86_400_000).toISOString(), ...extra });

describe('postSignals on real posts', () => {
  const byPage = groupByPage(posts, [{ fb_page_id: '100064467561154', url: 'https://www.facebook.com/electrohouseEG/' }, { fb_page_id: '61564997610097', url: 'https://www.facebook.com/golden0city/' }, { fb_page_id: '100064851034713', url: null }], ['facebookId'], ['facebookUrl']);
  it('groups scraped posts to pages by id, 8 each', () => {
    expect([...byPage.keys()].sort()).toEqual(['100064467561154', '100064851034713', '61564997610097']);
    expect(byPage.get('100064467561154')!.length).toBe(8);
  });
  it('counts, last post, prices and shop links', () => {
    const s = postSignals(byPage.get('100064467561154')!, NOW);
    expect(s.posts_fetched).toBe(8);
    expect(s.posts_30d).toBeGreaterThan(0); expect(s.posts_30d).toBeLessThanOrEqual(8);
    expect(s.last_post_at).toMatch(/^2026-10-/);
    expect(s.price_posts).toBeGreaterThan(0);
    expect(s.shop_link_posts).toBeGreaterThan(0); // "اطلبيه من الرابط" + a product URL: it already sells online
    expect(s.comments_total).toBeGreaterThan(0);
  });
  it('keeps at most 3 short quotes and no media or identities', () => {
    const s = postSignals(posts as never, NOW);
    expect(s.quotes.length).toBeLessThanOrEqual(3);
    for (const q of s.quotes) expect(q.length).toBeLessThanOrEqual(140);
    expect(Object.keys(s)).not.toContain('commenters');
  });
});

describe('selling phrases', () => {
  const sig = (...t: string[]) => postSignals(t.map((x) => post(x)), NOW);
  it('inbox ordering', () => {
    expect(sig('فستان شيك السعر في الخاص').inbox_posts).toBe(1);
    expect(sig('الأسعار على الخاص يا جماعة').inbox_posts).toBe(1);
    expect(sig('للطلب رسالة خاصة').inbox_posts).toBe(1);
    expect(sig('للطلب واتساب ٠١٠١٢٣٤٥٦٧٨').inbox_posts).toBe(1);
    expect(sig('DM to order', 'send us a message').inbox_posts).toBe(2);
  });
  it('cash on delivery', () => expect(sig('الدفع عند الاستلام لجميع المحافظات', 'cash on delivery').cod_posts).toBe(2));
  it('ordinary posts trigger nothing', () => {
    const s = sig('صباح الخير', 'منتج جديد وصل النهاردة', 'الشحن لجميع المحافظات');
    expect([s.inbox_posts, s.cod_posts, s.shop_link_posts]).toEqual([0, 0, 0]);
  });
  it('a shop link needs an actual URL', () => {
    expect(sig('اطلبه من الرابط https://shop.example.com/p/1').shop_link_posts).toBe(1);
    expect(sig('اطلبه من الرابط').shop_link_posts).toBe(0);
  });
  it('wording seen on real Egyptian sellers (paid test, 2026-10-24)', () => {
    expect(sig('قلاية هوائية Arshia المانى الاصليه 1700 وات للاستفسار برجاء ارسال صورة للمنتج علي الخاص ❤️').inbox_posts).toBe(1); // "send a photo of the product on DM"
    expect(sig('الاسعار ع الخاص', 'الاستفسار في الخاص', 'كلمنا على الخاص').inbox_posts).toBe(3);
    expect(sig('اطلبيه دلوقتي من أنسيا شوب: https://bit.ly/4w4qUtt').shop_link_posts).toBe(1); // order verb + a shop URL, no word "link"
    expect(sig('اطلبيها دلوقتي من حوائج https://rb.gy/abc').shop_link_posts).toBe(1);
    expect(sig('Order now: https://shop.example.com/p/1').shop_link_posts).toBe(1);
  });
  it('and does not over-trigger on look-alikes', () => {
    const s = sig('عرض خاص لفترة محدودة', 'قطعة خاصة جدا', 'اطلبي دلوقتي', 'تابعونا على https://www.facebook.com/page', 'مطلوب شباب للعمل في المنصوره التواصل https://forms.example.com/job');
    expect([s.inbox_posts, s.shop_link_posts]).toEqual([0, 0]);
  });
  it('Arabic-Indic prices and phones are normalised', () => {
    const s = sig('السعر ٤٥٠ جنيه واتساب ٠١٠٠٠٠٠٠١٢٣');
    expect(s.price_posts).toBe(1); expect(s.post_phones).toEqual(['+201000000123']);
  });
  it('posting frequency uses a 30-day window', () => {
    const s = postSignals([post('a', 1), post('b', 29), post('c', 31), post('d', 90)], NOW);
    expect([s.posts_fetched, s.posts_30d]).toEqual([4, 2]);
  });
  it('no posts', () => expect(postSignals([], NOW)).toMatchObject({ posts_fetched: 0, posts_30d: 0, last_post_at: null }));
});

describe('adSignals', () => {
  it('real ads: active, with a "Shop now" button (not a message ad)', () => {
    expect(adSignals(ads as never)).toMatchObject({ ads_active: 3, ads_message_cta: false });
  });
  it('message and WhatsApp buttons are detected', () => {
    expect(adSignals([{ isActive: true, snapshot: { ctaType: 'WHATSAPP_MESSAGE', ctaText: 'Send WhatsApp message' } }]).ads_message_cta).toBe(true);
    expect(adSignals([{ isActive: true, snapshot: { ctaType: 'LEARN_MORE', cards: [{ ctaType: 'MESSAGE_PAGE' }] } }]).ads_message_cta).toBe(true);
    expect(adSignals([{ isActive: true, snapshot: { ctaText: 'ارسل رسالة' } }]).ads_message_cta).toBe(true);
  });
  it('inactive ads do not count', () => expect(adSignals([{ isActive: false, snapshot: { ctaType: 'MESSAGE_PAGE' } }])).toMatchObject({ ads_active: 0, ads_message_cta: false }));
  it('none', () => expect(adSignals([])).toEqual({ ads_active: 0, ads_message_cta: false, ads_first_start: null }));
});

describe('groupByPage', () => {
  it('falls back to the url and ignores scraper error placeholders', () => {
    const g = groupByPage([{ facebookUrl: 'https://www.facebook.com/Shop/', text: 'x' }, { error: 'no_items', url: 'u' }, { facebookId: '999', text: 'unknown page' }], [{ fb_page_id: '1', url: 'https://facebook.com/shop' }], ['facebookId'], ['facebookUrl']);
    expect([...g.keys()]).toEqual(['1']);
  });
  it('normUrl', () => expect(normUrl('https://www.facebook.com/Shop/')).toBe('facebook.com/shop'));
});
