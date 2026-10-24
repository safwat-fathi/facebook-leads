// Apify page records in the shape Phase 0 returned (names are real public businesses; phone numbers and tokens are fake).
import type { FbRecord } from '@/lib/parse';

export const RECORDS: FbRecord[] = [
  { pageId: '100', pageUrl: 'https://www.facebook.com/cairosales/', title: 'Cairo Sales Store | Cairo', categories: ['Page', 'Department Store'], category: 'Department Store', followers: 3175570,
    address: '73 Omar Ibn El-Khattab, Almaza, Cairo, Egypt, 11361', phone: '+20 2 22906677', whatsapp_number: '+20 11 15495000', wa_number: '+20 11 15495000', website: 'https://cairosales.com/', websites: ['https://cairosales.com/'],
    ad_status: 'This Page is currently running ads.', email: 'mail@cairosales.com', intro: 'تسوق آلاف المنتجات المنزلية من مكان واحد' },
  { pageId: '101', pageUrl: 'https://www.facebook.com/samiralystationeryhousesco/', title: 'Samir & Aly Stationery Houses & Co. | Cairo', categories: ['Page', 'Office Supplies'], category: 'Office Supplies', followers: 485971,
    address: '64 Zaker Hussin st, Nasr City Cairo, Egypt, Cairo, Egypt, 11471', phone: '+20 10 00000001', whatsapp_number: '+20 10 00000001', website: 'http://www.samirandaly.com/', websites: ['https://www.instagram.com/samirandalyeg', 'https://www.samirandaly.com/'],
    ad_status: 'This Page is currently running ads.' },
  { pageId: '102', pageUrl: 'https://www.facebook.com/golden0city/', title: 'Golden City - جولدن سيتي | Cairo', categories: ['Page', 'Household supplies'], category: 'Household supplies', followers: 220000,
    address: 'فرع جسر السويس ١٦٥ شارع احمد عرابي, Cairo, Egypt, 44991', phone: '+20 15 00000002', website: 'https://maps.app.goo.gl/JPvY959trZ34Pg237', websites: ['https://maps.app.goo.gl/JPvY959trZ34Pg237', 'https://www.instagram.com/golden0city'], ad_status: 'This Page is not currently running ads.' },
  { pageId: '103', pageUrl: 'https://www.facebook.com/kitchenmarket20/', title: 'Kitchen Market | Cairo', categories: ['Page', 'In-Home Service'], category: 'In-Home Service', followers: 10000,
    address: 'Cairo, Egypt, 35511', whatsapp_number: '+20 10 00000003', website: 'https://maps.google.com/maps?q=30.04427000%2C31.23525000&hl=en', ad_status: 'This Page is not currently running ads.' },
  { pageId: '104', pageUrl: 'https://www.facebook.com/RabieStore/', title: 'Rabie store | Mansourah', categories: ['Page', "Women's clothing store"], category: "Women's clothing store", followers: 165341,
    address: 'شارع الجلاء, Mansourah, Egypt', phone: '+20 50 2946422', website: 'https://linktr.ee/Rabiestore' },
  { pageId: '105', pageUrl: 'https://www.facebook.com/people/accessories/61595109101635/', title: 'اكسسوارات', categories: ['Page', 'Personal blog', 'Product/service'], followers: 0 },
  { pageId: '106', pageUrl: 'https://www.facebook.com/hostile/', title: "<img src=x onerror=alert(1)> =HYPERLINK(\"http://evil\")", categories: ['Page', 'Shopping & retail'], followers: 5000,
    address: 'Cairo, Egypt', phone: '+20 10 00000009', website: 'javascript:alert(1)', websites: ['javascript:alert(1)', 'https://example.com/ok'], intro: '<script>alert(1)</script>' },
];
// A search stub: no pageId, must be skipped.
export const STUB: FbRecord = { facebookUrl: 'https://www.facebook.com/search/top?q=x', name: 'x', url: 'https://www.facebook.com/people/x/1/' };
