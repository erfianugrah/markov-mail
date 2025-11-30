import { useState, useEffect, useCallback } from 'react';

interface UseAnalyticsOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function useAnalytics<T = any>(
  apiKey: string,
  query: string,
  options: UseAnalyticsOptions = {}
) {
  const { autoRefresh = false, refreshInterval = 30 } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!apiKey || !query) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/admin/analytics?query=${encodeURIComponent(query)}`,
        {
          headers: {
            'X-API-KEY': apiKey,
          },
        }
      );

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid API key');
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();
      setData(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch analytics';
      setError(message);
      console.error('Analytics fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [apiKey, query]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh || !apiKey) return;

    const interval = setInterval(fetchData, refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchData, apiKey]);

  return {
    data,
    loading,
    error,
    refresh: fetchData,
  };
}
