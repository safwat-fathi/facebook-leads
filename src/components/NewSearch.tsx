'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { postJson } from './api';
import { useEstimate } from './useEstimate';
import { searchHref, searchName } from '@/lib/job-present';
import { usd } from '@/lib/present';
import type { SavedSearch } from '@/lib/saved-searches';

const PRESETS: { label: string; terms: string[] }[] = [
  { label: 'Clothing', terms: ['ملابس حريمي', 'ملابس رجالي', 'عبايات', 'فساتين'] },
  { label: 'Beauty', terms: ['مستحضرات تجميل', 'عطور', 'مكياج'] },
  { label: 'Accessories', terms: ['اكسسوارات', 'شنط', 'ساعات'] },
  { label: 'Home', terms: ['ادوات منزلية', 'مفروشات', 'ديكور'] },
  { label: 'Electronics', terms: ['موبايلات', 'اكسسوارات موبايل'] },
  { label: 'Shoes', terms: ['احذية'] },
];
const CITIES = ['Cairo', 'Giza', 'Alexandria', 'Mansoura', 'Tanta', 'Asyut', 'Aswan', 'Luxor'];
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

/** The form state of an earlier search, for "Run again". */
export type Prefill = { terms: string; cities: string[]; perSearch: number; minF: string; maxF: string; label: string };

