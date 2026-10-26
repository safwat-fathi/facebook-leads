import Link from 'next/link';
import { AutoRefresh } from '@/components/AutoRefresh';
import { NewSearch, type Prefill } from '@/components/NewSearch';
import { SearchCard } from '@/components/SearchCard';
import { requireAuth } from '@/lib/auth';
import { isActive, searchName } from '@/lib/job-present';
import { discoveryRuns, getJob, labels, listJobs, pagesWithoutSearch, type JobRow } from '@/lib/jobs';
import type { DiscoverParams } from '@/lib/jobs-schema';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export default async function SearchesPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAuth();
  const sp = await searchParams;
  const label = first(sp.label), q = first(sp.q)?.toLowerCase(), open = Number(first(sp.open)) || 0, from = Number(first(sp.from)) || 0;
  const all = discoveryRuns(200), used = labels();
  const runs = all.filter((r) => (!label || r.label?.toLowerCase() === label.toLowerCase())
    && (!q || [searchName(r), ...r.params.terms, ...r.params.locations].join(' ').toLowerCase().includes(q)));
  const onSearch = new Map<number, JobRow[]>();
  for (const j of listJobs(200)) if (j.target?.kind === 'search' && j.target.id) onSearch.set(j.target.id, [...(onSearch.get(j.target.id) ?? []), j]);
  const old = from ? getJob(from) : null;
  const prefill: Prefill | undefined = old?.kind === 'discover' ? (() => {
    const p = old.params as DiscoverParams;
    return { terms: p.terms.join('\n'), cities: p.locations.map((l) => l.replace(/,\s*Egypt$/i, '')), perSearch: p.perSearch, minF: p.minFollowers?.toString() ?? '', maxF: p.maxFollowers?.toString() ?? '', label: old.label ?? '' };
  })() : undefined;
  const href = (patch: { label?: string }) => { const u = new URLSearchParams(); if (patch.label) u.set('label', patch.label); if (q) u.set('q', q); return `/searches${u.size ? `?${u}` : ''}`; };
  const noSearch = pagesWithoutSearch();
  return (
    <main className="page narrow" id="main-content">
      <AutoRefresh active={all.some((r) => isActive(r.status))} />
      <div className="pagehead">
        <div>
          <h1>Searches</h1>
          <p className="lede">Every search you have run, what it found and what it cost.</p>
        </div>
      </div>
      <NewSearch key={from} prefill={prefill} startOpen={!!prefill || all.length === 0} />
      {all.length > 0 && (
        <>
          <div className="searchbar">
            <form action="/searches" role="search" aria-label="Find a search">
              <input type="search" name="q" defaultValue={q ?? ''} placeholder="Find by label, term or city" aria-label="Find a search by label, term or city" autoComplete="off" />
              {label && <input type="hidden" name="label" value={label} />}
              <button type="submit" className="quiet">Find</button>
            </form>
            {used.length > 0 && (
              <nav className="labelchips" aria-label="Filter by label">
                <Link className="quiet" href={href({})} aria-current={label ? undefined : 'true'}>All<small>{all.length}</small></Link>
                {used.map((l) => <Link key={l.label} className="quiet" href={href({ label: l.label })} aria-current={label?.toLowerCase() === l.label.toLowerCase() ? 'true' : undefined}><bdi dir="auto">{l.label}</bdi><small>{l.searches}</small></Link>)}
              </nav>
            )}
          </div>
        </>
      )}
      {runs.length === 0 ? (
        <div className="panel empty">
          <p>{all.length === 0 ? 'No searches yet. Start one above to find Egyptian seller pages by keyword and city.' : 'No search matches this label or text.'}</p>
          {all.length > 0 && <Link className="quiet" href="/searches">Show all searches</Link>}
        </div>
      ) : (
        <ul className="searchlist">{runs.map((r) => <SearchCard key={r.id} run={r} jobs={onSearch.get(r.id) ?? []} picked={r.id === open} />)}</ul>
      )}
      {noSearch > 0 && <p className="note">{noSearch} {noSearch === 1 ? 'page' : 'pages'} in Leads came from the old command-line tool, so {noSearch === 1 ? 'it is' : 'they are'} not part of any search.</p>}
    </main>
  );
}
