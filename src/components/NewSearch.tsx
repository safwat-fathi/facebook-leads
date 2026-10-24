'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { postJson } from './api';
import { useEstimate } from './useEstimate';
import { usd } from '@/lib/present';

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

export function NewSearch() {
  const router = useRouter();
  const [terms, setTerms] = useState('');
  const [cities, setCities] = useState<string[]>(['Cairo']);
  const [perSearch, setPerSearch] = useState(20);
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locations = cities.map((c) => `${c}, Egypt`);
  const ready = lines(terms).length > 0 && lines(terms).length <= 8 && locations.length > 0 && locations.length <= 3 && perSearch >= 5 && perSearch <= 40;
  const params = { terms: lines(terms), locations, perSearch };
  const { est, error: estError } = useEstimate(ready ? { kind: 'discover', params } : null);

  const addTerms = (t: string[]) => setTerms((cur) => [...new Set([...lines(cur), ...t])].join('\n'));
  const toggleCity = (c: string) => setCities((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const r = await postJson('/api/jobs', { kind: 'discover', params, budgetUsd: Number(budget || est?.suggestedBudgetUsd) });
    if (r.ok) router.push(`/jobs/${(r.data as { id: number }).id}`); else { setError(r.error); setBusy(false); }
  }
  return (
    <form className="newsearch" onSubmit={start}>
      <h2>Find new pages</h2>
      <p className="note">Searches Facebook pages by keyword and city, and saves every page it finds. Pages you already have are updated, not duplicated.</p>
      <label htmlFor="terms">Search terms, one per line</label>
      <textarea id="terms" value={terms} onChange={(e) => setTerms(e.target.value)} rows={4} dir="auto" placeholder="ملابس حريمي" />
      <p className="chips" aria-label="Add example terms">{PRESETS.map((p) => <button key={p.label} type="button" className="quiet" onClick={() => addTerms(p.terms)}>+ {p.label}</button>)}</p>
      <fieldset className="cities"><legend>Cities (up to 3)</legend>
        {CITIES.map((c) => <label key={c} className="check"><input type="checkbox" checked={cities.includes(c)} disabled={!cities.includes(c) && cities.length >= 3} onChange={() => toggleCity(c)} /> {c}</label>)}
      </fieldset>
      <div className="inline">
        <label>Results per search <input type="number" min={5} max={40} value={perSearch} onChange={(e) => setPerSearch(Number(e.target.value))} /></label>
        <label>Budget (USD) <input type="number" min={0.01} step={0.01} value={budget} placeholder={est ? String(est.suggestedBudgetUsd) : ''} onChange={(e) => setBudget(e.target.value)} /></label>
      </div>
      <p className="estimate" aria-live="polite">
        {!ready && 'Add at least one term and one city to see the cost.'}
        {ready && est && <>{est.detail.searches} searches, up to {est.detail.perSearch} pages each: about <b>{usd(est.usd)}</b>. {usd(est.budget.available)} of the daily {usd(est.budget.dailyLimit)} limit is available.</>}
        {ready && !est && !estError && 'Working out the cost…'}
      </p>
      {(estError || error) && <p className="error" role="alert">{error || estError}</p>}
      <button type="submit" className="primary" disabled={!ready || !est || busy}>{busy ? 'Starting…' : 'Start search'}</button>
    </form>
  );
}
