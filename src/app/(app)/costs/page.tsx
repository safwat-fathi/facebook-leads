import Link from 'next/link';
import { requireAuth } from '@/lib/auth';
import { costByDay, costByWork, costTotals, emailsSent, listSpend, PROVIDER_LABEL, WINDOWS } from '@/lib/costs';
import { usd } from '@/lib/present';

const LIMIT = 50;
const WORK: Record<string, string> = { discover: 'Finding pages', enrich: 'Enrich (posts and ads)', website_check: 'Check websites', outreach_draft: 'Message drafts' };
const at = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

export default async function CostsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAuth();
  const sp = await searchParams;
  const raw = Array.isArray(sp.offset) ? sp.offset[0] : sp.offset;
  const offset = Math.max(0, parseInt(raw ?? '0', 10) || 0);
  const totals = costTotals(), days = costByDay(30), work = costByWork(), list = listSpend({ limit: LIMIT, offset }), mail = emailsSent();
  const to = offset + list.rows.length;
  return (
    <main className="jobpage costs">
      <p className="summary">Spent <b>{usd(totals[2].usd[3])}</b> in total: <b>{usd(totals[0].usd[3])}</b> on Apify and <b>{usd(totals[1].usd[3])}</b> on the model.</p>

      <h2>Totals</h2>
      <div className="tablewrap"><table>
        <thead><tr><th scope="col">Provider</th>{WINDOWS.map(([label]) => <th key={label} scope="col" className="num">{label}</th>)}</tr></thead>
        <tbody>{totals.map((r) => (
          <tr key={r.provider}><th scope="row">{r.provider === 'total' ? 'Total' : PROVIDER_LABEL[r.provider]}</th>{r.usd.map((v, i) => <td key={i} className="num">{usd(v)}</td>)}</tr>
        ))}</tbody>
      </table></div>
      <p className="note">Emails are not charged per message here: {mail.last24h} sent in the last 24 hours, {mail.all} in total.</p>

      <h2>By day (UTC, last 30 days)</h2>
      {days.length === 0 ? <p className="empty">Nothing spent yet.</p> : (
        <div className="tablewrap"><table>
          <thead><tr><th scope="col">Day</th><th scope="col" className="num">Apify</th><th scope="col" className="num">Model</th><th scope="col" className="num">Total</th></tr></thead>
          <tbody>{days.map((d) => <tr key={d.day}><td>{d.day}</td><td className="num">{usd(d.apify)}</td><td className="num">{usd(d.openrouter)}</td><td className="num">{usd(d.apify + d.openrouter)}</td></tr>)}</tbody>
        </table></div>
      )}

      <h2>By kind of work</h2>
      {work.length === 0 ? <p className="empty">Nothing spent yet.</p> : (
        <div className="tablewrap"><table>
          <thead><tr><th scope="col">Work</th><th scope="col" className="num">Charges</th><th scope="col" className="num">Apify</th><th scope="col" className="num">Model</th><th scope="col" className="num">Total</th></tr></thead>
          <tbody>{work.map((w) => <tr key={w.work}><td>{WORK[w.work] ?? w.work}</td><td className="num">{w.charges}</td><td className="num">{usd(w.apify)}</td><td className="num">{usd(w.openrouter)}</td><td className="num">{usd(w.apify + w.openrouter)}</td></tr>)}</tbody>
        </table></div>
      )}

      <h2>Every charge</h2>
      <p className="count">{list.total ? `${offset + 1}–${to} of ${list.total} charges` : 'No charges yet.'}{list.total > 0 && <> &middot; <a href="/api/costs" download>Download CSV</a></>}</p>
      {list.total > 0 && (
        <div className="tablewrap"><table>
          <thead><tr><th scope="col">When (UTC)</th><th scope="col">Provider</th><th scope="col" className="num">Amount</th><th scope="col">What</th><th scope="col">Job</th></tr></thead>
          <tbody>{list.rows.map((r) => (
            <tr key={r.id}><td>{at(r.at)}</td><td>{PROVIDER_LABEL[r.provider]}</td><td className="num">{usd(r.usd)}</td><td dir="auto">{r.note}</td>
              <td>{r.job_id ? <Link className="link" href={`/jobs/${r.job_id}`}>#{r.job_id} {WORK[r.kind ?? ''] ?? ''}</Link> : <span className="tag">{WORK.outreach_draft}</span>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <nav className="pager" aria-label="Pages of charges">
        {offset > 0 ? <Link className="quiet" href={`/costs?offset=${Math.max(0, offset - LIMIT)}`}>Previous</Link> : <span className="quiet" aria-disabled="true">Previous</span>}
        {to < list.total ? <Link className="quiet" href={`/costs?offset=${offset + LIMIT}`}>Next</Link> : <span className="quiet" aria-disabled="true">Next</span>}
      </nav>
      <p className="note">Amounts are what Apify and OpenRouter reported when each call finished. If the server restarts during a job, the Apify runs are aborted and what they had already charged is not recorded here, so check the Apify console after a restart mid-job.</p>
    </main>
  );
}
