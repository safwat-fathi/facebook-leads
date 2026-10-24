// Pure parsing of Facebook page records (ported 1:1 from probe/lib.mjs). No I/O here: everything is unit-tested in tests/parse.test.ts.
// Records come from Apify and are untrusted, so they are typed loosely and every field is checked before use.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type FbRecord = Record<string, any>;

// ---- contacts ----
export const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));

// All string values of an item. URLs only survive if they carry a WhatsApp link (CDN urls hold digit runs that fake phones).
export function texts(x: unknown, acc: string[] = []): string[] {
  if (typeof x === 'string') {
    if (/^https?:\/\//.test(x)) {
      let u = x;
      try { u = decodeURIComponent(x); } catch { /* keep the raw string */ }
      if (/wa\.me|whatsapp/i.test(u)) acc.push(u);
    } else acc.push(x);
  } else if (x && typeof x === 'object') for (const v of Object.values(x)) texts(v, acc);
  return acc;
}
// Egyptian mobile: 01[0125] + 8 digits, written with 0 / +20 / 0020 / 20 prefix, optional single separators.
export const EG_MOBILE = /(?<!\d)(?:(?:\+|00)?20[\s.-]?|0)1[0125](?:[\s.-]?\d){8}(?!\d)/g;
export const e164 = (s: string) => { let n = s.replace(/\D/g, '').replace(/^00/, ''); if (n.startsWith('0')) n = '20' + n.slice(1); return '+' + n; };
export function contacts(item: unknown) {
  const t = digits(texts(item).join('\n'));
  return {
    t,
    phones: new Set((t.match(EG_MOBILE) ?? []).map(e164)),
    wa: new Set([...t.matchAll(/(?:wa\.me\/|whatsapp\.com\/send\/?\?phone=)\+?(\d{8,15})/gi)].map((m) => m[1])),
    emails: new Set(t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []),
  };
}
export const numFollowers = (p: FbRecord) => Number(p.followers ?? p.likes ?? 0) || 0;

// ---- location ----
const CITIES: Record<string, string[]> = {
  Cairo: ['cairo', 'القاهرة', 'القاهره'],
  Giza: ['giza', 'الجيزة', 'الجيزه'],
  Alexandria: ['alexandria', 'الإسكندرية', 'الاسكندرية', 'الأسكندرية', 'اسكندرية'],
  Mansoura: ['mansoura', 'المنصورة', 'المنصوره'],
  Tanta: ['tanta', 'طنطا'],
  Asyut: ['asyut', 'assiut', 'أسيوط', 'اسيوط'],
  Aswan: ['aswan', 'أسوان', 'اسوان'],
  Luxor: ['luxor', 'الأقصر', 'الاقصر'],
  Suez: ['suez', 'السويس'],
  Ismailia: ['ismailia', 'الإسماعيلية', 'الاسماعيلية'],
  'Port Said': ['port said', 'بورسعيد', 'بور سعيد'],
  Zagazig: ['zagazig', 'الزقازيق'],
  Damietta: ['damietta', 'دمياط'],
  Fayoum: ['fayoum', 'faiyum', 'الفيوم'],
  Minya: ['minya', 'المنيا'],
  Hurghada: ['hurghada', 'الغردقة'],
};
const clean = (s: unknown) => String(s).trim().replace(/\s+governorate$/i, '').replace(/^محافظة\s+/, '').trim();
export const canonCity = (s: unknown): string | null => {
  const t = clean(s ?? '').toLowerCase();
  return Object.keys(CITIES).find((name) => CITIES[name].includes(t)) ?? null;
};
const COUNTRY = /^(egypt|مصر)$/i;
const POSTCODE = /^\d[\d\s-]*$/;
const NOT_PLACE = /\d|شارع|street|\bst\b|فرع|branch|online|أونلاين/i; // street lines are not cities/districts
const placeLike = (t: string | undefined): t is string => !!t && !COUNTRY.test(t) && !NOT_PLACE.test(t) && t.split(/\s+/).length <= 3;

