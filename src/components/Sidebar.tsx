'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usd } from '@/lib/present';
import { LogoutButton } from './LogoutButton';

// 24x24 line icons, same stroke style as app/icon.svg and the stage badges.
const NAV = [
  ['/', 'Leads', <path key="p" d="M4 6h16M4 12h16M4 18h10" />],
  ['/searches', 'Searches', <g key="g"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></g>],
  ['/jobs', 'Jobs', <path key="p" d="M13 3L5 14h6l-1 7 8-11h-6z" />],
  ['/costs', 'Costs', <g key="g"><circle cx="12" cy="12" r="9" /><path d="M14.8 9.2c-.5-1-1.5-1.5-2.8-1.5-1.6 0-2.7.8-2.7 2 0 3 5.6 1.3 5.6 4.3 0 1.2-1.2 2-2.9 2-1.4 0-2.5-.6-3-1.7M12 6v1.7M12 16.3V18" /></g>],
] as const;
type Live = { active: number; spent24h: number; dailyLimit: number };

// A client component because layouts do not re-render on client navigation: it asks for itself on every route change (starting a job
// navigates), then every 5 s while something is running. Nothing is polled while idle.
export function Sidebar() {
  const path = usePathname();
  const [live, setLive] = useState<Live | null>(null);
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let next: Live | null = null;
      try { const r = await fetch('/api/jobs/active'); if (r.ok) next = (await r.json()) as Live; } catch { /* try again on the next navigation */ }
      if (stop) return;
      if (next) setLive(next);
      if (next && next.active > 0) timer = setTimeout(tick, 5000);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [path]);
  const limit = live?.dailyLimit ?? 0;
  return (
    <nav className="side" aria-label="Main">
      <Link className="brand" href="/">
        <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="currentColor" /><path d="M9 21V11m7 10V8m7 13v-6" stroke="#0f2a33" strokeWidth="3" strokeLinecap="round" fill="none" /></svg>
        <span>Seller leads</span>
      </Link>
      <ul className="navlist">
        {NAV.map(([href, label, icon]) => (
          <li key={href}>
            <Link className="navlink" href={href} aria-current={(href === '/' ? path === '/' : path.startsWith(href)) ? 'page' : undefined}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
              <span>{label}</span>
              {href === '/jobs' && (live?.active ?? 0) > 0 && <span className="pulse" role="img" aria-label="a job is running" title="A job is running" />}
            </Link>
          </li>
        ))}
      </ul>
      <div className="grow" />
      {live && limit > 0 && (
        <div className="spend">
          <span>Spent in the last 24 hours</span>
          <span><b>{usd(live.spent24h)}</b> of {usd(limit)}</span>
          <meter min={0} max={limit} low={limit * 0.6} high={limit * 0.85} optimum={0} value={Math.min(live.spent24h, limit)} aria-label="Daily budget used" />
        </div>
      )}
      <LogoutButton />
    </nav>
  );
}
