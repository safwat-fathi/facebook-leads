'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [['/', 'Leads'], ['/jobs', 'Jobs'], ['/costs', 'Costs']] as const;
export function NavLinks() {
  const path = usePathname();
  return (
    <>
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={(href === '/' ? path === '/' : path.startsWith(href)) ? 'page' : undefined}>{label}</Link>
      ))}
    </>
  );
}
