import { LogoutButton } from '@/components/LogoutButton';
import { NavLinks } from '@/components/NavLinks';

// No auth logic here on purpose: layouts do not re-run on client navigation. Every page calls requireAuth() itself.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <nav className="topnav" aria-label="Main">
        <strong>Egyptian seller leads</strong>
        <NavLinks />
        <span className="spacer" />
        <LogoutButton />
      </nav>
      {children}
    </>
  );
}
