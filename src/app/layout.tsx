import type { Metadata, Viewport } from 'next';
import './globals.css';

// Every page is rendered per request: the CSP nonce is generated per request, and a prerendered page would ship scripts the browser then blocks.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Seller leads', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, colorScheme: 'light dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
