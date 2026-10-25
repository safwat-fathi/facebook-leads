// Labels and explanations for statuses (shared by server and client components; pure, no secrets).
import type { WebsiteStatus } from './parse';
import type { Pitch } from './score';

export type WebInfo = { text: string; group: '' | 'has' | 'review' | 'opp'; why: string };
const WEB: Record<WebsiteStatus, WebInfo> = {
  listed_verified: { text: 'Website, verified', group: 'has', why: 'The page lists this site, and it loads with details that match the page.' },
  listed_unverified: { text: 'Website, not matched', group: 'has', why: 'The page lists this site and it loads, but nothing on it links back to this page.' },
  listed_blocked: { text: 'Website, blocked to bots', group: 'has', why: 'The page lists this site. It answers but refuses automated visits (for example a Cloudflare check), so it exists but could not be read.' },
  listed_unreachable: { text: 'Website unreachable', group: 'review', why: 'The listed domain exists but did not answer from here. It may be down or limited to Egypt.' },
  listed_dead: { text: 'Dead domain', group: 'review', why: 'The page lists a domain that no longer exists.' },
  found_verified: { text: 'Website found', group: 'has', why: 'Found by search and tied to this page by its phone number or a link back.' },
  found_probable: { text: 'Possible website', group: 'review', why: 'Found by search and matched by name only. Needs a human look.' },
  confirmed_manual: { text: 'Website, confirmed by you', group: 'has', why: 'You confirmed this site yourself. Website checks leave it alone.' },
  none_found: { text: 'No website found', group: 'opp', why: 'Searches found no site tied to this page. That is not proof it has none.' },
};
export function webInfo(r: { website_status: WebsiteStatus | null; website_listed_class: string | null }): WebInfo {
  if (r.website_status && WEB[r.website_status]) return WEB[r.website_status];
  if (r.website_listed_class === 'real') return { text: 'Lists a website, not checked', group: '', why: 'The page lists a website. It has not been checked yet.' };
  const only = r.website_listed_class === 'linkinbio' ? 'a link-in-bio page' : r.website_listed_class;
  return { text: 'Not checked yet', group: '', why: r.website_listed_class === 'none' ? 'The page lists no website, and no search has run yet.' : `The page only links to ${only}, and no search has run yet.` };
}
export const PLATFORM_LABEL: Record<string, string> = { shopify: 'Shopify', salla: 'Salla', zid: 'Zid', woocommerce: 'WooCommerce' };
export const STAGE_LABEL: Record<string, string> = { new: 'New', reviewed: 'Reviewed', qualified: 'Qualified', contacted: 'Contacted', replied: 'Replied', converted: 'Converted', rejected: 'Rejected' };
export const CONTACT_CHANNELS = ['facebook', 'whatsapp', 'email', 'other'] as const; // where a lead was reached, for the Contacted stage
export const CHANNEL_LABEL: Record<string, string> = { facebook: 'Facebook', whatsapp: 'WhatsApp', email: 'Email', other: 'Other' };
export const CHANNEL_BADGE: Record<string, string> = { facebook: 'FB', whatsapp: 'WA', email: 'Email', other: 'Other' };
export const BASIS: Record<string, string> = {
  address: 'Egypt, read from the address on the page', area: "Egypt, read from the page's service area",
  phone: 'Egypt, only from a +20 phone number (no address on the page)', none: 'Location unknown',
};
export const PITCH_LABEL: Record<Pitch, string> = { shop: 'Web shop', wa: 'WhatsApp', both: 'Both', check: 'Check website', skip: 'Skip' };
export const pitchTone = (p: Pitch) => (p === 'skip' ? '' : p === 'check' ? 'warn' : 'good');
export const safeUrl = (u: string): string | null => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };
export const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`;

// Short tags for the table, from the enrichment signals. null = not enriched yet.
export type TagInput = { enriched_at: string | null; inbox_posts: number | null; cod_posts: number | null; shop_link_posts: number | null; posts_30d: number | null; ads_active: number | null; ads_message_cta: number | null };
export function signalTags(r: TagInput): { text: string; tone: 'good' | 'warn' | '' }[] | null {
  if (!r.enriched_at) return null;
  const t: { text: string; tone: 'good' | 'warn' | '' }[] = [];
  if ((r.inbox_posts ?? 0) > 0) t.push({ text: 'orders by message', tone: 'good' });
  if ((r.cod_posts ?? 0) > 0) t.push({ text: 'cash on delivery', tone: '' });
  if ((r.shop_link_posts ?? 0) > 0) t.push({ text: 'order link', tone: 'warn' }); // already sells through a site
  if ((r.posts_30d ?? 0) >= 4) t.push({ text: 'posts often', tone: '' });
  if (r.ads_message_cta) t.push({ text: 'message ads', tone: 'good' });
  else if ((r.ads_active ?? 0) > 0) t.push({ text: 'runs ads', tone: '' });
  return t;
}
