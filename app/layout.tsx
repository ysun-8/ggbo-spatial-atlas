import type { Metadata } from 'next';
import { Geist_Mono, Inter } from 'next/font/google';
import './globals.css';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const siteOrigin = process.env.SITE_ORIGIN ?? 'http://localhost:3000';
const socialImage = new URL(`${basePath}/og.png`, siteOrigin);

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
  title: 'gGBO Spatial Atlas',
  description:
    'Interactive prototype for regular Visium and UP-12163 Visium HD with linked spatial expression and annotations.',
  openGraph: {
    title: 'gGBO Spatial Atlas',
    description: 'Interactive regular Visium and Visium HD spatial transcriptomics prototype',
    images: [{ url: socialImage, width: 1200, height: 630, alt: 'gGBO Spatial Atlas' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'gGBO Spatial Atlas',
    description: 'Interactive regular Visium and Visium HD spatial transcriptomics prototype',
    images: [socialImage],
  },
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
