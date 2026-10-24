// Every assertion from probe/lib.mjs --selftest, ported, plus the status rules. Uses real Phase 0 record shapes.
import { describe, expect, it } from 'vitest';
import {
  businessType, canonCity, classifyWebsite, contacts, domainOf, foundStatus, HAS_WEBSITE, isOwnSiteCandidate, listedStatus, parseLocation,
  primaryCategory, signalsFor, whatsappOf,
} from '@/lib/parse';

describe('contacts', () => {
  const c = contacts({
    intro: 'للطلب واتساب ٠١٠١٢٣٤٥٦٧٨ او 012 3456 7890 او +20 111 234 5678',
    link: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fwa.me%2F201112345679',
    cdn: 'https://scontent.fbcdn.net/x_01512345678_n.jpg',
    mail: 'shop@example.com',
  });
  it('finds Egyptian mobiles in Arabic-Indic and spaced forms, ignores CDN digit runs', () => {
    expect([...c.phones].sort()).toEqual(['+201012345678', '+201112345678', '+201112345679', '+201234567890']);
  });
  it('finds wa.me numbers and emails', () => {
    expect([...c.wa]).toEqual(['201112345679']);
    expect([...c.emails]).toEqual(['shop@example.com']);
  });
});

describe('classifyWebsite (real records)', () => {
  it('Samir & Aly: the real site is second in `websites`', () => {
    const r = classifyWebsite({ website: 'http://www.samirandaly.com/', websites: ['https://www.instagram.com/samirandalyeg', 'https://www.samirandaly.com/'] });
    expect([r.cls, r.domain]).toEqual(['real', 'samirandaly.com']);
  });
  it('real site hidden behind Instagram in `website`', () => {
    const r = classifyWebsite({ website: 'https://www.instagram.com/samirandalyeg', websites: ['https://www.instagram.com/samirandalyeg', 'https://samirandaly.com/'] });
    expect([r.cls, r.domain]).toEqual(['real', 'samirandaly.com']);
  });
  it('Cairo Sales: https://cairosales.com/en/ and https://cairosales.com/ are the same domain', () => {
    const r = classifyWebsite({ website: 'https://cairosales.com/' });
    expect(r.cls).toBe('real');
    expect(domainOf('https://cairosales.com/en/')).toBe(r.domain);
  });
  it.each([
    ['https://maps.app.goo.gl/JPvY959trZ34Pg237', 'maps'],
    ['https://maps.google.com/maps?q=30.09%2C31.26&hl=en', 'maps'],
    ['https://www.instagram.com/reel/DZr_06Dol_Q/?igsh=x', 'social'],
    ['https://www.facebook.com/share/17RmpLJxMy/', 'social'],
    ['https://linktr.ee/select_eg', 'linkinbio'],
  ])('%s -> %s', (website, cls) => expect(classifyWebsite({ website }).cls).toBe(cls));
  it('no website', () => expect(classifyWebsite({}).cls).toBe('none'));
  it.each(['ftp://files.example.com/', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'mailto:a@b.com'])('%s is never a website', (website) => expect(classifyWebsite({ website }).cls).toBe('none'));
  it('Dollar For Import: own site only inside `websites`, behind Instagram/YouTube/TikTok', () => {
    const r = classifyWebsite({ website: 'https://www.instagram.com/reel/DZr_06Dol_Q/?igsh=x', websites: ['https://www.instagram.com/dollar_for_import', 'https://www.youtube.com/@dollar_for_import', 'https://dollar-group.com/'] });
    expect([r.cls, r.domain]).toEqual(['real', 'dollar-group.com']);
  });
  it('a digital business-card service is not an own website', () => {
    expect(classifyWebsite({ website: 'https://maps.app.goo.gl/x', websites: ['https://maps.app.goo.gl/x', 'https://www.instagram.com/golden0city', 'https://bluetags.me/bc8904823713'] }).cls).toBe('linkinbio');
  });
  it('free hosts are recorded', () => expect(classifyWebsite({ website: 'https://zawal1.blogspot.com/' }).hosted_on).toBe('blogspot.com'));
  it('scheme-less hosts and host:port are still websites', () => {
    expect(classifyWebsite({ website: 'chrisbrecheen.blogspot.com' }).domain).toBe('chrisbrecheen.blogspot.com');
    expect(classifyWebsite({ website: 'shop.example.com:8080/x' }).cls).toBe('real');
    expect(classifyWebsite({ website: 'https://user:pw@shop.example.com/' }).cls).toBe('none');
  });
  it('candidate filter rejects directories and social', () => {
    expect(isOwnSiteCandidate('https://www.olx.com.eg/x')).toBe(false);
    expect(isOwnSiteCandidate('https://hawaaeg.com/')).toBe(true);
    expect(isOwnSiteCandidate('https://www.instagram.com/x')).toBe(false);
  });
});

