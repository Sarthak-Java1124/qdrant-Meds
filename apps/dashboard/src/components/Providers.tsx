'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { ConnectionProvider, useConnection } from '@/lib/connection';
import { LiveProvider } from '@/lib/live';

import { ConnectForm } from './ConnectForm';
import { Shell } from './Shell';

/** Signed out: the connect screen. Signed in: the live provider and the shell around the page. */
function Gate({ children }: { children: React.ReactNode }) {
  const { phase } = useConnection();
  if (phase === 'loading') return <div className="grid min-h-screen place-items-center font-mono text-xs uppercase tracking-[0.2em] text-muted">Loading…</div>;
  if (phase === 'signedout') return <ConnectForm />;
  return (
    <LiveProvider>
      <Shell>{children}</Shell>
    </LiveProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 5000, retry: 1, refetchOnWindowFocus: true } } }));
  return (
    <QueryClientProvider client={client}>
      <ConnectionProvider>
        <Gate>{children}</Gate>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
