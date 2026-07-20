import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * Fetches /api/fires on mount, on demand, and whenever the server pushes an update over
 * /api/events (SSE) — the instant something new is ingested, not on the next poll tick. The
 * 5-minute interval stays as a fallback in case the SSE connection is ever unavailable (e.g. a
 * proxy that blocks streaming); EventSource itself also reconnects on its own if it drops. Keeps
 * the last good data on error either way (dev-plan §8.4).
 */
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

  // The SSE connection lives for the component's whole lifetime, independent of `hours` changes;
  // the ref lets its handler always call the current refresh() without reopening the connection.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onmessage = () => refreshRef.current();
    return () => source.close();
  }, []);

  return { data, loading, error, lastSuccessAt, refresh };
}
