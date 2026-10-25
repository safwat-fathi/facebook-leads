'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASIS, CHANNEL_LABEL, CONTACT_CHANNELS, PITCH_LABEL, PLATFORM_LABEL, STAGE_LABEL, pitchTone, safeUrl, usd, webInfo } from '@/lib/present';
import { THRESHOLD, type Reason } from '@/lib/score';
import type { PageDetail } from '@/lib/pages';
import type { OutreachState } from '@/lib/outreach';
import { postJson } from './api';
import { Outreach } from './Outreach';

const nf = new Intl.NumberFormat('en');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }) : '');
function Link({ href, children }: { href: string; children?: React.ReactNode }) {
  const safe = safeUrl(href); // Facebook-supplied URLs: only http(s) become links, anything else (javascript:, data:) stays plain text
  return safe ? <a href={safe} target="_blank" rel="noopener noreferrer">{children ?? safe}</a> : <span>{children ?? href}</span>;
}
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === '' || children === false) return null;
  return (<><dt>{label}</dt><dd>{children}</dd></>);
}

function Reasons({ title, score, reasons }: { title: string; score: number; reasons: Reason[] }) {
  return (
    <>
      <p className="reasons-head"><b>{title}: {score}</b> of 100</p>
      {reasons.length === 0 ? <p className="note">Nothing scored on this side.</p> : (
        <ul className="reasons">{reasons.map((r, i) => <li key={i}><span className={`pts ${r.points > 0 ? 'plus' : r.points < 0 ? 'minus' : ''}`}>{r.points > 0 ? '+' : ''}{r.points}</span><span>{r.text}</span></li>)}</ul>
      )}
    </>
  );
}

