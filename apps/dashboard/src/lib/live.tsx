'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { eventsUrl } from './api';
import { mergeEvents } from './aggregate';
import { useConnection } from './connection';
import type { ServerEvent } from './types';

export type LiveState = 'connecting' | 'live' | 'offline';

interface LiveValue {
  events: ServerEvent[];
  state: LiveState;
}

const Ctx = createContext<LiveValue>({ events: [], state: 'connecting' });

/** Event types that change what the dashboard's numbers show, so a burst of them triggers a refetch. */
const REFRESH_ON = new Set(['contribution', 'rejected', 'published', 'unpublished', 'device_registered', 'device_deleted', 'outcome', 'conflict_resolved']);

/**
 * One Server-Sent Events connection for the whole dashboard. It preloads recent activity, streams new events
 * (reconnecting automatically), and refetches the numbers shortly after anything meaningful happens.
 */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const { conn, api } = useConnection();
  const qc = useQueryClient();
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [state, setState] = useState<LiveState>('connecting');
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!conn || !api) return;
    let closed = false;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const scheduleRefetch = () => {
      if (refetchTimer.current) return;
      refetchTimer.current = setTimeout(() => {
        refetchTimer.current = null;
        void qc.invalidateQueries({ queryKey: ['admin'] });
      }, 600);
    };

    api
      .activity(300)
      .then((r) => !closed && setEvents((cur) => mergeEvents(cur, r.events)))
      .catch(() => undefined);

    const connect = () => {
      setState('connecting');
      source = new EventSource(eventsUrl(conn));
      source.onopen = () => setState('live');
      source.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data as string) as ServerEvent;
          setEvents((cur) => mergeEvents(cur, [e]));
          if (REFRESH_ON.has(e.type)) scheduleRefetch();
        } catch {
          // ignore a malformed message
        }
      };
      source.onerror = () => {
        source?.close();
        setState('offline');
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    connect();

    return () => {
      closed = true;
      source?.close();
      if (retry) clearTimeout(retry);
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = null;
    };
  }, [conn, api, qc]);

  const value = useMemo(() => ({ events, state }), [events, state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLive = () => useContext(Ctx);
