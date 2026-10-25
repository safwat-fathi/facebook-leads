import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, useDbForTests } from '@/lib/db';
import { recordToRow } from '@/lib/ingest';
import { parseFilters } from '@/lib/filters';
import { facets, pageDetail, queryPages, savePage, saveWebsite, selectForCheck, stats, upsertPage } from '@/lib/pages';
import { csvCell, toCsv } from '@/lib/csv';
import { HttpError } from '@/lib/errors';
import { RECORDS, STUB } from './fixtures/records';

const ingest = (by = 'seed') => RECORDS.map((r) => recordToRow(r, by)!).forEach((row) => upsertPage(row));
const find = (q: Record<string, string>) => queryPages(parseFilters(q)).rows.map((r) => r.fb_page_id).sort();

beforeEach(() => { useDbForTests(openDb(':memory:')); ingest(); });

describe('ingest', () => {
  it('stores every page record and skips search stubs', () => {
    expect(recordToRow(STUB, 'x')).toBeNull();
    expect(stats().total).toBe(RECORDS.length);
  });
  it('is idempotent and keeps your work (stage, notes, verdict, website result)', () => {
    savePage('101', { stage: 'qualified', notes: 'call Sunday', verdict: 'seller_yes' });
    saveWebsite('101', { url: 'http://www.samirandaly.com/', domain: 'samirandaly.com', status: 'listed_blocked' });
    ingest('seed'); ingest('job:7');
    expect(stats().total).toBe(RECORDS.length);
    const d = pageDetail('101')!;
    expect([d.stage, d.notes, d.verdict, d.website_status]).toEqual(['qualified', 'call Sunday', 'seller_yes', 'listed_blocked']);
    expect(d.discovered_by).toBe('seed,job:7');
  });
  it('upsertPage reports inserted vs updated', () => {
    const row = recordToRow({ ...RECORDS[0], pageId: '999' }, 'job:1')!;
    expect(upsertPage(row)).toBe('inserted');
    expect(upsertPage(row)).toBe('updated');
  });
});

