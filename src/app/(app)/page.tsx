import Link from 'next/link';
import { CheckWebsites } from '@/components/CheckWebsites';
import { Drawer } from '@/components/Drawer';
import { FilterBar } from '@/components/FilterBar';
import { VerdictButtons } from '@/components/VerdictButtons';
import { requireAuth } from '@/lib/auth';
import { filtersToQuery, parseFilters, type Filters } from '@/lib/filters';
import { facets, pageDetail, queryPages, SORT_KEYS, stats } from '@/lib/pages';
import { PITCH_LABEL, pitchTone, signalTags, STAGE_LABEL, webInfo } from '@/lib/present';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const nf = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en');
const LIMIT = 50;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAuth();
  const sp = await searchParams;
  let filters: Filters = {};
  let filterError = '';
  try { filters = parseFilters(sp); } catch (e) { filterError = e instanceof Error ? e.message : 'Invalid filters'; }
  const sort = SORT_KEYS.includes(first(sp.sort) ?? '') ? first(sp.sort)! : 'followers';
  const dir = first(sp.dir) === 'asc' ? 'asc' : 'desc';
  const offset = Math.max(0, parseInt(first(sp.offset) ?? '0', 10) || 0);
  const list = queryPages(filters, { sort, dir, limit: LIMIT, offset });
  const s = stats();
  const openId = first(sp.open);
  const detail = openId ? pageDetail(openId) : null;

  // Links keep the current filters and sort order.
  const base = filtersToQuery(filters);
  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams(base);
    q.set('sort', sort); q.set('dir', dir);
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) q.delete(k); else q.set(k, v); }
    return `/?${q}`;
  };
  const values = Object.fromEntries([...base.entries()]);
  const to = offset + list.rows.length;
  const th = (key: string, label: string, cls?: string) => (
    <th scope="col" className={cls} aria-sort={sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link className="sort" href={href({ sort: key, dir: sort === key && dir === 'desc' ? 'asc' : sort === key ? 'desc' : key === 'followers' || key === 'fit' ? 'desc' : 'asc', offset: undefined })}>{label}</Link>
    </th>
  );
  return (
    <>
      <header className="top">
        <p className="summary" aria-live="polite">
          <b>{full.format(s.total)}</b> pages. <b>{s.whatsappConfirmed}</b> link WhatsApp, <b>{s.hasWebsite}</b> have a website, <b>{s.noneFound}</b> had no website found, <b>{s.unchecked}</b> not checked yet. <b>{s.enriched}</b> have posts and ads data.
          {(s.sellerYes > 0 || s.sellerNo > 0) && <> You marked <b>{s.sellerYes}</b> as real sellers and <b>{s.sellerNo}</b> as not.</>}
        </p>
      </header>
      <FilterBar facets={facets()} values={values} />
      <main id="main-content">
        {filterError && <p className="error" role="alert">{filterError}</p>}
        <p className="count" aria-live="polite">
          {list.total ? `${offset + 1}–${to} of ${full.format(list.total)} pages` : ''}
          {list.total > 0 && <> &middot; <a href={`/api/export?${base}`} download>Download CSV</a></>}
          {list.total > 0 && <> &middot; <CheckWebsites filters={filters} mode="website_check" /> <CheckWebsites filters={filters} mode="enrich" /></>}
        </p>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>{th('title', 'Page')}{th('fit', 'Fit')}{th('followers', 'Followers', 'num')}{th('city', 'City')}<th scope="col">Type</th><th scope="col">WhatsApp</th>{th('website', 'Website')}{th('stage', 'Stage')}<th scope="col">Signals</th><th scope="col">Real seller?</th></tr>
            </thead>
            <tbody>
              {list.rows.map((r) => {
                const web = webInfo(r);
                const types = (r.business_type ?? '').split(',').filter(Boolean);
                return (
                  <tr key={r.fb_page_id} className={r.verdict === 'seller_no' ? 'rejected' : ''}>
                    <td className={web.group ? `e-${web.group}` : ''}>
                      <Link className="link" dir="auto" href={href({ open: r.fb_page_id })} scroll={false} data-open-id={r.fb_page_id}>{r.title ?? '(no name)'}</Link>
                      <span className="sub" dir="auto">{r.category}</span>
                    </td>
                    <td>{r.pitch ? <><span className={`pill ${pitchTone(r.pitch)}`}>{PITCH_LABEL[r.pitch]}</span><span className="sub">shop {r.shop_fit} &middot; WhatsApp {r.wa_fit}</span></> : <span className="tag">not scored</span>}</td>
                    <td className="num">{nf.format(r.followers)}</td>
                    <td>{r.city ?? <span className="tag">{r.country ?? 'unknown'}</span>}</td>
                    <td>{types.slice(0, 2).join(', ')}{types.length > 2 && <span className="tag"> +{types.length - 2}</span>}</td>
                    <td>
                      {r.whatsapp
                        ? <><span className="ltr">{r.whatsapp}</span><span className={`sub${r.whatsapp_source === 'page' ? '' : ' guess'}`}>{r.whatsapp_source === 'page' ? 'linked on the page' : 'mobile guess'}</span></>
                        : <span className="tag">none</span>}
                    </td>
                    <td><span className={`state ${web.group}`}>{web.text}</span>{r.website_domain && <span className="sub" dir="ltr">{r.website_domain}</span>}</td>
                    <td>{STAGE_LABEL[r.stage] ?? r.stage}</td>
                    <td>{(() => { const tags = signalTags(r); return tags === null ? <span className="tag">not enriched</span> : tags.length ? tags.map((t) => <span key={t.text} className={`pill ${t.tone}`}>{t.text}</span>) : <span className="tag">nothing notable</span>; })()}</td>
                    <td><VerdictButtons id={r.fb_page_id} verdict={r.verdict} title={r.title ?? ''} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {list.total === 0 && (
          <div className="empty">
            <p>{s.total ? 'No pages match these filters.' : 'No pages yet. Use Jobs to find new pages.'}</p>
            {s.total > 0 && <Link className="quiet" href="/">Clear filters</Link>}
          </div>
        )}
        <nav className="pager" aria-label="Pages of results">
          {offset > 0 ? <Link className="quiet" href={href({ offset: String(Math.max(0, offset - LIMIT)) })}>Previous</Link> : <span className="quiet" aria-disabled="true">Previous</span>}
          {to < list.total ? <Link className="quiet" href={href({ offset: String(offset + LIMIT) })}>Next</Link> : <span className="quiet" aria-disabled="true">Next</span>}
        </nav>
      </main>
      {detail && <Drawer key={detail.fb_page_id} d={detail} closeHref={href({ open: undefined })} />}
    </>
  );
}