describe('parseLocation', () => {
  const loc = (p: Record<string, unknown>) => { const { country, city, district, source } = parseLocation(p); return { country, city, district, source }; };
  it('address shapes', () => {
    expect(loc({ address: '73 Omar Ibn El-Khattab, Almaza, Cairo, Egypt, 11361' })).toEqual({ country: 'Egypt', city: 'Cairo', district: 'Almaza', source: 'address' });
    expect(parseLocation({ address: '64 Zaker Hussin st, Nasr City Cairo, Egypt, Cairo, Egypt, 11471' }).city).toBe('Cairo');
    expect(parseLocation({ address: 'ديروط الشريف بحري البلد, Dairut, Egypt' }).city).toBe('Dairut');
    expect(loc({ address: 'Online, Cairo, Egypt' })).toEqual({ country: 'Egypt', city: 'Cairo', district: null, source: 'address' });
  });
  it('service-area fallback, Arabic dictionary, phone-only, nothing', () => {
    expect(loc({ address: 'شارع الجلاء', business_service_area: 'Heliopolis, Cairo Governorate, Egypt · Nasr City, Cairo Governorate, Egypt' })).toEqual({ country: 'Egypt', city: 'Cairo', district: 'Heliopolis', source: 'area' });
    expect(loc({ address: '١٢ شارع التحرير القاهرة' })).toEqual({ country: 'Egypt', city: 'Cairo', district: null, source: 'address' });
    expect(loc({ phone: '+20 10 1234 5678' })).toEqual({ country: 'Egypt', city: null, district: null, source: 'phone' });
    expect(loc({})).toEqual({ country: null, city: null, district: null, source: 'none' });
  });
  it('canonCity', () => { expect(canonCity('القاهرة')).toBe('Cairo'); expect(canonCity('Cairo Governorate')).toBe('Cairo'); });
});

describe('whatsappOf', () => {
  it('page field + link deduplicate to one confirmed number', () => {
    const wa = whatsappOf({ whatsapp_number: '+20 11 15495000', wa_number: '+20 11 15495000', wa_link: 'https://api.whatsapp.com/send?phone=201115495000&token=abc', phone: '+20 2 22906677' });
    expect([wa.source, wa.best, wa.all.length]).toEqual(['page', '+201115495000', 1]);
  });
  it('mobile guess, landline is not a guess, nothing', () => {
    expect(whatsappOf({ phone: '+20 10 99811604' })).toEqual({ all: [], best: '+201099811604', source: 'phone_guess' });
    expect(whatsappOf({ phone: '+20 2 22611116' })).toEqual({ all: [], best: null, source: null });
    expect(whatsappOf({}).source).toBeNull();
  });
});