export type Loc = { country: string | null; city: string | null; district: string | null; source: 'address' | 'area' | 'phone' | 'none' };
const fromAddress = (p: FbRecord): Loc | null => {
  const toks = String(p.address ?? '').split(/[,،]/).map((s) => s.trim()).filter(Boolean);
  const i = toks.map((t) => COUNTRY.test(t)).lastIndexOf(true); // last one: "…, Egypt, Cairo, Egypt, 11471"
  if (i < 0) return null;
  const c = toks[i - 1];
  const city = i > 0 && !POSTCODE.test(c) && placeLike(c) ? canonCity(c) ?? clean(c) : null;
  const d = toks[i - 2];
  return { country: 'Egypt', city, district: city && placeLike(d) ? d : null, source: 'address' };
};
const fromArea = (p: FbRecord): Loc | null => { // "Heliopolis, Cairo Governorate, Egypt · Nasr City, Cairo Governorate, Egypt"
  const seg = (typeof p.business_service_area === 'string' ? p.business_service_area : '').split('·')[0].split(',').map((s) => s.trim());
  if (seg.length < 2 || !COUNTRY.test(seg[seg.length - 1])) return null;
  return { country: 'Egypt', city: canonCity(seg[seg.length - 2]) ?? clean(seg[seg.length - 2]), district: seg.length > 2 ? seg[seg.length - 3] : null, source: 'area' };
};
const fromDictionary = (p: FbRecord): Loc | null => { // last resort: a known city name anywhere in the address text
  const hay = String(p.address ?? '').toLowerCase();
  const city = Object.keys(CITIES).find((n) => CITIES[n].some((a) => (/^[a-z ]+$/.test(a) ? new RegExp(`\\b${a}\\b`).test(hay) : hay.includes(a))));
  return city ? { country: 'Egypt', city, district: null, source: 'address' } : null;
};
export function parseLocation(p: FbRecord): Loc {
  const tries = [fromAddress(p), fromArea(p), fromDictionary(p)];
  const hit = tries.find((t) => t?.city);
  if (hit) return hit;
  const phone = digits(String(p.phone ?? '')).replace(/[^\d+]/g, '');
  if (tries.some((t) => t?.country)) return { country: 'Egypt', city: null, district: null, source: 'address' };
  if (/^(\+|00)20/.test(phone)) return { country: 'Egypt', city: null, district: null, source: 'phone' };
  return { country: null, city: null, district: null, source: 'none' };
}

// ---- WhatsApp ----
// 'page' = a number the page itself links to WhatsApp: trustworthy. 'phone_guess' = no WhatsApp on the page, so its listed Egyptian mobile: unverified.
export function whatsappOf(p: FbRecord): { all: string[]; best: string | null; source: 'page' | 'phone_guess' | null } {
  const all = new Set([...contacts(p).wa].map((n) => '+' + n));
  for (const n of [p.whatsapp_number, p.wa_number]) if (n) all.add(e164(String(n)));
  if (all.size) return { all: [...all], best: [...all][0], source: 'page' };
  const mobile = [...contacts({ phone: p.phone ?? '' }).phones][0];
  return mobile ? { all: [], best: mobile, source: 'phone_guess' } : { all: [], best: null, source: null };
}

// ---- business type ----
// Facebook's category is owner-chosen and noisy, so: category text first, then the page name/intro, else 'other'.
// A general store sells several things, so ALL matching types are kept, most specific first.
const TYPES: [string, RegExp][] = [
  ['shoes', /shoe|footwear|حذية|احذية|أحذية|جزم/i],
  ['clothing', /clothing|fashion|apparel|boutique|ملابس|ازياء|أزياء|حريمي|رجالي|فساتين|عبايات/i],
  ['beauty', /beauty|cosmetic|perfume|makeup|skin ?care|عطور|مستحضرات|تجميل|مكياج/i],
  ['accessories', /accessor|jewel|watch|handbag|اكسسوار|إكسسوار|مجوهرات|ساعات|شنط|حقائب/i],
  ['electronics', /electronic|mobile|computer|موبايل|الكترونيات|إلكترونيات|لاب ?توب/i],
  ['home', /household|home goods|home & garden|kitchen|appliance|furniture|منزل|مطبخ|مفروشات|اثاث|أثاث|ديكور|أجهزة/i],
  ['stationery', /office supplies|stationery|مكتبات|مكتبية/i],
  ['food', /food|grocery|restaurant|bakery|supermarket|مطعم|حلويات|بقالة|اغذية|أغذية/i],
];
export const BUSINESS_TYPES = [...TYPES.map(([t]) => t), 'other'];
const NAME_ONLY: [string, RegExp][] = [['home', /\bhome\b/i]]; // too loose to trust inside a category string
export function businessType(p: FbRecord): { types: string[]; type: string; source: 'category' | 'name' | 'none' } {
  const cat = ([] as string[]).concat(p.categories ?? []).filter((c) => c !== 'Page').join(' / ');
  const fromCat = TYPES.filter(([, re]) => re.test(cat)).map(([t]) => t);
  if (fromCat.length) return { types: fromCat, type: fromCat[0], source: 'category' };
  const text = `${String(p.title ?? '').split('|')[0]} ${p.intro ?? ''}`;
  const fromName = [...new Set([...TYPES, ...NAME_ONLY].filter(([, re]) => re.test(text)).map(([t]) => t))];
  return fromName.length ? { types: fromName, type: fromName[0], source: 'name' } : { types: [], type: 'other', source: 'none' };
}
export const primaryCategory = (p: FbRecord): string | null => p.category ?? ([] as string[]).concat(p.categories ?? []).filter((c) => c !== 'Page')[0] ?? null;

