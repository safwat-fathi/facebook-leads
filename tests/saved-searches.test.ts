import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, useDbForTests } from '@/lib/db';
import { deleteSaved, listSaved, saveSearch } from '@/lib/saved-searches';

const params = { terms: 'عبايات', cities: ['Cairo', 'Giza'], perSearch: 20, minF: '5000', maxF: '100000', budget: '2' };

describe('saved searches', () => {
  beforeEach(() => useDbForTests(openDb(':memory:')));
  it('saves, replaces by name, lists and deletes', () => {
    saveSearch({ name: 'Clothing', params });
    saveSearch({ name: 'Clothing', params: { ...params, perSearch: 30 } });
    expect(listSaved()).toHaveLength(1);
    expect(listSaved()[0].params.perSearch).toBe(30);
    deleteSaved(listSaved()[0].id);
    expect(listSaved()).toEqual([]);
  });
  it('rejects bad input', () => {
    expect(() => saveSearch({ name: '', params })).toThrow();
    expect(() => saveSearch({ name: 'x', params: { ...params, cities: ['a', 'b', 'c', 'd'] } })).toThrow();
  });
});
