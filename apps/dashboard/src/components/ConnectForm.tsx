'use client';

import { useState } from 'react';

import { useConnection } from '@/lib/connection';

import { Button, Eyebrow } from './ui';

/** The admin key is typed here, not baked into the build; it lives in this tab's session only. */
export function ConnectForm() {
  const { connect, savedBase } = useConnection();
  const [base, setBase] = useState(savedBase);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await connect(base, key);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full border border-line bg-surface-alt px-3 py-3 text-[15px] outline-none focus:border-lime-dark';

  return (
    <div className="grid min-h-screen place-items-center px-6">
      <form
        className="w-full max-w-md space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center bg-lime font-mono text-xl font-bold text-white">L</span>
          <span className="font-mono text-[13px] font-bold uppercase tracking-[0.4em]">LastMeter</span>
        </div>
        <div>
          <Eyebrow>Dashboard</Eyebrow>
          <h1 className="mt-2 text-[34px] font-bold leading-[1.05] tracking-[-0.025em]">Connect to the server.</h1>
          <p className="mt-2 font-serif text-xl italic text-muted">The cloud cannot see private memory by design.</p>
        </div>
        <label className="block space-y-1.5">
          <Eyebrow>Server address</Eyebrow>
          <input className={input} value={base} onChange={(e) => setBase(e.target.value)} placeholder="http://localhost:8787" autoComplete="off" spellCheck={false} />
        </label>
        <label className="block space-y-1.5">
          <Eyebrow>Admin key</Eyebrow>
          <input className={input} value={key} onChange={(e) => setKey(e.target.value)} type="password" placeholder="ADMIN_KEY from the server's .env" autoComplete="off" />
        </label>
        {error ? <p className="border-l-4 border-bad bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p> : null}
        <Button type="submit" disabled={busy || !key.trim() || !base.trim()}>
          {busy ? 'Connecting…' : 'Connect'}
        </Button>
        <p className="text-xs text-faint">The key stays in this browser tab only and is cleared when you close it. The default key for a local demo is <span className="font-mono">dev-admin-key</span>.</p>
      </form>
    </div>
  );
}
