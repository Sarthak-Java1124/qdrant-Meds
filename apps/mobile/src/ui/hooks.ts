import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { message } from './format';

/**
 * Loads async data whenever the screen gains focus (so tabs are fresh after other tabs change data) and on demand.
 * The previous data stays visible while reloading.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const v = await fnRef.current();
      if (alive.current) {
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, deps);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { data, loading, error, reload };
}
