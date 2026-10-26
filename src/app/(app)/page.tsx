import Link from 'next/link';
import { CheckWebsites } from '@/components/CheckWebsites';
import { Drawer } from '@/components/Drawer';
import { FilterBar } from '@/components/FilterBar';
import { StageBadge } from '@/components/StageBadge';
import { VerdictButtons } from '@/components/VerdictButtons';
import { requireAuth } from '@/lib/auth';
import { filtersToQuery, parseFilters, type Filters } from '@/lib/filters';
import { searchHref, searchName, shortDate } from '@/lib/job-present';
import { discoveryRuns, labels } from '@/lib/jobs';
import { outreachState } from '@/lib/outreach';
import { facets, pageDetail, queryPages, SORT_KEYS, stats } from '@/lib/pages';
import { CHANNEL_BADGE, CHANNEL_LABEL, PITCH_LABEL, PLATFORM_LABEL, pitchTone, safeUrl, signalTags, usd, webInfo } from '@/lib/present';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const nf = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en');
const PAGE_SIZES = [25, 50, 100, 200];
const SORT_LABEL: Record<string, string> = { title: 'Name', fit: 'Fit', followers: 'Followers', city: 'City', website: 'Website', stage: 'Stage' };  // City has no column of its own any more (it is under the page name), so every sort, City included, is also in the "Sort by" menu above the table

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAuth();
  const sp = await searchParams;
  let filters: Filters = {};
  let filterError = '';
  try { filters = parseFilters(sp); } catch (e) { filterError = e instanceof Error ? e.message : 'Invalid filters'; }
  const sort = SORT_KEYS.includes(first(sp.sort) ?? '') ? first(sp.sort)! : 'followers';
  const dir = first(sp.dir) === 'asc' ? 'asc' : 'desc';
  const asked = parseInt(first(sp.limit) ?? '', 10);
  const limit = PAGE_SIZES.includes(asked) ? asked : 50;
  const offset = Math.max(0, parseInt(first(sp.offset) ?? '0', 10) || 0);
  const list = queryPages(filters, { sort, dir, limit, offset });
  const s = stats();
  const runs = discoveryRuns(200);
  const names = new Map(runs.map((r) => [r.id, searchName(r)]));
  const openId = first(sp.open);
  const detail = openId ? pageDetail(openId) : null;
  const foundBy = detail ? (detail.discovered_by ?? '').split(',').filter((t) => t.startsWith('job:')).map((t) => Number(t.slice(4))).filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })) : [];

  // Links keep the current filters and sort order.
  const base = filtersToQuery(filters);
  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams(base);
    q.set('sort', sort); q.set('dir', dir); if (limit !== 50) q.set('limit', String(limit));
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) q.delete(k); else q.set(k, v); }
    return `/?${q}`;
  };
  const values = Object.fromEntries([...base.entries()]);
  const to = offset + list.rows.length;
  const pageNo = Math.floor(offset / limit) + 1, pageCount = Math.max(1, Math.ceil(list.total / limit));
  const sortHref = (key: string) => href({ sort: key, dir: sort === key && dir === 'desc' ? 'asc' : sort === key ? 'desc' : key === 'followers' || key === 'fit' ? 'desc' : 'asc', offset: undefined });
  const th = (key: string, label: string, cls?: string) => (
    <th scope="col" className={cls} aria-sort={sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link className="sort" href={sortHref(key)}>{label}</Link>
    </th>
  );

  // When the list is limited to one search or label, say so and show what that search produced.
  const scopeRun = filters.job ? runs.find((r) => r.id === filters.job) : undefined;
  const labelRuns = filters.label ? runs.filter((r) => r.label?.toLowerCase() === filters.label!.toLowerCase()) : [];
  const usedLabels = labels();
  const stat = (n: number, text: string, to: string, cls = '') => <Link className={`stat ${cls}`} href={to}><b>{full.format(n)}</b><span>{text}</span></Link>;
  return (
    <main className="page" id="main-content">
      <div className="pagehead">
        <div>
          <h1>Leads</h1>
          {(s.sellerYes > 0 || s.sellerNo > 0) && <p className="lede">You marked {s.sellerYes} as real sellers and {s.sellerNo} as not.</p>}
        </div>
      </div>
      <nav className="stats" aria-label="Shortcuts">
        {stat(s.total, 'pages', '/')}
        {stat(s.whatsappConfirmed, 'link WhatsApp', '/?whatsapp=confirmed')}
        {stat(s.hasWebsite, 'have a website', '/?website=real')}
        {stat(s.noneFound, 'no website found', '/?website=none', 'opp')}
        {stat(s.unchecked, 'not checked yet', '/?website=unknown')}
        {stat(s.enriched, 'with posts and ads', '/?enriched=yes')}
      </nav>
      {filters.job && (
        <div className="scope">
          <div className="what">
            Pages from search <b dir="auto">{scopeRun ? searchName(scopeRun) : `#${filters.job}`}</b>
            {scopeRun && <p className="facts-line">{scopeRun.found} found, {scopeRun.enriched} enriched, {scopeRun.checked} websites checked, {scopeRun.followUpUsd > 0 ? '≈ ' : ''}{usd(scopeRun.spent_usd + scopeRun.followUpUsd)}</p>}
          </div>
          {scopeRun && <Link className="quiet small" href={searchHref(scopeRun.id)}>Open search</Link>}
          <Link className="quiet small" href={href({ job: undefined, offset: undefined })}>Show all pages</Link>
        </div>
      )}
      {filters.label && (
        <div className="scope">
          <div className="what">
            Pages from {labelRuns.length === 1 ? '1 search' : `${labelRuns.length} searches`} labelled <b dir="auto">{filters.label}</b>
            {labelRuns.length > 0 && <p className="facts-line">{(() => { const c = labelRuns.reduce((a, r) => a + r.spent_usd + r.followUpUsd, 0); return `${labelRuns.some((r) => r.followUpUsd > 0) ? '≈ ' : ''}${usd(c)} spent on them`; })()}</p>}
          </div>
          <Link className="quiet small" href={`/searches?label=${encodeURIComponent(filters.label)}`}>Open searches</Link>
          <Link className="quiet small" href={href({ label: undefined, offset: undefined })}>Show all pages</Link>
        </div>
      )}
      {usedLabels.length > 0 && (
        <nav className="labelchips" aria-label="Filter by label">
          <span className="note">Label</span>
          <Link className="quiet" href={href({ label: undefined, offset: undefined })} aria-current={filters.label ? undefined : 'true'}>All</Link>
          {usedLabels.map((l) => <Link key={l.label} className="quiet" href={href({ label: l.label, job: undefined, offset: undefined })} aria-current={filters.label?.toLowerCase() === l.label.toLowerCase() ? 'true' : undefined}><bdi dir="auto">{l.label}</bdi><small>{l.searches}</small></Link>)}
        </nav>
      )}
      <FilterBar
        facets={facets()}
        values={values}
        labels={usedLabels}
        searches={runs.filter((r) => r.status !== 'queued' && (r.id === filters.job || runs.indexOf(r) < 50)).map((r) => ({ id: r.id, label: `${searchName(r)} · ${shortDate(r.created_at)} · ${r.found} pages` }))}
      />
      {filterError && <p className="error" role="alert">{filterError}</p>}
      <div className="listbar">
        <p className="count" aria-live="polite">
          {list.total ? `${offset + 1}–${to} of ${full.format(list.total)} pages (page ${pageNo} of ${pageCount})` : ''}
          {list.total > 0 && <> &middot; <a href={`/api/export?${base}`} download>Download CSV</a></>}
        </p>
        {list.total > 0 && <div className="row-actions"><CheckWebsites filters={filters} mode="website_check" /><CheckWebsites filters={filters} mode="enrich" /></div>}
      </div>
      <details className="sortmenu">
        <summary>Sort by {SORT_LABEL[sort]}, {dir === 'asc' ? 'low to high' : 'high to low'}</summary>
        <div>{Object.entries(SORT_LABEL).map(([key, text]) => <Link key={key} className="quiet small" href={sortHref(key)} aria-pressed={sort === key}>{text}</Link>)}</div>
      </details>
      <div className="tablewrap leads">
        <table>
          <thead>
            <tr>{th('title', 'Page')}{th('fit', 'Fit')}{th('followers', 'Followers', 'num')}<th scope="col">WhatsApp</th>{th('website', 'Website')}{th('stage', 'Stage')}<th scope="col">Signals</th><th scope="col">Real seller?</th></tr>
          </thead>
          <tbody>
            {list.rows.map((r) => {
              const web = webInfo(r);
              const types = (r.business_type ?? '').split(',').filter(Boolean);
              return (
                <tr key={r.fb_page_id} className={r.verdict === 'seller_no' ? 'rejected' : ''}>
                  <td className={web.group ? `e-${web.group}` : ''}>
                    <Link className="link" dir="auto" href={href({ open: r.fb_page_id })} scroll={false} data-open-id={r.fb_page_id}>{r.title ?? '(no name)'}</Link>
                    <span className="sub" dir="auto">{[r.city ?? r.country, r.category, types.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}{types.length > 2 && <span className="tag"> +{types.length - 2}</span>}</span>
                  </td>
                  <td data-label="Fit">{r.pitch ? <><span className={`pill ${pitchTone(r.pitch)}`}>{PITCH_LABEL[r.pitch]}</span><span className="sub">shop {r.shop_fit} &middot; WhatsApp {r.wa_fit}</span></> : <span className="tag">not scored</span>}</td>
                  <td className="num" data-label="Followers">{nf.format(r.followers)}</td>
                  <td data-label="WhatsApp">
                    {r.whatsapp
                      ? <><span className="ltr">{r.whatsapp}</span><span className={`sub${r.whatsapp_source === 'page' ? '' : ' guess'}`}>{r.whatsapp_source === 'page' ? 'linked on the page' : 'mobile guess'}</span></>
                      : <span className="tag">none</span>}
                  </td>
                  <td data-label="Website"><span className={`state ${web.group}`}>{web.text}</span>{r.store_platform && <span className="tag"> {PLATFORM_LABEL[r.store_platform]}</span>}{r.website_domain && <span className="sub" dir="ltr">{(() => { const safe = r.website_url ? safeUrl(r.website_url) : null; return safe ? <a href={safe} target="_blank" rel="noopener noreferrer">{r.website_domain}</a> : r.website_domain; })()}</span>}</td>
                  <td data-label="Stage"><StageBadge stage={r.stage} />{r.contacted_via && <span className="sub">{r.contacted_via.split(',').map((c) => <span key={c} className="pill" title={`Contacted on ${CHANNEL_LABEL[c] ?? c}`}>{CHANNEL_BADGE[c] ?? c}</span>)}</span>}</td>
                  <td data-label="Signals">{(() => { const tags = signalTags(r); return tags === null ? <span className="tag">not enriched</span> : tags.length ? <>{tags.slice(0, 3).map((t) => <span key={t.text} className={`pill ${t.tone}`}>{t.text}</span>)}{tags.length > 3 && <span className="pill" title={tags.slice(3).map((t) => t.text).join(', ')}>+{tags.length - 3} more</span>}</> : <span className="tag">nothing notable</span>; })()}</td>
                  <td data-label="Real seller?"><VerdictButtons id={r.fb_page_id} verdict={r.verdict} title={r.title ?? ''} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.total === 0 && (
          <div className="empty">
            <p>{s.total ? 'No pages match these filters.' : 'No pages yet. Start a search to find Egyptian seller pages by keyword and city.'}</p>
            {s.total > 0 ? <Link className="quiet" href="/">Clear filters</Link> : <Link className="primary" href="/searches">Go to Searches</Link>}
          </div>
        )}
      </div>
      <nav className="pager" aria-label="Pages of results">
        <span className="sizes">Per page{PAGE_SIZES.map((n) => n === limit ? <b key={n} aria-current="true">{n}</b> : <Link key={n} className="quiet small" href={href({ limit: String(n), offset: undefined })}>{n}</Link>)}</span>
        {list.total > 0 && <span className="pageno">Page {pageNo} of {pageCount}</span>}
        {offset > 0 ? <Link className="quiet" href={href({ offset: String(Math.max(0, offset - limit)) })}>Previous</Link> : <span className="quiet" aria-disabled="true">Previous</span>}
        {to < list.total ? <Link className="quiet" href={href({ offset: String(offset + limit) })}>Next</Link> : <span className="quiet" aria-disabled="true">Next</span>}
      </nav>
      {detail && <Drawer key={detail.fb_page_id} d={detail} foundBy={foundBy} outreach={outreachState(detail.fb_page_id)} closeHref={href({ open: undefined })} />}
    </main>
  );
}
