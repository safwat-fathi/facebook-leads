// How good a prospect is a page for each of the two services: plain arithmetic on facts we already store (no model, no cost).
// shop_fit = web-shop prospect, wa_fit = WhatsApp-automation prospect. Every point comes with a reason, so a score can be argued with line by line.
// THE WEIGHTS ARE GUESSES. Retune them here (and in tests/score.test.ts, which pins them) once replies or your own spot checks say otherwise.
import { HAS_WEBSITE, REVIEW_WEBSITE } from './parse';

export const WEIGHTS = {
  // Each side's positive weights add up to 100.
  shop: { noSite: 30, inbox: 20, active: 15, ads: 15, followers: 10, cod: 10, orderLink: -30, hasStore: -30 },
  wa: { comments: 20, messageAds: 20, whatsapp: 20, inbox: 20, active: 10, followers: 10 },
} as const;
export const THRESHOLD = 50; // a side "clears" at this score
const SWEET_SPOT = [2_000, 200_000] as const; // followers
const ACTIVE_POSTS = 4; // posts in 30 days
const ABANDONED_DAYS = 90;
const COMMENTS_PER_POST = 10;
const INBOX_FULL = 2; // posts that mention ordering by message for full points (one post earns half)
const DAY = 86_400_000;

export type Pitch = 'shop' | 'wa' | 'both' | 'check' | 'skip'; // 'check': would be a shop prospect if the unchecked website turns out to be none
export type Reason = { side: 'shop' | 'wa'; points: number; text: string };
export type Score = {
  shop: number; wa: number;
  pitch: Pitch | null; // null: not enough data yet (posts not read)
  reasons: Reason[];
  missing: string[]; // what we could not judge, so the score may be higher or lower than shown
  blocked: string | null; // why the page was dropped regardless of signals
};
export type ScoreInput = {
  followers: number; country: string | null; verdict: string | null; website_status: string | null; store_platform?: string | null; whatsapp_source: string | null; ad_running: number | null;
  enriched_at: string | null; last_post_at: string | null; posts_fetched: number | null; posts_30d: number | null;
  inbox_posts: number | null; cod_posts: number | null; shop_link_posts: number | null; comments_total: number | null;
  ads_checked: number | null; ads_active: number | null; ads_message_cta: number | null;
};