describe('businessType', () => {
  const bt = (categories: string[], title = '', intro = '') => businessType({ categories, title, intro });
  it('category wins', () => {
    expect(bt(['Page', "Women's clothing store"], 'Rabie store | Mansourah')).toEqual({ types: ['clothing'], type: 'clothing', source: 'category' });
    expect(bt(['Page', 'Household supplies']).type).toBe('home');
    expect(bt(['Page', 'Health/beauty'], 'الشركة الخليلية عطور').type).toBe('beauty');
    expect(bt(['Page', 'Electronics Store'], 'Select.Eg').type).toBe('electronics');
  });
  it('generic category: the name decides', () => {
    expect(bt(['Page', 'Shopping & retail', 'Product/service'], 'دولار للاستيراد الادوات المنزليه')).toEqual({ types: ['home'], type: 'home', source: 'name' });
    expect(bt(['Page', 'Product/service'], 'اكسسوارات رحوم').types).toEqual(['accessories']);
  });
  it('a general store keeps every type it sells', () => {
    expect(bt(['Page', 'Shopping Mall'], 'Momento | Cairo', 'We sell all products of. Accessories, makeup, household items, detergents, toys, mobile accessories, and perfumes').types).toEqual(['beauty', 'accessories', 'electronics', 'home']);
    expect(bt(['Page', 'Product/service'], 'NEXT home | Cairo', 'Next Home 🤎 كل اللي يخلي بيتك أشيك').type).toBe('home');
    expect(bt(['Page', 'Recruiter'], 'Home needs').type).toBe('home');
  });
  it('unknown stays other (known limit of rules)', () => {
    expect(bt(['Page', 'Business service'], 'Afrgate | Cairo')).toEqual({ types: [], type: 'other', source: 'none' });
    expect(primaryCategory({ category: "Women's clothing store" })).toBe("Women's clothing store");
  });
});

describe('website status rules', () => {
  it('a Cloudflare 403 must NOT mean "no website" (the regression you raised)', () => {
    expect(listedStatus({ dns: true, status: 403, error: null, signals: { fb_link: false, phone: false, name: false } })).toBe('listed_blocked');
    expect(HAS_WEBSITE).toContain('listed_blocked');
  });
  it('dead vs unreachable vs verified vs unverified', () => {
    const s = { fb_link: false, phone: false, name: false };
    expect(listedStatus({ dns: false, status: null, error: 'ENOTFOUND', signals: s })).toBe('listed_dead');
    expect(listedStatus({ dns: true, status: null, error: 'ECONNREFUSED', signals: s })).toBe('listed_dead');
    expect(listedStatus({ dns: true, status: null, error: 'UND_ERR_CONNECT_TIMEOUT', signals: s })).toBe('listed_unreachable');
    expect(HAS_WEBSITE).not.toContain('listed_unreachable');
    expect(HAS_WEBSITE).not.toContain('listed_dead');
    expect(listedStatus({ dns: true, status: 200, error: null, signals: { ...s, phone: true } })).toBe('listed_verified');
    expect(listedStatus({ dns: true, status: 200, error: null, signals: s })).toBe('listed_unverified');
  });
  it('found candidates need evidence', () => {
    const s = { fb_link: false, phone: false, name: false };
    expect(foundStatus({ dns: true, status: 200, signals: { ...s, fb_link: true } })).toBe('found_verified');
    expect(foundStatus({ dns: true, status: 200, signals: { ...s, name: true } })).toBe('found_probable');
    expect(foundStatus({ dns: true, status: 403, signals: s }, { phone: true })).toBe('found_verified'); // blocked, but the search snippet shows the phone
    expect(foundStatus({ dns: true, status: 200, signals: s })).toBeNull();
    expect(foundStatus({ dns: false, status: null, signals: s }, { phone: true })).toBeNull();
  });
  it('signalsFor on a small page', () => {
    const s = signalsFor('<html><title>Hawaaeg - حوائج</title><a href="https://www.facebook.com/hawaaeg/">f</a> اتصل 010 8090 8442</html>', { url: 'https://www.facebook.com/hawaaeg/', title: 'Hawaaeg - حوائج | Cairo', phone: '+20 10 80908442', wa: '[]' });
    expect([s.fb_link, s.phone, s.name]).toEqual([true, true, true]);
  });
});
