// Runs only where the real database was copied to web/data/leads.db: proves the port gives the same numbers as the local dashboard.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb, useDbForTests } from '@/lib/db';
import { stats, queryPages } from '@/lib/pages';
import { parseFilters } from '@/lib/filters';

const PATH = 'data/leads.db';
describe.skipIf(!existsSync(PATH))('real database (data/leads.db)', () => {
  it('matches the numbers the local dashboard showed', () => {
    useDbForTests(openDb(PATH));
    const s = stats();
    expect(s.total).toBeGreaterThanOrEqual(30);
    expect(s.whatsappConfirmed).toBe(5);
    expect(queryPages(parseFilters({ 'min-followers': '485971', 'max-followers': '485971' })).rows.map((r) => r.title)).toEqual([expect.stringContaining('Samir')]);
    expect(queryPages(parseFilters({ website: 'none' })).total).toBe(s.noneFound);
    console.log('real db stats', JSON.stringify(s));
  });
});