const nf = new Intl.NumberFormat('en');
export function scorePage(i: ScoreInput, now = Date.now()): Score {
  const reasons: Reason[] = [], missing: string[] = [];
  const add = (side: 'shop' | 'wa', points: number, text: string) => { reasons.push({ side, points, text }); };
  const drop = (blocked: string): Score => ({ shop: 0, wa: 0, pitch: 'skip', reasons: [], missing, blocked });

  if (i.verdict === 'seller_no') return drop('You marked this page as not a real seller');
  if (i.country && i.country.toLowerCase() !== 'egypt') return drop(`Based in ${i.country}, not Egypt`);
  if (!i.country) missing.push('Location unknown');

  const n = i.enriched_at ? i.posts_fetched ?? 0 : 0;
  const read = n > 0; // posts were read, so the post signals mean something
  if (!i.enriched_at) missing.push('Posts and ads not read yet');
  else if (!read) missing.push('No posts could be read (private or empty page)');
  if (read && i.last_post_at) {
    const days = Math.floor((now - Date.parse(i.last_post_at)) / DAY);
    if (days > ABANDONED_DAYS) return drop(`Last post was ${days} days ago: this page looks abandoned`);
  }

  const w = i.website_status;
  let websiteUnknown = false;
  if (w === 'none_found') add('shop', WEIGHTS.shop.noSite, 'No website found by search (this is not proof it has none)');
  else if (w && (HAS_WEBSITE as string[]).includes(w)) {
    if (i.store_platform) add('shop', WEIGHTS.shop.hasStore, `Already has an online store (${i.store_platform})`);
    else add('shop', 0, 'Has a website, but no store platform was detected. It may be a brochure site or a custom shop.');
  }
  else if (w && (REVIEW_WEBSITE as string[]).includes(w)) { missing.push('Website needs a human look'); websiteUnknown = true; }
  else { missing.push('Website not checked yet'); websiteUnknown = true; }

  if (i.followers >= SWEET_SPOT[0] && i.followers <= SWEET_SPOT[1]) {
    const t = `${nf.format(i.followers)} followers (${nf.format(SWEET_SPOT[0])} to ${nf.format(SWEET_SPOT[1])} suits both services)`;
    add('shop', WEIGHTS.shop.followers, t); add('wa', WEIGHTS.wa.followers, t);
  }

  if (read) {
    const inbox = i.inbox_posts ?? 0;
    if (inbox > 0) {
      const k = inbox >= INBOX_FULL ? 1 : 0.5, t = `Takes orders by message in ${inbox} of ${n} posts`;
      add('shop', WEIGHTS.shop.inbox * k, t); add('wa', WEIGHTS.wa.inbox * k, t);
    }
    if ((i.posts_30d ?? 0) >= ACTIVE_POSTS) {
      const t = `${i.posts_30d} posts in the last 30 days`;
      add('shop', WEIGHTS.shop.active, t); add('wa', WEIGHTS.wa.active, t);
    }
    if ((i.cod_posts ?? 0) > 0) add('shop', WEIGHTS.shop.cod, `Cash on delivery in ${i.cod_posts} of ${n} posts`);
    if ((i.shop_link_posts ?? 0) > 0) add('shop', WEIGHTS.shop.orderLink, `Already sells through an order link in ${i.shop_link_posts} of ${n} posts`);
    const perPost = (i.comments_total ?? 0) / n;
    if (perPost >= COMMENTS_PER_POST) add('wa', WEIGHTS.wa.comments, `Many comments: about ${Math.round(perPost)} per post`);
  }

  // The ads lookup is the more specific evidence; the page's own "running ads" flag is only the fallback.
  const adsKnown = !!i.enriched_at && !!i.ads_checked;
  if (i.enriched_at && !i.ads_checked) missing.push('Ads lookup failed');
  if (adsKnown ? (i.ads_active ?? 0) > 0 : i.ad_running === 1) add('shop', WEIGHTS.shop.ads, adsKnown ? `${i.ads_active} active ads` : 'Facebook says the page runs ads (not checked in the ad library)');
  if (adsKnown && i.ads_message_cta) add('wa', WEIGHTS.wa.messageAds, 'Ads with a Message or WhatsApp button');

  if (i.whatsapp_source === 'page') add('wa', WEIGHTS.wa.whatsapp, 'WhatsApp number linked on the page');
  else if (i.whatsapp_source === 'phone_guess') add('wa', WEIGHTS.wa.whatsapp / 2, 'Has a mobile number (not confirmed to be on WhatsApp)');

  const total = (side: 'shop' | 'wa') => Math.max(0, Math.min(100, Math.round(reasons.filter((r) => r.side === side).reduce((s, r) => s + r.points, 0))));
  const shop = total('shop'), wa = total('wa');
  // An unknown website is not a reason to skip: if finding none would carry the shop score over the threshold, say "check website".
  const couldShop = websiteUnknown && shop + WEIGHTS.shop.noSite >= THRESHOLD;
  const pitch: Pitch | null = !read ? null : shop >= THRESHOLD && wa >= THRESHOLD ? 'both' : shop >= THRESHOLD ? 'shop' : wa >= THRESHOLD ? 'wa' : couldShop ? 'check' : 'skip';
  return { shop, wa, pitch, reasons, missing, blocked: null };
}

export const PITCH_FILTERS = ['shop', 'wa', 'both', 'check', 'skip', 'none'] as const;
export type PitchFilter = (typeof PITCH_FILTERS)[number];
/** "shop" and "wa" include pages for which both clear, so "who can I pitch a web shop to" is one filter. */
export function matchesPitch(s: Score, want: PitchFilter): boolean {
  if (want === 'none') return s.pitch === null;
  if (want === 'shop') return s.pitch === 'shop' || s.pitch === 'both';
  if (want === 'wa') return s.pitch === 'wa' || s.pitch === 'both';
  return s.pitch === want;
}
/** Sort key: pages whose posts were read come before provisional ones; within each group, by the better of the two scores. */
export const fitSort = (s: Score) => (s.pitch === null ? 0 : 1000) + Math.max(s.shop, s.wa);
