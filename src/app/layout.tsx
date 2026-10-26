import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import './globals.css';

// One family for Arabic page names and the English interface. Downloaded at build time and served from this origin (the CSP allows only 'self').
// If a build ever cannot reach Google Fonts, delete this import and the className below: --font falls back to the system fonts.
const plex = IBM_Plex_Sans_Arabic({ subsets: ['arabic', 'latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-plex' });

// Every page is rendered per request: the CSP nonce is generated per request, and a prerendered page would ship scripts the browser then blocks.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Seller leads', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, colorScheme: 'light dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plex.variable}>
      <body>{children}</body>
    </html>
  );
}