describe('filters', () => {
  it('followers range is inclusive at both ends', () => {
    expect(find({ 'min-followers': '485971', 'max-followers': '485971' })).toEqual(['101']);
    expect(find({ 'min-followers': '165341', 'max-followers': '485971' })).toEqual(['101', '102', '104']);
  });
  it('country + city (and Arabic/Governorate spellings)', () => {
    expect(find({ country: 'Egypt', city: 'Cairo' })).toEqual(['100', '101', '102', '103', '106']);
    expect(find({ city: 'القاهرة' })).toEqual(['100', '101', '102', '103', '106']);
    expect(find({ city: 'Mansoura' }).length + find({ city: 'Mansourah' }).length).toBeGreaterThan(0);
  });
  it('unknown location is excluded unless include-unknown', () => {
    expect(find({ city: 'Cairo' })).not.toContain('105');
    expect(find({ city: 'Cairo', 'include-unknown': '1' })).toContain('105');
  });
  it('business type matches any of a page\'s types; WhatsApp filters', () => {
    expect(find({ type: 'clothing' })).toEqual(['104']);
    expect(find({ whatsapp: 'confirmed' })).toEqual(['100', '101', '103']);
    expect(find({ whatsapp: 'none' }).length).toBeGreaterThan(0);
  });
  it('platform filter and saved platform', () => {
    saveWebsite('100', { status: 'listed_verified', platform: 'shopify' }); saveWebsite('101', { status: 'listed_verified' }); saveWebsite('102', { status: 'none_found' });
    expect(find({ platform: 'shopify' })).toEqual(['100']);
    expect(find({ platform: 'none' })).toEqual(['101']);
    expect(pageDetail('100')?.store_platform).toBe('shopify');
  });
  it('website filters follow the saved status', () => {
    expect(find({ website: 'unknown' }).length).toBe(RECORDS.length);
    saveWebsite('100', { status: 'listed_blocked' }); saveWebsite('102', { status: 'none_found' }); saveWebsite('103', { status: 'listed_dead' });
    expect(find({ website: 'real' })).toEqual(['100']);
    expect(find({ website: 'none' })).toEqual(['102']);
    expect(find({ website: 'review' })).toEqual(['103']);
    expect(stats()).toMatchObject({ hasWebsite: 1, noneFound: 1, review: 1, unchecked: RECORDS.length - 3 });
  });
  it('job filter shows what one search found', () => {
    upsertPage(recordToRow({ ...RECORDS[0], pageId: '500', pageUrl: 'https://www.facebook.com/new/' }, 'job:12')!);
    expect(find({ job: '12' })).toEqual(['500']);
    expect(find({ job: '1' })).toEqual([]); // "job:1" must not match "job:12"
  });
  it('page name search, stage, verdict', () => {
    expect(find({ q: 'samir' })).toEqual(['101']);
    savePage('104', { stage: 'rejected', verdict: 'seller_no' });
    expect(find({ stage: 'rejected' })).toEqual(['104']);
    expect(find({ verdict: 'seller_no' })).toEqual(['104']);
    expect(find({ verdict: 'none' }).length).toBe(RECORDS.length - 1);
  });
  it('SQL injection strings are plain text, never SQL', () => {
    for (const evil of ["'; drop table pages; --", "' or '1'='1", '%', '_', '\\']) {
      const n = queryPages(parseFilters({ q: evil, city: evil, country: evil, type: evil, category: evil })).total;
      expect(n).toBe(0);
    }
    expect(stats().total).toBe(RECORDS.length); // table still there
    expect(queryPages(parseFilters({ sort: "followers; drop table pages" } as never), { sort: "followers; drop table pages", dir: 'sideways' }).rows.length).toBe(RECORDS.length); // sort is whitelisted
  });
  it('invalid values are rejected with a 400, not run', () => {
    for (const bad of [{ 'min-followers': 'abc' }, { 'min-followers': '-1' }, { website: 'maybe' }, { whatsapp: 'x' }, { stage: 'bogus' }, { verdict: 'x' }, { job: 'x' }, { q: 'x'.repeat(200) }]) {
      expect(() => parseFilters(bad)).toThrowError(HttpError);
    }
  });
  it('errors read like sentences, not schema dumps', () => {
    expect(() => parseFilters({ 'min-followers': 'abc' })).toThrowError('Invalid filter: Followers from must be a whole number of 0 or more');
    expect(() => parseFilters({ website: 'maybe' })).toThrowError('Website is not one of the available options');
    expect(() => parseFilters({ q: 'x'.repeat(200) })).toThrowError('Page name is too long');
  });
  it('sorting and paging', () => {
    expect(queryPages({}, { sort: 'followers', dir: 'desc', limit: 2 }).rows.map((r) => r.fb_page_id)).toEqual(['100', '101']);
    expect(queryPages({}, { sort: 'followers', dir: 'desc', limit: 2, offset: 2 }).rows.map((r) => r.fb_page_id)).toEqual(['102', '104']);
    expect(queryPages({}, { limit: 99999 }).rows.length).toBe(RECORDS.length); // limit is capped
    expect(queryPages({}, { sort: 'title', dir: 'asc' }).rows[0].title).toBeTruthy();
  });
  it('rows are plain objects (React Server Components reject null-prototype objects)', () => {
    const proto = (o: unknown) => Object.getPrototypeOf(o);
    expect(proto(facets().cities[0])).toBe(Object.prototype);
    expect(proto(queryPages({}).rows[0])).toBe(Object.prototype);
    expect(proto(pageDetail('100'))).toBe(Object.prototype);
  });
  it('facets', () => {
    const f = facets();
    expect(f.cities.find((c) => c.v === 'Cairo')?.n).toBe(5);
    expect(f.types.some((t) => t.v === 'home')).toBe(true);
  });
});

describe('savePage validation', () => {
  it('accepts valid updates, including clearing a verdict', () => {
    savePage('100', { stage: 'reviewed', verdict: 'seller_yes', notes: 'نوتس' });
    savePage('100', { verdict: null });
    expect(pageDetail('100')).toMatchObject({ stage: 'reviewed', verdict: null, notes: 'نوتس' });
  });
  it('rejects bad stage, long notes, empty body, unknown keys, bad verdict', () => {
    for (const body of [{ stage: 'bogus' }, { notes: 'x'.repeat(5001) }, {}, { stage: 'new', followers: 1 }, { verdict: 'maybe' }, null, [], 'x']) {
      expect(() => savePage('100', body)).toThrowError(HttpError);
    }
    expect(() => savePage('does-not-exist', { stage: 'new' })).toThrowError(/no such page/);
  });
  it('the detail view never contains the raw Apify record', () => {
    const d = pageDetail('100')!;
    expect('raw' in d).toBe(false);
    expect(JSON.stringify(d)).not.toContain('token=');
  });
});