// ---- website classification ----
export const domainOf = (u: string): string | null => {
  try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : 'http://' + u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
};
const onHost = (h: string, list: string[]) => list.some((d) => h === d || h.endsWith('.' + d));
const SOCIAL = ['facebook.com', 'fb.com', 'fb.me', 'fb.watch', 'instagram.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'x.com', 'twitter.com', 'wa.me', 'whatsapp.com', 't.me', 'linkedin.com', 'snapchat.com', 'pinterest.com', 'threads.net'];
const LINKINBIO = ['linktr.ee', 'bio.link', 'beacons.ai', 'taplink.cc', 'lnk.bio', 'linkin.bio', 'campsite.bio', 'hoo.be', 'bluetags.me', 'solo.to', 'linkpop.com', 'direct.me', 'flowcode.com'];
const FREE_HOSTS = ['blogspot.com', 'wuiltweb.com', 'myshopify.com', 'wixsite.com', 'business.site', 'weebly.com', 'wordpress.com'];
const DIRECTORY = /yellowpages|olx\.|jumia\.|amazon\.|noon\.com|souq\.|foursquare|tripadvisor|yelp|wikipedia|dubizzle|mapcarta|waze|zomato|talabat|elmenus|hotfrog|cylex|2gis|egyptyellow|opensooq/i;
export type WebClass = 'real' | 'maps' | 'social' | 'linkinbio' | 'none';
function classifyOne(u: string): WebClass {
  if (/^[a-z][a-z0-9+.-]*:(?!\d+(\/|$))/i.test(u.trim()) && !/^[a-z]+:\/\//i.test(u.trim())) return 'none'; // a bare "mailto:", "tel:", "javascript:" (but not host:port)
  let x: URL;
  try { x = new URL(/^[a-z]+:\/\//i.test(u) ? u : 'http://' + u); } catch { return 'none'; }
  if ((x.protocol !== 'http:' && x.protocol !== 'https:') || !x.hostname || x.username || x.password) return 'none'; // ftp:, javascript:, file: ... are never a website
  const h = x.hostname.toLowerCase().replace(/^www\./, '');
  if (h === 'maps.app.goo.gl' || (h === 'goo.gl' && x.pathname.startsWith('/maps')) || h.startsWith('maps.') || (/(^|\.)(google|bing)\./.test(h) && x.pathname.startsWith('/maps'))) return 'maps';
  if (onHost(h, SOCIAL)) return 'social';
  if (onHost(h, LINKINBIO)) return 'linkinbio';
  return 'real';
}
const RANK: Record<WebClass, number> = { real: 4, linkinbio: 3, social: 2, maps: 1, none: 0 };
export type Listed = { url: string; cls: WebClass };
// Looks at `website` AND every entry of `websites`: Facebook sometimes lists Instagram first and the real site second.
export function classifyWebsite(p: FbRecord): { cls: WebClass; url: string | null; domain: string | null; hosted_on: string | null; listed: Listed[] } {
  const listed: Listed[] = [...new Set([p.website, ...(Array.isArray(p.websites) ? p.websites : [])].filter((x): x is string => typeof x === 'string' && !!x))].map((url) => ({ url, cls: classifyOne(url) }));
  const best = listed.reduce<{ url: string | null; cls: WebClass }>((a, b) => (RANK[b.cls] > RANK[a.cls] ? b : a), { url: null, cls: 'none' });
  const domain = best.cls === 'real' && best.url ? domainOf(best.url) : null;
  return { cls: best.cls, url: best.cls === 'real' ? best.url : null, domain, hosted_on: domain ? FREE_HOSTS.find((f) => onHost(domain, [f])) ?? null : null, listed };
}
// Can this search-result URL be a business's own site? (not social/maps/link-in-bio/directory)
export const isOwnSiteCandidate = (u: string) => classifyOne(u) === 'real' && !DIRECTORY.test(domainOf(u) ?? '');

// ---- evidence that a fetched page belongs to a Facebook page ----
const GENERIC = new Set(['store', 'shop', 'egypt', 'cairo', 'the', 'and', 'for', 'home', 'online', 'مصر', 'القاهرة', 'متجر', 'محل', 'معرض', 'شركة']);
const nameTokens = (title: unknown) => [...new Set(String(title ?? '').split('|')[0].toLowerCase().match(/\p{L}{3,}/gu) ?? [])].filter((t) => !GENERIC.has(t));
const slugOf = (u: string) => { try { return (new URL(u).pathname.split('/').filter(Boolean).pop() ?? '').toLowerCase(); } catch { return ''; } };

export type PageRef = { url: string | null; title: string | null; phone: string | null; wa: string | null };
export type Signals = { fb_link: boolean; phone: boolean; name: boolean; title: string };
export function signalsFor(html: string, page: PageRef): Signals {
  const body = html.toLowerCase();
  const text = digits(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')).replace(/<[^>]+>/g, ' ');
  const nums = text.replace(/\D/g, '');
  const slug = slugOf(page.url ?? '');
  const tails = [...new Set([page.phone, ...JSON.parse(page.wa ?? '[]')].filter(Boolean).map((s) => String(s).replace(/\D/g, '')).filter((s) => s.length >= 9).map((s) => s.slice(-9)))];
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') + ' ' + (html.match(/og:site_name"[^>]*content="([^"]*)"/i)?.[1] ?? '');
  const toks = nameTokens(page.title);
  return {
    fb_link: !!slug && (body.includes(`facebook.com/${slug}`) || body.includes(`fb.com/${slug}`) || body.includes(`facebook.com/p/${slug}`)),
    phone: tails.some((t) => nums.includes(t)),
    name: toks.length > 0 && toks.filter((t) => title.toLowerCase().includes(t)).length >= Math.min(2, toks.length),
    title: title.trim().slice(0, 120),
  };
}

// ---- website status rules ----
export type SiteCheck = { url: string; final_url: string | null; dns: boolean; status: number | null; bot_wall: boolean; signals: Omit<Signals, 'title'>; title: string; error: string | null };
export type ListedStatus = 'listed_verified' | 'listed_unverified' | 'listed_blocked' | 'listed_unreachable' | 'listed_dead';
export type FoundStatus = 'found_verified' | 'found_probable';
export type WebsiteStatus = ListedStatus | FoundStatus | 'none_found';
// A page that LISTS a real domain has a website. Only DNS/connection failure downgrades it; a 403 bot-wall does not.
export function listedStatus(r: Pick<SiteCheck, 'dns' | 'status' | 'error' | 'signals'>): ListedStatus {
  if (!r.dns || r.error === 'ECONNREFUSED') return 'listed_dead'; // no DNS record, or nothing listening
  if (r.status == null) return 'listed_unreachable'; // resolves but never answered from here: could be geo-blocked, so review
  if (r.status >= 400) return 'listed_blocked';
  return r.signals.fb_link || r.signals.phone || r.signals.name ? 'listed_verified' : 'listed_unverified';
}
// A candidate FOUND by search must show evidence it belongs to this business; otherwise it is rejected (null).
export function foundStatus(r: Pick<SiteCheck, 'dns' | 'status' | 'signals'>, snippet: { phone?: boolean; name?: boolean } = {}): FoundStatus | null {
  if (!r.dns || r.status == null) return null;
  const hard = r.signals.fb_link || r.signals.phone || snippet.phone;
  const soft = r.signals.name || snippet.name;
  return hard ? 'found_verified' : soft ? 'found_probable' : null;
}
export const HAS_WEBSITE: WebsiteStatus[] = ['listed_verified', 'listed_unverified', 'listed_blocked', 'found_verified'];
export const REVIEW_WEBSITE: WebsiteStatus[] = ['listed_dead', 'listed_unreachable', 'found_probable'];
