// Facebook page record (from Apify) -> database row. Ported from probe/ingest.mjs. Stubs without a page id are skipped.
import { classifyWebsite, businessType, contacts, numFollowers, parseLocation, primaryCategory, whatsappOf, type FbRecord } from './parse';

export type PageRow = {
  fb_page_id: string; url: string; title: string | null; categories: string; category: string | null; business_type: string;
  followers: number; country: string | null; city: string | null; district: string | null; location_source: string;
  phone: string | null; email: string | null; wa: string; whatsapp: string | null; whatsapp_source: string | null; ad_running: number;
  website_listed: string; website_listed_class: string; raw: string; discovered_by: string;
};

export function recordToRow(p: FbRecord, discoveredBy: string): PageRow | null {
  if (!p || typeof p !== 'object' || !p.pageId || !p.pageUrl) return null;
  const loc = parseLocation(p), web = classifyWebsite(p), c = contacts(p), wa = whatsappOf(p);
  return {
    fb_page_id: String(p.pageId), url: String(p.pageUrl), title: p.title ?? p.pageName ?? null,
    categories: ([] as string[]).concat(p.categories ?? []).join('/'), category: primaryCategory(p), business_type: businessType(p).types.join(',') || 'other',
    followers: numFollowers(p), country: loc.country, city: loc.city, district: loc.district, location_source: loc.source,
    phone: p.phone ?? null, email: p.email ?? [...c.emails][0] ?? null,
    wa: JSON.stringify(wa.all), whatsapp: wa.best, whatsapp_source: wa.source,
    ad_running: /is currently running ads/i.test(String(p.ad_status ?? '')) ? 1 : 0,
    website_listed: JSON.stringify(web.listed), website_listed_class: web.cls,
    raw: JSON.stringify(p), discovered_by: discoveredBy,
  };
}
