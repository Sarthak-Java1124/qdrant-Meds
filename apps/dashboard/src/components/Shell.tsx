'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useConnection } from '@/lib/connection';
import { useStats } from '@/lib/hooks';
import { useLive } from '@/lib/live';

import { Badge, Eyebrow } from './ui';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/place-memory', label: 'Place Memory' },
  { href: '/conflicts', label: 'Conflicts' },
  { href: '/activity', label: 'Activity' },
  { href: '/devices', label: 'Devices' },
  { href: '/safety', label: 'Safety' },
];

function LiveBadge() {
  const { state } = useLive();
  return state === 'live' ? <Badge tone="good">Live</Badge> : state === 'connecting' ? <Badge tone="warn">Connecting</Badge> : <Badge tone="bad">Offline, retrying</Badge>;
}

/** Sidebar navigation + a top bar with the live connection and the server's confirmation rule. */
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { conn, disconnect } = useConnection();
  const { data: stats } = useStats();

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[232px_1fr]">
      <aside className="flex flex-col border-b border-line bg-surface md:border-b-0 md:border-r">
        <div className="flex items-center gap-3 p-6">
          <span className="flex h-10 w-10 items-center justify-center bg-lime font-mono text-xl font-bold text-white">L</span>
          <span className="font-mono text-[13px] font-bold uppercase tracking-[0.4em]">LastMeter</span>
        </div>
        <nav className="flex flex-row gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible">
          {NAV.map((n) => {
            const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`border-l-[3px] px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.15em] transition-colors ${active ? 'border-lime bg-lime-soft text-ink' : 'border-transparent text-muted hover:bg-cream'}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden space-y-2 border-t border-line p-5 md:block">
          <Eyebrow>Server</Eyebrow>
          <div className="break-all font-mono text-[11px] text-muted">{conn?.base}</div>
          <button onClick={disconnect} className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-lime-dark hover:underline">
            Disconnect
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-cream px-8 py-3">
          <div className="flex items-center gap-3">
            <LiveBadge />
            {stats ? (
              <span className="font-mono text-[11px] text-muted">
                {`daily cap ${stats.config.dailyCap}${stats.config.minAgeMin ? ` · min device age ${stats.config.minAgeMin}m` : ''}`}
              </span>
            ) : null}
          </div>
          <span className="hidden text-xs text-muted md:block">The cloud cannot see private memory by design. This dashboard shows counts and published knowledge only.</span>
        </div>
        <main className="mx-auto max-w-6xl px-8 py-10">{children}</main>
      </div>
    </div>
  );
}