export function NewSearch({ prefill, startOpen }: { prefill?: Prefill; startOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(!!startOpen);
  const [label, setLabel] = useState(prefill?.label ?? '');
  const [terms, setTerms] = useState(prefill?.terms ?? '');
  const [cities, setCities] = useState<string[]>(prefill?.cities ?? ['Cairo']);
  const [perSearch, setPerSearch] = useState(prefill?.perSearch ?? 20);
  const [minF, setMinF] = useState(prefill?.minF ?? '');
  const [maxF, setMaxF] = useState(prefill?.maxF ?? '');
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const locations = cities.map((c) => `${c}, Egypt`);
  const ready = lines(terms).length > 0 && lines(terms).length <= 8 && locations.length > 0 && locations.length <= 3 && perSearch >= 5 && perSearch <= 40;
  const params = { terms: lines(terms), locations, perSearch, ...(minF && { minFollowers: Number(minF) }), ...(maxF && { maxFollowers: Number(maxF) }) };
  const { est, error: estError } = useEstimate(open && ready ? { kind: 'discover', params } : null);
  const suggestion = ready ? searchName({ params }) : 'For example: Cosmetics Q4';

  const b = Number(budget || est?.suggestedBudgetUsd || 0);
  const warning = !est || !b ? '' : b > est.budget.maxJob ? `Budget ${usd(b)} is above the per-job limit of ${usd(est.budget.maxJob)}. Lower the budget or the number of searches.`
    : b > est.budget.available ? `Budget ${usd(b)} is more than the ${usd(est.budget.available)} left of today's limit.`
    : b < est.usd ? `Budget ${usd(b)} is below the ${usd(est.usd)} estimate, so the search will stop early.` : '';
  const addTerms = (t: string[]) => setTerms((cur) => [...new Set([...lines(cur), ...t])].join('\n'));
  const toggleCity = (c: string) => setCities((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  useEffect(() => { if (open) fetch('/api/saved-searches').then((r) => r.json()).then((d) => setSaved(d.saved ?? [])).catch(() => {}); }, [open]);
  async function saveCurrent() {
    const name = window.prompt('Name this template', label.trim())?.trim();
    if (!name) return;
    const r = await postJson('/api/saved-searches', { name, params: { terms, cities, perSearch, minF, maxF, budget } });
    if (r.ok) setSaved((r.data as { saved: SavedSearch[] }).saved); else setError(r.error);
  }
  async function removeSaved(id: number) {
    const r = await fetch(`/api/saved-searches?id=${id}`, { method: 'DELETE' });
    if (r.ok) setSaved((await r.json()).saved);
  }
  const load = (p: SavedSearch['params']) => { setTerms(p.terms); setCities(p.cities); setPerSearch(p.perSearch); setMinF(p.minF); setMaxF(p.maxF); setBudget(p.budget); };
  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const r = await postJson('/api/jobs', { kind: 'discover', params, budgetUsd: Number(budget || est?.suggestedBudgetUsd), ...(label.trim() && { label: label.trim() }) });
    if (r.ok) { router.push(searchHref((r.data as { id: number }).id)); setOpen(false); setBusy(false); } else { setError(r.error); setBusy(false); }
  }
  if (!open) return <p className="row-actions"><button type="button" className="primary" onClick={() => setOpen(true)}>+ New search</button></p>;
  return (
    <form className="newsearch" onSubmit={start}>
      <h2>New search</h2>
      <p className="note">Searches Facebook pages by keyword and city, and saves every page it finds. Pages you already have are updated, not duplicated.</p>
      {saved.length > 0 && <p className="chips" aria-label="Templates"><span className="note">Templates</span>{saved.map((x) => <span key={x.id} className="chips"><button type="button" className="quiet" onClick={() => load(x.params)}>{x.name}</button><button type="button" className="quiet" aria-label={`Delete template ${x.name}`} onClick={() => removeSaved(x.id)}>×</button></span>)}</p>}
      <label htmlFor="label">Label (optional) <input id="label" value={label} maxLength={60} dir="auto" placeholder={suggestion} onChange={(e) => setLabel(e.target.value)} /></label>
      <p className="note">Your name for this search. Use the same label on several searches to group them, then filter by it on Leads and Searches. Left blank, the search is named after its terms and cities.</p>
      <label htmlFor="terms">Search terms, one per line</label>
      <textarea id="terms" value={terms} onChange={(e) => setTerms(e.target.value)} rows={4} dir="auto" placeholder="ملابس حريمي" />
      <p className="chips" aria-label="Add example terms">{PRESETS.map((p) => <button key={p.label} type="button" className="quiet" onClick={() => addTerms(p.terms)}>+ {p.label}</button>)}</p>
      <fieldset className="cities"><legend>Cities (up to 3)</legend>
        {CITIES.map((c) => <label key={c} className="check"><input type="checkbox" checked={cities.includes(c)} disabled={!cities.includes(c) && cities.length >= 3} onChange={() => toggleCity(c)} /> {c}</label>)}
      </fieldset>
      <div className="inline">
        <label>Results per search <input type="number" min={5} max={40} value={perSearch} onChange={(e) => setPerSearch(Number(e.target.value))} /></label>
        <label>Followers from <input type="number" min={0} value={minF} onChange={(e) => setMinF(e.target.value)} /></label>
        <label>Followers up to <input type="number" min={0} value={maxF} onChange={(e) => setMaxF(e.target.value)} /></label>
        <label>Budget (USD) <input type="number" min={0.01} step={0.01} value={budget} placeholder={est ? String(est.suggestedBudgetUsd) : ''} onChange={(e) => { setBudget(e.target.value); setError(''); }} /></label>
      </div>
      <p className="estimate" aria-live="polite">
        {!ready && 'Add at least one term and one city to see the cost.'}
        {ready && est && <>{est.detail.searches} searches, up to {est.detail.perSearch} pages each: about <b>{usd(est.usd)}</b>. {usd(est.budget.available)} of the daily {usd(est.budget.dailyLimit)} limit is available.</>}
        {ready && !est && !estError && 'Working out the cost…'}
      </p>
      {warning && <p className="error" role="alert">{warning}</p>}
      {(estError || error) && <p className="error" role="alert">{error || estError}</p>}
      <div className="row-actions">
        <button type="submit" className="primary" disabled={!ready || !est || busy}>{busy ? 'Starting…' : 'Start search'}</button>
        <button type="button" className="quiet" disabled={!terms.trim()} onClick={saveCurrent}>Save as template</button>
        <button type="button" className="quiet" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
