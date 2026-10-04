import type { Metadata } from 'next';
import { Public_Sans } from 'next/font/google';
import './globals.css';
import catalog from '@/atlas/catalog.json';

const siteOrigin = process.env.SITE_ORIGIN ?? 'http://localhost:3000';

const publicSans = Public_Sans({
  variable: '--font-public-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
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
        className={`${publicSans.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
