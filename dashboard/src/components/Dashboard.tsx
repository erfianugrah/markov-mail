import { useState, useEffect } from 'react';
import ApiKeyInput from './ApiKeyInput';
import MetricsGrid from './MetricsGrid';
import BlockReasonsChart from './BlockReasonsChart';
import TimeSeriesChart from './TimeSeriesChart';
import ModelMetrics from './ModelMetrics';
import ModelComparison from './ModelComparison';
import QueryBuilder from './QueryBuilder';

const AUTO_REFRESH_KEY = 'fraud-detection-auto-refresh';

export default function Dashboard() {
  const [apiKey, setApiKey] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load auto-refresh preference from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(AUTO_REFRESH_KEY);
      if (stored === 'true') {
        setAutoRefresh(true);
      }
    }
  }, []);

  // Auto-refresh every 30 seconds when enabled
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      setRefreshKey((prev) => prev + 1);
    }, 30000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Persist auto-refresh preference
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(AUTO_REFRESH_KEY, String(autoRefresh));
    }
  }, [autoRefresh]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:justify-between">
        <div className="w-full sm:flex-1">
          <ApiKeyInput onApiKeyChange={setApiKey} />
        </div>
        {apiKey && (
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`w-full sm:w-auto px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
              autoRefresh
                ? 'bg-primary text-primary-foreground'
                : 'border border-border hover:bg-accent'
            }`}
          >
            {autoRefresh ? '🔄 Auto-refresh ON' : 'Auto-refresh OFF'}
          </button>
        )}
      </div>

      {apiKey ? (
        <>
          <MetricsGrid apiKey={apiKey} key={`metrics-${refreshKey}`} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <BlockReasonsChart apiKey={apiKey} key={`blocks-${refreshKey}`} />
            <TimeSeriesChart apiKey={apiKey} key={`timeseries-${refreshKey}`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <ModelMetrics apiKey={apiKey} key={`model-${refreshKey}`} />
            <ModelComparison apiKey={apiKey} key={`comparison-${refreshKey}`} />
          </div>

          <QueryBuilder apiKey={apiKey} />
        </>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          Please enter your API key to view analytics data.
        </div>
      )}
    </div>
  );
}
