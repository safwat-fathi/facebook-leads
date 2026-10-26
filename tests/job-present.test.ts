import { describe, expect, it } from 'vitest';
import { appliesTo, describeFilters, describeJob, searchName } from '@/lib/job-present';

const params = { terms: ['عطور', 'ملابس', 'احذية'], locations: ['Cairo, Egypt', 'Giza, Egypt'], perSearch: 20 };

describe('searchName', () => {
  it('uses your label, trimmed', () => expect(searchName({ label: '  Cosmetics Q4 ', params })).toBe('Cosmetics Q4'));
  it('falls back to the first two terms, how many more, and the cities', () => {
    expect(searchName({ label: null, params })).toBe('\u200e\u2068عطور, ملابس\u2069 +1 · Cairo, Giza');
    expect(searchName({ params: { terms: ['shoes'], locations: ['Cairo, Egypt'] } })).toBe('shoes · Cairo');
    expect(searchName({ label: '   ', params: { terms: ['shoes'], locations: ['Cairo, Egypt'] } })).toBe('shoes · Cairo');
  });
});

describe('describeFilters', () => {
  it('says every filter, not just a few', () => {
    expect(describeFilters({ country: 'Egypt', minFollowers: 2000, maxFollowers: 200000, website: 'none', stage: 'qualified', enriched: 'yes', pitch: 'shop' }))
      .toBe('2,000–200,000 followers, Egypt, no website found, stage Qualified, enriched, fit: Web shop');
    expect(describeFilters({ minFollowers: 500 })).toBe('from 500 followers');
    expect(describeFilters({ platform: 'none', whatsapp: 'confirmed', signal: 'cod', verdict: 'none', q: 'سلمى' })).toContain('name has “\u2068سلمى\u2069”');
    expect(describeFilters({})).toBe('');
  });
  it('leaves out the keys shown some other way', () => expect(describeFilters({ job: 7, city: 'Cairo' }, ['job'])).toBe('Cairo'));
});

describe('appliesTo', () => {
  it('a search applies to itself', () => {
    expect(appliesTo({ id: 4, kind: 'discover', label: 'Cosmetics', params })).toMatchObject({ scope: 'own', text: 'Cosmetics', href: '/searches?open=4#s-4' });
  });
  it('a scoped job links to its search or label and still lists the other filters', () => {
    const p = { filters: { job: 4, website: 'none' }, limit: 10, recheck: false };
    expect(appliesTo({ id: 9, kind: 'website_check', params: p, target: { kind: 'search', id: 4, name: 'Cosmetics' } })).toEqual({ scope: 'search', text: 'Cosmetics', href: '/searches?open=4#s-4', detail: 'no website found' });
    expect(appliesTo({ id: 9, kind: 'enrich', params: { filters: { label: 'A&B' } }, target: { kind: 'label', name: 'A&B' } })).toMatchObject({ scope: 'label', href: '/searches?label=A%26B' });
  });
  it('an unscoped job says it was filters, in words', () => {
    expect(appliesTo({ id: 9, kind: 'enrich', params: { filters: { city: 'Cairo' }, limit: 5 } })).toEqual({ scope: 'filters', text: 'Pages matching the filters', detail: 'Cairo' });
    expect(appliesTo({ id: 9, kind: 'enrich', params: { filters: {}, limit: 5 } }).detail).toBe('all pages');
  });
});

describe('describeJob', () => {
  it('names the filters of a check job', () => expect(describeJob('website_check', { filters: { city: 'Cairo', website: 'unknown' }, limit: 10, recheck: true })).toBe('Check websites: up to 10 pages (Cairo, website not checked yet), including already checked'));
});
