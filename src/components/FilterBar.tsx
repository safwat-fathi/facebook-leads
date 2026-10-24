'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { STAGE_LABEL } from '@/lib/present';

type Facets = { countries: { v: string; n: number }[]; cities: { v: string; n: number }[]; types: { v: string; n: number }[] };
const FIELDS = ['q', 'min-followers', 'max-followers', 'country', 'city', 'type', 'whatsapp', 'website', 'stage', 'verdict', 'enriched', 'signal', 'pitch'];

// Filters live in the URL. The inputs are uncontrolled; every change rewrites the query (debounced for typing) and keeps sort order.
export function FilterBar({ facets, values }: { facets: Facets; values: Record<string, string> }) {
  const router = useRouter(), path = usePathname(), current = useSearchParams();
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(true);
  useEffect(() => { if (matchMedia('(max-width: 720px)').matches) setOpen(false); }, []); // phones start with the table, filters one tap away

  function apply() {
    const f = form.current; if (!f) return;
    const next = new URLSearchParams();
    for (const k of FIELDS) { const v = String((f.elements.namedItem(k) as HTMLInputElement | null)?.value ?? '').trim(); if (v) next.set(k, v); }
    for (const k of ['sort', 'dir', 'include-unknown']) { const v = current.get(k); if (v) next.set(k, v); }
    router.replace(`${path}${next.size ? '?' + next : ''}`, { scroll: false });
  }
  function clear() {
    const f = form.current; if (!f) return;
    for (const k of FIELDS) { const el = f.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | null; if (el) el.value = ''; }
    apply();
  }
  const select = (name: string, label: string, options: [string, string][]) => (
    <label>{label}
      <select name={name} defaultValue={values[name] ?? ''}>
        <option value="">Any</option>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
  return (
    <details className="filter-box" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Filters</summary>
      <form ref={form} className="filters" role="search" aria-label="Filter leads" onSubmit={(e) => e.preventDefault()}
        onChange={(e) => { clearTimeout(timer.current); timer.current = setTimeout(apply, (e.target as HTMLElement).tagName === 'SELECT' ? 0 : 250); }}>
        <label className="wide">Page name <input type="search" name="q" autoComplete="off" defaultValue={values.q ?? ''} /></label>
        <label>Followers from <input type="number" name="min-followers" min={0} inputMode="numeric" autoComplete="off" defaultValue={values['min-followers'] ?? ''} /></label>
        <label>Followers up to <input type="number" name="max-followers" min={0} inputMode="numeric" autoComplete="off" defaultValue={values['max-followers'] ?? ''} /></label>
        {select('country', 'Country', facets.countries.map((c) => [c.v, `${c.v} (${c.n})`]))}
        {select('city', 'City', facets.cities.map((c) => [c.v, `${c.v} (${c.n})`]))}
        {select('type', 'Business type', facets.types.map((t) => [t.v, `${t.v} (${t.n})`]))}
        {select('whatsapp', 'WhatsApp', [['confirmed', 'Linked on the page'], ['any', 'Linked or mobile guess'], ['none', 'None']])}
        {select('website', 'Website', [['real', 'Has a website'], ['none', 'No website found'], ['review', 'Needs review'], ['unknown', 'Not checked yet']])}
        {select('stage', 'Stage', Object.entries(STAGE_LABEL))}
        {select('verdict', 'Seller check', [['seller_yes', 'Marked real seller'], ['seller_no', 'Marked not a seller'], ['none', 'Not marked yet']])}
        {select('enriched', 'Posts and ads', [['yes', 'Enriched'], ['no', 'Not enriched yet']])}
        {select('pitch', 'Fit', [['shop', 'Web shop (shop score 50+)'], ['wa', 'WhatsApp (score 50+)'], ['both', 'Both'], ['check', 'Check website first'], ['skip', 'Skip'], ['none', 'Not scored yet']])}
        {select('signal', 'Signal', [['inbox', 'Orders by message'], ['cod', 'Cash on delivery'], ['active', 'Posts often (4+ in 30 days)'], ['ads', 'Runs ads'], ['message_ads', 'Message or WhatsApp ads'], ['shop_link', 'Order link (already sells online)']])}
        <button type="button" className="quiet" onClick={clear}>Clear filters</button>
      </form>
    </details>
  );
}