describe('website-check selection', () => {
  it('picks filtered pages without a result, biggest first, honouring limit and recheck', () => {
    saveWebsite('100', { status: 'listed_blocked' });
    expect(selectForCheck({}, { limit: 3, recheck: false }).map((p) => p.fb_page_id)).toEqual(['101', '102', '104']);
    expect(selectForCheck({}, { limit: 3, recheck: true }).map((p) => p.fb_page_id)).toEqual(['100', '101', '102']);
    expect(selectForCheck({ city: 'Cairo' }, { limit: 50, recheck: false }).map((p) => p.fb_page_id)).toEqual(['101', '102', '103', '106']);
  });
});

describe('csv', () => {
  it('neutralises spreadsheet formulas from Facebook text but keeps phone numbers readable', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell('+cmd|calc')).toBe(`"'+cmd|calc"`);
    expect(csvCell('@SUM(1)')).toBe(`"'@SUM(1)"`);
    expect(csvCell('+201115495000')).toBe('"+201115495000"');
    expect(csvCell('+20 10 00000001')).toBe('"+20 10 00000001"');
    expect(csvCell('a\nb')).toBe('"a b"');
    expect(toCsv(['t'], [['=1+1']])).toContain(`"'=1+1"`);
  });
});

describe('database file', () => {
  it('brings an older pages table (like the one from probe/) up to date in place, keeping its rows', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'fbl-')), 'old.db');
    const legacy = new DatabaseSync(path);
    legacy.exec("create table pages (fb_page_id text primary key, title text, followers integer not null default 0, website_status text)");
    legacy.exec("insert into pages (fb_page_id, title, followers, website_status) values ('1', 'legacy', 5, 'none_found')");
    legacy.close();
    const db = openDb(path);
    const cols = (db.prepare('pragma table_info(pages)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['stage', 'notes', 'verdict', 'whatsapp', 'business_type']));
    expect(db.prepare("select title, stage, website_status from pages").get()).toMatchObject({ title: 'legacy', stage: 'new', website_status: 'none_found' });
    expect(() => db.prepare("insert into jobs (kind, params, budget_usd, created_at) values ('discover', '{}', 1, 'x')").run()).not.toThrow();
    expect(() => db.prepare("insert into jobs (kind, params, status, budget_usd, created_at) values ('discover', '{}', 'bogus', 1, 'x')").run()).toThrow(); // status is still constrained
    db.close();
  });
  it('rebuilds an old jobs table (kind CHECK) so new job kinds work, keeping rows, ids and spend links', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'fbl-')), 'old.db');
    const old = new DatabaseSync(path);
    old.exec("create table jobs (id integer primary key autoincrement, kind text not null check (kind in ('discover', 'website_check')), params text not null, status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')), budget_usd real not null, spent_usd real not null default 0, progress text, log text not null default '', error text, apify_runs text not null default '[]', cancel_requested integer not null default 0, created_at text not null, started_at text, finished_at text);");
    old.exec("create table spend (id integer primary key autoincrement, job_id integer references jobs(id), provider text not null check (provider in ('apify', 'openrouter')), usd real not null, note text, at text not null);");
    old.exec("insert into jobs (id, kind, params, status, budget_usd, spent_usd, created_at) values (7, 'discover', '{}', 'done', 1, 0.5, 'x'); insert into spend (job_id, provider, usd, at) values (7, 'apify', 0.5, 'x');");
    old.close();
    const db = openDb(path);
    expect(db.prepare("select id, kind, spent_usd from jobs").get()).toMatchObject({ id: 7, kind: 'discover', spent_usd: 0.5 });
    expect(() => db.prepare("insert into jobs (kind, params, budget_usd, created_at) values ('enrich', '{}', 1, 'x')").run()).not.toThrow();
    expect(db.prepare("select count(*) n from spend where job_id = 7").get()).toMatchObject({ n: 1 });
    expect(db.prepare("pragma foreign_key_check").all()).toEqual([]);
    expect(db.prepare("pragma foreign_keys").get()).toMatchObject({ foreign_keys: 1 });
    db.close();
    expect(() => openDb(path).close()).not.toThrow(); // idempotent
  });
});
