import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';
import catalog from '@/atlas/catalog.json';

const siteOrigin = process.env.SITE_ORIGIN ?? 'http://localhost:3000';

// Plex keeps 1/l/I and 0/O distinct in line IDs, barcodes, and gene symbols.
const plexSans = IBM_Plex_Sans({
  variable: '--font-plex-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
});

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: catalog.site.title,
  description: catalog.site.description,
  openGraph: { title: catalog.site.title, description: catalog.site.description },
  twitter: { card: 'summary', title: catalog.site.title, description: catalog.site.description },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${plexSans.variable} ${plexMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
