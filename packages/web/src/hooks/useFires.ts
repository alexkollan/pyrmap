import { useCallback, useEffect, useState } from 'react';
import type { FiresResponse } from '@pyrmap/shared';
import { fetchFires } from '../api/client.js';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export interface UseFiresResult {
  data: FiresResponse | null;
  loading: boolean;
  error: boolean;
  lastSuccessAt: Date | null;
  refresh: () => void;
}

/** Fetches /api/fires on mount, every 5min, and on demand. Keeps the last good data on error (dev-plan §8.4). */
export function useFires(hours: number): UseFiresResult {
  const [data, setData] = useState<FiresResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<Date | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchFires(hours)
      .then((result) => {
        setData(result);
        setError(false);
        setLastSuccessAt(new Date());
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [hours]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return { data, loading, error, lastSuccessAt, refresh };
}
