// Named snapshots of the "Find new pages" form, stored as the raw form state so loading one is a plain set of the inputs.
import 'server-only';
import { z } from 'zod';
import { getDb } from './db';
import { bad } from './errors';

export const SavedSearchInput = z.object({
  name: z.string().trim().min(1).max(60),
  params: z.object({
    terms: z.string().max(2000),
    cities: z.array(z.string().max(40)).max(3),
    perSearch: z.number().int().min(5).max(40),
    minF: z.string().max(12),
    maxF: z.string().max(12),
    budget: z.string().max(12),
  }).strict(),
}).strict();

export type SavedSearch = { id: number; name: string; params: z.infer<typeof SavedSearchInput>['params'] };

export const listSaved = (): SavedSearch[] =>
  (getDb().prepare('select id, name, params from saved_searches order by name').all() as { id: number; name: string; params: string }[])
    .map((r) => ({ id: r.id, name: r.name, params: JSON.parse(r.params) }));

/** Saving under an existing name replaces it. */
export function saveSearch(input: unknown) {
  const r = SavedSearchInput.safeParse(input);
  if (!r.success) throw bad(r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  getDb().prepare(
    'insert into saved_searches (name, params, created_at) values (:name, :params, :at) on conflict(name) do update set params = excluded.params',
  ).run({ name: r.data.name, params: JSON.stringify(r.data.params), at: new Date().toISOString() });
}

export const deleteSaved = (id: number) => { getDb().prepare('delete from saved_searches where id = :id').run({ id }); };
