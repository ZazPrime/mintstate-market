import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

import { SiteNav } from '@/components/site-nav';

import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: {
    default: 'MintState Market — TCG valuation analytics',
    template: '%s · MintState Market',
  },
  description:
    'Fair value analytics, grading arbitrage and population-adjusted investment grades for the Pokémon TCG market.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${mono.variable} min-h-screen font-sans grid-bg`}>
        <SiteNav />
        <main className="mx-auto w-full max-w-[1600px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