// A native <dialog> opened with showModal(): focus is trapped, the page behind is inert, and Esc closes it, with no hand-written code.
export function Drawer({ d, closeHref, outreach }: { d: PageDetail; closeHref: string; outreach: OutreachState }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { const el = ref.current; if (el && !el.open) el.showModal(); }, []);

  async function save(patch: Record<string, unknown>) {
    setSaved('Saving…'); setError('');
    const r = await postJson(`/api/pages/${encodeURIComponent(d.fb_page_id)}`, patch);
    if (r.ok) { setSaved('Saved'); router.refresh(); } else { setSaved(''); setError(`Not saved: ${r.error}`); }
  }
  const web = webInfo(d);
  const ev = d.website_evidence;
  const note = typeof ev?.note === 'string' ? ev.note : '';
  const sc = d.score;
  const manual = d.website_status === 'confirmed_manual';
  // Blank would read as "not checked", so a checked site with no platform says so.
  const platformText = d.store_platform ? PLATFORM_LABEL[d.store_platform] : web.group === 'has' && d.website_checked_at ? (manual ? 'Not set' : 'None detected') : '';
  const [site, setSite] = useState(manual ? d.website_url ?? '' : '');
  const [platform, setPlatform] = useState<string>(manual ? d.store_platform ?? '' : '');
  return (
    <dialog ref={ref} className="drawer" aria-labelledby="d-title"
      onClose={() => { document.querySelector<HTMLElement>(`[data-open-id="${CSS.escape(d.fb_page_id)}"]`)?.focus(); router.replace(closeHref, { scroll: false }); }}
      onClick={(e) => { if (e.target === ref.current) ref.current?.close(); /* click on the backdrop */ }}>
      <div className="drawer-head">
        <h2 id="d-title" dir="auto">{d.title ?? '(no name)'}</h2>
        <button type="button" className="quiet" onClick={() => ref.current?.close()}>Close</button>
      </div>
      <div className="drawer-body">
        <p><Link href={d.url}>Open on Facebook</Link></p>
        <h3>Fit for your services</h3>
        {sc.blocked ? <p><span className="pill">Skip</span> {sc.blocked}. Not scored.</p> : (
          <>
            <p>{sc.pitch ? <span className={`pill ${pitchTone(sc.pitch)}`}>{PITCH_LABEL[sc.pitch]}</span> : <span className="pill">No pitch yet</span>}{' '}
              <span className="note">A service counts as a fit at {THRESHOLD} of 100. The weights are first guesses.</span></p>
            <Reasons title="Web shop" score={sc.shop} reasons={sc.reasons.filter((r) => r.side === 'shop')} />
            <Reasons title="WhatsApp automation" score={sc.wa} reasons={sc.reasons.filter((r) => r.side === 'wa')} />
            {sc.missing.length > 0 && <p className="note">Could not judge: {sc.missing.join('; ')}. The scores may change once these are known.</p>}
          </>
        )}
        <h3>About this page</h3>
        <dl className="facts">
          <Fact label="Followers">{nf.format(d.followers)}</Fact>
          <Fact label="Facebook category">{d.category}</Fact>
          <Fact label="Business type">{(d.business_type ?? '').split(',').filter(Boolean).join(', ')}</Fact>
          <Fact label="Location">{[d.city, d.country].filter(Boolean).join(', ')}</Fact>
          <Fact label="How we know">{BASIS[d.location_source ?? 'none']}</Fact>
          <Fact label="Address">{d.address}</Fact>
          <Fact label="Phone">{d.phone && <span className="ltr">{d.phone}</span>}</Fact>
          <Fact label="Email">{d.email}</Fact>
          <Fact label="WhatsApp">{d.whatsapp && <><span className="ltr">{d.whatsapp}</span><span className="note">{d.whatsapp_source === 'page' ? ' linked to WhatsApp on the page' : ' the page’s mobile number; not confirmed to be on WhatsApp'}</span></>}</Fact>
          <Fact label="Running ads">{d.ad_status}</Fact>
        </dl>
        <h3>Website</h3>
        <p><span className={`state ${web.group}`}>{web.text}</span><br /><span className="note">{web.why}</span></p>
        <dl className="facts">
          <Fact label="Site">{d.website_url && <Link href={d.website_url} />}</Fact>
          <Fact label="Links on the page">{d.website_listed.length > 0 && d.website_listed.map((l, i) => <div key={i}><Link href={l.url} /><span className="note"> {l.cls}</span></div>)}</Fact>
          <Fact label="Store platform">{platformText}</Fact>
          <Fact label="Last checked">{when(d.website_checked_at)}</Fact>
          <Fact label="Search cost">{d.agent_cost_usd ? usd(d.agent_cost_usd) : ''}</Fact>
        </dl>
        <details>
          <summary>{manual ? 'Edit the website you confirmed' : 'I confirmed this page\u2019s website myself'}</summary>
          <div className="review-row">
            <label htmlFor="d-site">Website</label>
            <input id="d-site" dir="ltr" inputMode="url" placeholder="https://example.com" maxLength={300} value={site} onChange={(e) => setSite(e.target.value)} />
          </div>
          <div className="review-row">
            <label htmlFor="d-platform">Store platform</label>
            <select id="d-platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="">Not known</option>
              {Object.entries(PLATFORM_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </div>
          <div className="review-row">
            <button type="button" className="quiet" disabled={!site.trim()} onClick={() => save({ website: { url: site, platform: platform || null } })}>Save website</button>
            {d.website_status && <button type="button" className="quiet" onClick={() => { setSite(''); setPlatform(''); save({ website: null }); }}>Reset to not checked</button>}
          </div>
          <p className="note">Saved as &ldquo;confirmed by you&rdquo;: it counts as having a website and Check websites will not change it.</p>
        </details>
        {note && <p className="note">{note}</p>}
        {ev && <details><summary>Evidence</summary><pre className="evidence" dir="ltr">{JSON.stringify(ev, null, 2)}</pre></details>}
        <h3>Activity</h3>
        {!d.signals && <p className="note">Not enriched yet. Use &ldquo;Enrich&hellip;&rdquo; on the Leads page to read this page&rsquo;s recent posts and ads.</p>}
        {d.signals && (
          <>
            <dl className="facts">
              <Fact label="Posts read">{d.signals.posts_fetched === 0 ? 'none (private or empty)' : `${d.signals.posts_fetched}, ${d.signals.posts_30d} in the last 30 days`}</Fact>
              <Fact label="Last post">{when(d.signals.last_post_at)}</Fact>
              <Fact label="Orders by message">{d.signals.posts_fetched ? `${d.signals.inbox_posts} of ${d.signals.posts_fetched} posts` : ''}</Fact>
              <Fact label="Cash on delivery">{d.signals.posts_fetched ? `${d.signals.cod_posts} of ${d.signals.posts_fetched} posts` : ''}</Fact>
              <Fact label="Order link">{d.signals.posts_fetched ? `${d.signals.shop_link_posts} of ${d.signals.posts_fetched} posts${d.signals.shop_link_posts ? ' (already sells through a site)' : ''}` : ''}</Fact>
              <Fact label="Posts with a price">{d.signals.posts_fetched ? `${d.signals.price_posts} of ${d.signals.posts_fetched}` : ''}</Fact>
              <Fact label="Comments">{d.signals.posts_fetched ? `${d.signals.comments_total} in total (count only)` : ''}</Fact>
              <Fact label="Phones in posts">{d.signals.post_phones.length > 0 && d.signals.post_phones.map((p) => <span key={p} className="ltr">{p} </span>)}</Fact>
              <Fact label="Ads">{d.signals.ads_checked ? (d.signals.ads_active ? `${d.signals.ads_active} active${d.signals.ads_message_cta ? ', with a message or WhatsApp button' : ''}` : 'none active') : 'unknown (the ads lookup failed)'}</Fact>
              <Fact label="Enriched">{when(d.signals.enriched_at)}{d.signals.cost_usd ? ` (${usd(d.signals.cost_usd)})` : ''}</Fact>
            </dl>
            {d.signals.quotes.map((q, i) => <p key={i} className="note quote" dir="auto">&ldquo;{q}&rdquo;</p>)}
          </>
        )}
        {d.intro && <><h3>In the page&rsquo;s own words</h3><p dir="auto">{d.intro}</p></>}
        <h3>Your review</h3>
        <div className="review-row">
          <label htmlFor="d-stage">Stage</label>
          <select id="d-stage" defaultValue={d.stage} onChange={(e) => save({ stage: e.target.value })}>
            {Object.entries(STAGE_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </div>
        {d.stage === 'contacted' && (() => {
          const via = (d.contacted_via ?? '').split(',').filter(Boolean);
          return (
            <div className="review-row">
              <span id="d-via">Contacted on</span>
              {CONTACT_CHANNELS.map((c) => (
                <button key={c} type="button" className="quiet" aria-pressed={via.includes(c)}
                  onClick={() => save({ contacted_via: via.includes(c) ? via.filter((v) => v !== c) : [...via, c] })}>{CHANNEL_LABEL[c]}</button>
              ))}
            </div>
          );
        })()}
        <div className="review-row">
          <span>Real Egyptian seller?</span>
          <button type="button" className="quiet" aria-pressed={d.verdict === 'seller_yes'} onClick={() => save({ verdict: d.verdict === 'seller_yes' ? null : 'seller_yes' })}>Yes</button>
          <button type="button" className="quiet" aria-pressed={d.verdict === 'seller_no'} onClick={() => save({ verdict: d.verdict === 'seller_no' ? null : 'seller_no' })}>No</button>
        </div>
        <label htmlFor="d-notes">Notes</label>
        <textarea id="d-notes" key={d.notes ?? ''} defaultValue={d.notes ?? ''} maxLength={5000} onBlur={(e) => { if (e.target.value !== (d.notes ?? '')) save({ notes: e.target.value }); }} />
        <Outreach key={d.fb_page_id} d={d} state={outreach} />
        <p className="saved" aria-live="polite">{saved}</p>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </dialog>
  );
}
