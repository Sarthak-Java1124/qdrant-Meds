import type { Metadata } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';

import { Providers } from '@/components/Providers';

import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });
const instrument = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument' });

export const metadata: Metadata = {
  title: 'LastMeter dashboard',
  description: 'Devices, place memory, conflicts and live activity. Counts only, never a rider\'s private notes.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${instrument.variable}`}>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
