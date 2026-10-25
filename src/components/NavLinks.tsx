'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS = [['/', 'Leads'], ['/jobs', 'Jobs'], ['/costs', 'Costs']] as const;
export function NavLinks() {
  const path = usePathname();
  const [active, setActive] = useState(0);
  // The layout does not re-render on client navigation, so the nav asks for itself: on every route change (starting a job navigates),
  // then every 5 s while something is running. Nothing is polled while idle.
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let n = 0;
      try { const r = await fetch('/api/jobs/active'); if (r.ok) n = ((await r.json()) as { active: number }).active; } catch { /* try again on the next navigation */ }
      if (stop) return;
      setActive(n);
      if (n > 0) timer = setTimeout(tick, 5000);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [path]);
  return (
    <>
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={(href === '/' ? path === '/' : path.startsWith(href)) ? 'page' : undefined}>
          {label}{href === '/jobs' && active > 0 && <span className="pulse" role="img" aria-label="a job is running" title="A job is running" />}
        </Link>
      ))}
    </>
  );
}
