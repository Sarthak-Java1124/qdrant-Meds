'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useConnection } from './connection';

/** A clock that ticks, so "5m ago" and the sparkline stay current. */
export function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(h);
  }, [intervalMs]);
  return now;
}

/** Every admin query shares the ['admin'] prefix, so live events can refetch them all at once. */
const POLL_MS = 15_000;

export function useStats() {
  const { api, conn } = useConnection();
  return useQuery({ queryKey: ['admin', 'stats', conn?.base], queryFn: () => api!.stats(), enabled: !!api, refetchInterval: POLL_MS });
}

export function useOverview() {
  const { api, conn } = useConnection();
  return useQuery({ queryKey: ['admin', 'overview', conn?.base], queryFn: () => api!.overview(), enabled: !!api, refetchInterval: POLL_MS });
}

export function usePlaceMemory() {
  const { api, conn } = useConnection();
  return useQuery({ queryKey: ['admin', 'place-memory', conn?.base], queryFn: () => api!.placeMemory(), enabled: !!api, refetchInterval: POLL_MS });
}

export function usePlaceMemoryDetail(placeId: string | null) {
  const { api, conn } = useConnection();
  return useQuery({
    queryKey: ['admin', 'place-memory', conn?.base, placeId],
    queryFn: () => api!.placeMemoryDetail(placeId!),
    enabled: !!api && !!placeId,
  });
}

export function useConflicts() {
  const { api, conn } = useConnection();
  return useQuery({ queryKey: ['admin', 'conflicts', conn?.base], queryFn: () => api!.conflicts(), enabled: !!api, refetchInterval: POLL_MS });
}

export function useDevices() {
  const { api, conn } = useConnection();
  return useQuery({ queryKey: ['admin', 'devices', conn?.base], queryFn: () => api!.devices(), enabled: !!api, refetchInterval: POLL_MS });
}

export function useSafety() {
  const { api, conn } = useConnection();
  return useQuery({ queryKey: ['admin', 'safety', conn?.base], queryFn: () => api!.safety(), enabled: !!api, refetchInterval: POLL_MS });
}
