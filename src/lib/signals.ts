// Turn a page's recent posts and ads into simple facts (counts and flags), for scoring later. Pure; tested on real Phase 0 records.
// Only aggregates and at most 3 short quotes of the BUSINESS's own posts are kept: no commenter identities, no media.
import { contacts, digits } from './parse';

type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Arabic/Egyptian selling phrases. Ordered by what they tell us:
//  inbox     = price or order goes through messages ("السعر في الخاص", "للطلب رسالة", "DM to order")
//  cod       = cash on delivery
//  shopLink  = "order from the link" with a URL: the seller already has an online checkout (bad fit for a web-shop pitch)
const INBOX = /(?:السعر|الاسعار|الأسعار|سعره|سعرها)\s*(?:ف|في|على|علي)\s*(?:ال)?(?:خاص|ماسج|مسج|رسال|انبوكس)|(?:للطلب|للحجز|للاستفسار|اطلب|اطلبي)\s*(?:عن طريق|عبر|من)?\s*(?:رسال|رساله|واتس|الواتس|الخاص|ماسج|ماسنجر|مسج)|ابعت(?:ي)?\s*(?:لنا\s*)?(?:رسال|رساله|مسج|ماسج)|(?:^|\s)(?:على|علي|ع|في|فى)\s*(?:ال)?خاص(?![\u0621-\u064A])|\binbox\b|\bdm\b|send (?:us )?a message/i; // "على الخاص" = on DM; "عرض خاص" (special offer) must not match
const COD = /الدفع عند الاستلام|دفع عند الاستلام|كاش عند الاستلام|cash on delivery|\bcod\b/i;
const SHOP_LINK = /(?:اطلب|اشتري|اشتر|تسوق)\S*\s.{0,40}?(?:الرابط|اللينك|لينك|link)|(?:اطلب|اشتر|تسوق)\S*\s[\s\S]{0,60}?https?:\/\/|(?:shop now|order now|buy now)/i; // an order verb followed by a URL ("اطلبيها دلوقتي من حوائج https://…")
const URL = /https?:\/\/\S+/i;
const PRICE = /\d+\s*(?:جنيه|جنية|ج\.?م|egp|le\b)|(?:بس|السعر)\s*\d+/i;

export type PostSignals = {
  posts_fetched: number; posts_30d: number; last_post_at: string | null;
  inbox_posts: number; cod_posts: number; shop_link_posts: number; price_posts: number;
  comments_total: number; post_phones: string[]; quotes: string[];
};
const DAY = 86_400_000;
const clip = (s: string, n = 140) => s.replace(/\s+/g, ' ').trim().slice(0, n);

export function postSignals(posts: Rec[], now = Date.now()): PostSignals {
  const out: PostSignals = { posts_fetched: posts.length, posts_30d: 0, last_post_at: null, inbox_posts: 0, cod_posts: 0, shop_link_posts: 0, price_posts: 0, comments_total: 0, post_phones: [], quotes: [] };
  const phones = new Set<string>();
  let last = 0;
  for (const p of posts) {
    const text = digits(String(p.text ?? ''));
    const t = Date.parse(p.time ?? '') || (typeof p.timestamp === 'number' ? p.timestamp * 1000 : 0);
    if (t) { last = Math.max(last, t); if (now - t < 30 * DAY) out.posts_30d++; }
    out.comments_total += Number(p.comments) || 0; // a count only
    const inbox = INBOX.test(text), cod = COD.test(text), shop = SHOP_LINK.test(text) && URL.test(text);
    if (inbox) out.inbox_posts++;
    if (cod) out.cod_posts++;
    if (shop) out.shop_link_posts++;
    if (PRICE.test(text)) out.price_posts++;
    for (const ph of contacts({ text }).phones) phones.add(ph);
    if ((inbox || cod || shop) && out.quotes.length < 3) out.quotes.push(clip(text));
  }
  out.last_post_at = last ? new Date(last).toISOString() : null;
  out.post_phones = [...phones].slice(0, 5);
  return out;
}

export type AdSignals = { ads_active: number; ads_message_cta: boolean; ads_first_start: string | null };
const MESSAGE_CTA = /MESSAGE|WHATSAPP|CONTACT|CHAT/i;
const MESSAGE_TEXT = /message|whatsapp|chat|رسال|واتس|ماسج|تواصل/i;
export function adSignals(items: Rec[]): AdSignals {
  const ads = items.filter((a) => !Array.isArray(a.results)); // a page with no active ad comes back as a placeholder `{ results: [] }` (and is billed like an ad)
  const active = ads.filter((a) => a.isActive !== false);
  const ctas = (a: Rec): [string, string][] => [[a.snapshot?.ctaType, a.snapshot?.ctaText], ...((a.snapshot?.cards ?? []) as Rec[]).map((c): [string, string] => [c.ctaType, c.ctaText])].map(([t, x]) => [String(t ?? ''), String(x ?? '')]);
  const starts = ads.map((a) => Date.parse(a.startDateFormatted ?? '')).filter(Number.isFinite);
  return {
    ads_active: active.length,
    ads_message_cta: active.some((a) => ctas(a).some(([type, text]) => MESSAGE_CTA.test(type) || MESSAGE_TEXT.test(text))),
    ads_first_start: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
  };
}

// Which scraped item belongs to which stored page: by Facebook id first, then by URL.
export const normUrl = (u: unknown) => String(u ?? '').toLowerCase().replace(/^https?:\/\/(www\.|m\.)?/, '').replace(/\/+$/, '');
export function groupByPage<T extends Rec>(items: T[], pages: { fb_page_id: string; url: string | null }[], idKeys: string[], urlKeys: string[]): Map<string, T[]> {
  const byId = new Map(pages.map((p) => [p.fb_page_id, p.fb_page_id])), byUrl = new Map(pages.filter((p) => p.url).map((p) => [normUrl(p.url), p.fb_page_id]));
  const out = new Map<string, T[]>();
  for (const it of items) {
    if (it.error) continue; // "no_items" placeholders from the scraper
    const id = idKeys.map((k) => byId.get(String(it[k] ?? ''))).find(Boolean) ?? urlKeys.map((k) => byUrl.get(normUrl(it[k]))).find(Boolean);
    if (id) (out.get(id) ?? out.set(id, []).get(id)!).push(it);
  }
  return out;
}
