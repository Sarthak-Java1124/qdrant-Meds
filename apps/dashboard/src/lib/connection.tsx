'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { DEFAULT_BASE, makeApi, normalizeBase, type Api, type Connection } from './api';

type Phase = 'loading' | 'signedout' | 'ready';

interface ConnectionState {
  phase: Phase;
  conn: Connection | null;
  api: Api | null;
  /** Verifies the address and key against the server, then remembers them. Throws with a readable message. */
  connect: (base: string, key: string) => Promise<void>;
  disconnect: () => void;
  savedBase: string;
}

const Ctx = createContext<ConnectionState | null>(null);

const BASE_KEY = 'hive.dashboard.base';
const ADMIN_KEY = 'hive.dashboard.adminKey';

/**
 * Holds the server address and admin key. The address is remembered across sessions; the key is kept in
 * sessionStorage only, so closing the tab signs you out.
 */
export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [conn, setConn] = useState<Connection | null>(null);
  const [savedBase, setSavedBase] = useState(DEFAULT_BASE);

  const verify = useCallback(async (c: Connection) => {
    await makeApi(c).stats();
    return c;
  }, []);

  useEffect(() => {
    const base = localStorage.getItem(BASE_KEY) ?? DEFAULT_BASE;
    const key = sessionStorage.getItem(ADMIN_KEY);
    setSavedBase(base);
    if (!key) return setPhase('signedout');
    verify({ base, key })
      .then((c) => {
        setConn(c);
        setPhase('ready');
      })
      .catch(() => setPhase('signedout'));
  }, [verify]);

  const connect = useCallback(
    async (rawBase: string, key: string) => {
      const c = await verify({ base: normalizeBase(rawBase), key: key.trim() });
      localStorage.setItem(BASE_KEY, c.base);
      sessionStorage.setItem(ADMIN_KEY, c.key);
      setSavedBase(c.base);
      setConn(c);
      setPhase('ready');
    },
    [verify],
  );

  const disconnect = useCallback(() => {
    sessionStorage.removeItem(ADMIN_KEY);
    setConn(null);
    setPhase('signedout');
  }, []);

  const value = useMemo<ConnectionState>(() => ({ phase, conn, api: conn ? makeApi(conn) : null, connect, disconnect, savedBase }), [phase, conn, connect, disconnect, savedBase]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConnection(): ConnectionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useConnection must be used inside ConnectionProvider');
  return v;
}
