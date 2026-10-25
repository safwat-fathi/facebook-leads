// How a job is described to a person. Pure; shared by server and client components.
import type { JobKind, JobStatus } from './jobs';

export const STATUS_LABEL: Record<JobStatus, string> = { queued: 'Waiting', running: 'Running', done: 'Finished', failed: 'Failed', cancelled: 'Cancelled' };
export const isActive = (s: JobStatus) => s === 'queued' || s === 'running';
type P = { terms?: string[]; locations?: string[]; perSearch?: number; minFollowers?: number; maxFollowers?: number; filters?: Record<string, unknown>; limit?: number; recheck?: boolean };
const FILTER_WORDS: Record<string, string> = { minFollowers: 'from', maxFollowers: 'up to', city: 'city', country: 'country', type: 'type', q: 'name' };
/** One line for the "Search" filter: terms, places, date and how many pages it found. */
export function searchLabel(params: { terms?: string[]; locations?: string[] }, createdAt: string, found: number): string {
  const terms = params.terms ?? [];
  const shown = terms.slice(0, 2).join(', ') + (terms.length > 2 ? ` +${terms.length - 2}` : '');
  const date = new Date(createdAt).toLocaleDateString('en', { day: 'numeric', month: 'short' });
  return `${shown} · ${(params.locations ?? []).join(', ')} · ${date} · ${found} pages`;
}
export function describeJob(kind: JobKind, params: unknown): string {
  const p = params as P;
  if (kind === 'discover') return `Find pages: ${(p.terms ?? []).join(', ')} in ${(p.locations ?? []).join(', ')} (${p.perSearch} per search${p.minFollowers != null ? `, from ${p.minFollowers} followers` : ''}${p.maxFollowers != null ? `, up to ${p.maxFollowers}` : ''})`;
  const what = kind === 'enrich' ? 'Enrich with posts and ads' : 'Check websites';
  const f = Object.entries(p.filters ?? {}).filter(([k]) => FILTER_WORDS[k]).map(([k, v]) => `${FILTER_WORDS[k]} ${String(v)}`).join(', ');
  return `${what}: up to ${p.limit} pages${f ? ` (${f})` : ''}${p.recheck ? ', including already checked' : ''}`;
}
