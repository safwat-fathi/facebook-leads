// How a job is described to a person. Pure; shared by server and client components.
import type { JobKind, JobStatus } from './jobs';

export const STATUS_LABEL: Record<JobStatus, string> = { queued: 'Waiting', running: 'Running', done: 'Finished', failed: 'Failed', cancelled: 'Cancelled' };
export const isActive = (s: JobStatus) => s === 'queued' || s === 'running';
type P = { terms?: string[]; locations?: string[]; perSearch?: number; filters?: Record<string, unknown>; limit?: number; recheck?: boolean };
const FILTER_WORDS: Record<string, string> = { minFollowers: 'from', maxFollowers: 'up to', city: 'city', country: 'country', type: 'type', q: 'name' };
export function describeJob(kind: JobKind, params: unknown): string {
  const p = params as P;
  if (kind === 'discover') return `Find pages: ${(p.terms ?? []).join(', ')} in ${(p.locations ?? []).join(', ')} (${p.perSearch} per search)`;
  const what = kind === 'enrich' ? 'Enrich with posts and ads' : 'Check websites';
  const f = Object.entries(p.filters ?? {}).filter(([k]) => FILTER_WORDS[k]).map(([k, v]) => `${FILTER_WORDS[k]} ${String(v)}`).join(', ');
  return `${what}: up to ${p.limit} pages${f ? ` (${f})` : ''}${p.recheck ? ', including already checked' : ''}`;
}
