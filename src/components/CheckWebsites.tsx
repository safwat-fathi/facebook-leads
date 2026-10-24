'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { postJson } from './api';
import { useEstimate } from './useEstimate';
import { usd } from '@/lib/present';
import type { Filters } from '@/lib/filters';

type Mode = 'website_check' | 'enrich';
const TEXT: Record<Mode, { button: string; title: string; note: string; verb: string }> = {
  website_check: { button: 'Check websites…', title: 'Check websites', verb: 'check', note: 'Looks at pages that match your current filters and have no website result yet, biggest first. Pages that list their own site are checked for free; the others get a web search by the agent.' },
  enrich: { button: 'Enrich…', title: 'Enrich with posts and ads', verb: 'enrich', note: 'Reads each page’s 8 most recent posts (how often it posts, whether it takes orders by message or cash on delivery, whether it already sells through a link) and its active ads. Applies to pages in your current filter that have not been enriched yet, biggest first.' },
};

// One dialog for both actions on "the pages in the CURRENT filter". A native <dialog> keeps focus inside while it is open.
export function CheckWebsites({ filters, mode }: { filters: Filters; mode: Mode }) {
  const router = useRouter();
  const dlg = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(10);
  const [recheck, setRecheck] = useState(false);
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = TEXT[mode];
  const params = { filters, limit, recheck };
  const { est, error: estError } = useEstimate(open && limit >= 1 && limit <= 50 ? { kind: mode, params } : null);
  useEffect(() => { if (open) dlg.current?.showModal(); }, [open]);

  async function start() {
    setBusy(true); setError('');
    const r = await postJson('/api/jobs', { kind: mode, params, budgetUsd: Number(budget || est?.suggestedBudgetUsd) });
    if (r.ok) router.push(`/jobs/${(r.data as { id: number }).id}`); else { setError(r.error); setBusy(false); }
  }
  const d = est?.detail;
  return (
    <>
      <button type="button" className="quiet" onClick={() => setOpen(true)}>{t.button}</button>
      {open && (
        <dialog ref={dlg} className="modal" aria-labelledby={`cw-title-${mode}`} onClose={() => setOpen(false)}>
          <h2 id={`cw-title-${mode}`}>{t.title}</h2>
          <p className="note">{t.note}</p>
          <div className="inline">
            <label>How many pages <input type="number" min={1} max={50} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></label>
            <label>Budget (USD) <input type="number" min={0.01} step={0.01} value={budget} placeholder={est ? String(est.suggestedBudgetUsd) : ''} onChange={(e) => setBudget(e.target.value)} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={recheck} onChange={(e) => setRecheck(e.target.checked)} /> Also {t.verb} pages that already have a result</label>
          <p className="estimate" aria-live="polite">
            {d && d.total > 0 && mode === 'website_check' && <>{d.total} pages: {d.listed} list their own site (free), {d.needAgent} need the agent, about <b>{usd(est!.usd)}</b>. {usd(est!.budget.available)} of the daily limit is available.</>}
            {d && d.total > 0 && mode === 'enrich' && <>{d.total} pages ({d.adsPages} run ads), about <b>{usd(est!.usd)}</b>. {usd(est!.budget.available)} of the daily limit is available.</>}
            {d && d.total === 0 && <> Nothing to {t.verb}: every page in this filter already has a result. Tick the box above to {t.verb} them again.</>}
            {!d && !estError && 'Working out the cost…'}
          </p>
          {(estError || error) && <p className="error" role="alert">{error || estError}</p>}
          <div className="row-actions">
            <button type="button" className="primary" disabled={!est || est.detail.total === 0 || busy} onClick={start}>{busy ? 'Starting…' : `Start ${t.verb === 'check' ? 'check' : 'enrichment'}`}</button>
            <button type="button" className="quiet" onClick={() => dlg.current?.close()}>Cancel</button>
          </div>
        </dialog>
      )}
    </>
  );
}
