import Link from 'next/link';
import { CheckWebsites } from './CheckWebsites';
import { LabelEditor } from './LabelEditor';
import { describeFilters, isActive, KIND_LABEL, searchName, shortDate, STATUS_LABEL } from '@/lib/job-present';
import type { JobRow, SearchRun } from '@/lib/jobs';
import { usd } from '@/lib/present';

const nf = new Intl.NumberFormat('en');
const at = (iso: string) => new Date(iso).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
const city = (l: string) => l.replace(/,\s*Egypt$/i, '');

// One search: its name, what it found (the funnel), what it cost, and what you can do next. Cost: the search itself is exact (the spend ledger);
// checks and enrichment are summed from the pages this search found first, so a recheck makes that part approximate.
export function SearchCard({ run: r, jobs, picked }: { run: SearchRun; jobs: JobRow[]; picked: boolean }) {
  const active = isActive(r.status), started = r.status !== 'queued';
  const total = r.spent_usd + r.followUpUsd;
  const steps: [number, string, string][] = [[r.found, 'pages found', ''], [r.enriched, 'enriched', ''], [r.checked, 'websites checked', ''], [r.noSite, 'no website found', 'opp']];
  const terms = r.params.terms ?? [], places = (r.params.locations ?? []).map(city);
  return (
    <li>
      <article id={`s-${r.id}`} className={`search s-${r.status}${picked ? ' picked' : ''}`} aria-label={searchName(r)}>
        <div className="search-head">
          <LabelEditor id={r.id} label={r.label} fallback={searchName({ label: null, params: r.params })} />
          <span className={`status s-${r.status}`}>{STATUS_LABEL[r.status]}</span>
          <span className="when">{shortDate(r.created_at)}</span>
        </div>
        <div className="search-body">
          <p className="search-terms"><bdi dir="auto">{terms.join(', ')}</bdi> in {places.join(', ')}</p>
          <ul className="funnel" aria-label="What this search produced">
            {steps.map(([n, text, cls]) => (
              <li key={text} className={cls}>
                <b>{nf.format(n)}</b><span>{text}</span>
                <meter min={0} max={Math.max(r.found, 1)} value={n} aria-label={`${n} of ${r.found} pages: ${text}`} />
              </li>
            ))}
          </ul>
          <div className="cost">
            {!started && <><b>{usd(r.estimateUsd)}</b><span>Estimated, waiting to start</span></>}
            {r.status === 'running' && <><b>{usd(r.spent_usd)}</b><span>of {usd(r.budget_usd)} budget</span><span>Estimated {usd(r.estimateUsd)}</span></>}
            {started && !active && (
              <>
                <b>{r.followUpUsd > 0 ? '≈ ' : ''}{usd(total)}</b>
                <span>Search {usd(r.spent_usd)}, exact</span>
                {r.followUpUsd > 0 && <span>Checks and enrichment ≈ {usd(r.followUpUsd)}</span>}
                <span>Estimated {usd(r.estimateUsd)} before it ran</span>
              </>
            )}
          </div>
        </div>
        <div className="search-actions">
          {started && r.found > 0 ? <Link className="quiet" href={`/?job=${r.id}`}>View pages</Link> : <span className="quiet" aria-disabled="true">View pages</span>}
          {started && !active && r.found > 0 && <><CheckWebsites filters={{ job: r.id }} mode="enrich" /><CheckWebsites filters={{ job: r.id }} mode="website_check" /></>}
          <Link className="quiet" href={`/searches?from=${r.id}`}>Run again</Link>
        </div>
        <details open={picked}>
          <summary>Details and jobs</summary>
          <div>
            <dl className="facts">
              <dt>Search terms</dt><dd>{terms.map((t, i) => <span key={t}>{i > 0 && ', '}<bdi dir="auto">{t}</bdi></span>)}</dd>
              <dt>Cities</dt><dd>{places.join(', ')}</dd>
              <dt>Results per search</dt><dd>{r.params.perSearch}</dd>
              {(r.params.minFollowers != null || r.params.maxFollowers != null) && <><dt>Followers</dt><dd>{describeFilters({ minFollowers: r.params.minFollowers, maxFollowers: r.params.maxFollowers }).replace(' followers', '')}</dd></>}
              <dt>Budget</dt><dd>{usd(r.budget_usd)}</dd>
              <dt>Started</dt><dd>{at(r.created_at)}</dd>
              {started && r.found > 0 && <><dt>New to you</dt><dd>{r.fresh} of {r.found} pages were found first by this search</dd></>}
              {r.progress && <><dt>Result</dt><dd>{r.progress}</dd></>}
              {r.error && r.status !== 'done' && <><dt>Stopped because</dt><dd>{r.error}</dd></>}
            </dl>
            <p className="note">Checks and enrichment are counted on the pages this search found first, so a page found by two searches is costed once.</p>
            <div>
              <p><b>Jobs on this search</b></p>
              {jobs.length === 0 ? <p className="note">None yet. Use Enrich or Check websites above to start one.</p> : (
                <ul className="jobmini">
                  {jobs.map((j) => <li key={j.id}><Link href={`/jobs/${j.id}`}>{KIND_LABEL[j.kind]} #{j.id}</Link><span className={`status s-${j.status}`}>{STATUS_LABEL[j.status]}</span><span className="note">{usd(j.spent_usd)}{j.progress ? ` · ${j.progress}` : ''}</span></li>)}
                </ul>
              )}
              <p className="note"><Link href={`/jobs/${r.id}`}>Open the log of this search</Link></p>
            </div>
          </div>
        </details>
      </article>
    </li>
  );
}
