import type { Metadata } from 'next';
import { Geist_Mono, Inter } from 'next/font/google';
import './globals.css';
import catalog from '@/atlas/catalog.json';

const siteOrigin = process.env.SITE_ORIGIN ?? 'http://localhost:3000';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
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
        className={`${inter.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
