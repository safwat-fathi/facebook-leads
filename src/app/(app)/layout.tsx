import { Sidebar } from '@/components/Sidebar';

// No auth logic here on purpose: layouts do not re-run on client navigation. Every page calls requireAuth() itself.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <Sidebar />
      <div className="content">{children}</div>
    </div>
  );
}
