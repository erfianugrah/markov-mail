import { useState, useEffect, lazy, Suspense } from 'react';
import { Button } from './ui/button';
import ApiKeyDialog from './ApiKeyDialog';
import { ErrorBoundary } from './ErrorBoundary';
import { CardSkeleton, ChartSkeleton } from './CardSkeleton';

// Lazy load heavy components for better performance
const MetricsGrid = lazy(() => import('./MetricsGrid'));
const BlockReasonsChart = lazy(() => import('./BlockReasonsChart'));
const TimeSeriesChart = lazy(() => import('./TimeSeriesChart'));
const ModelMetrics = lazy(() => import('./ModelMetrics'));
const ModelComparison = lazy(() => import('./ModelComparison'));
const QueryBuilder = lazy(() => import('./QueryBuilder'));

const AUTO_REFRESH_KEY = 'fraud-detection-auto-refresh';

function MetricsGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

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
    if (!autoRefresh || !apiKey) return;

    const interval = setInterval(() => {
      setRefreshKey((prev) => prev + 1);
    }, 30000);

    return () => clearInterval(interval);
  }, [autoRefresh, apiKey]);

  // Persist auto-refresh preference
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(AUTO_REFRESH_KEY, String(autoRefresh));
    }
  }, [autoRefresh]);

  return (
    <>
      <ApiKeyDialog onApiKeyChange={setApiKey} />

      {apiKey ? (
        <div className="space-y-4 sm:space-y-6">
          <div className="flex justify-end">
            <Button
              variant={autoRefresh ? 'default' : 'outline'}
              onClick={() => setAutoRefresh(!autoRefresh)}
              className="whitespace-nowrap"
            >
              {autoRefresh ? '🔄 Auto-refresh ON' : 'Auto-refresh OFF'}
            </Button>
          </div>

          <ErrorBoundary>
            <Suspense fallback={<MetricsGridSkeleton />}>
              <MetricsGrid apiKey={apiKey} key={`metrics-${refreshKey}`} />
            </Suspense>
          </ErrorBoundary>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <ErrorBoundary>
              <Suspense fallback={<ChartSkeleton />}>
                <BlockReasonsChart apiKey={apiKey} key={`blocks-${refreshKey}`} />
              </Suspense>
            </ErrorBoundary>

            <ErrorBoundary>
              <Suspense fallback={<ChartSkeleton />}>
                <TimeSeriesChart apiKey={apiKey} key={`timeseries-${refreshKey}`} />
              </Suspense>
            </ErrorBoundary>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <ErrorBoundary>
              <Suspense fallback={<ChartSkeleton />}>
                <ModelMetrics apiKey={apiKey} key={`model-${refreshKey}`} />
              </Suspense>
            </ErrorBoundary>

            <ErrorBoundary>
              <Suspense fallback={<ChartSkeleton />}>
                <ModelComparison apiKey={apiKey} key={`comparison-${refreshKey}`} />
              </Suspense>
            </ErrorBoundary>
          </div>

          <ErrorBoundary>
            <Suspense fallback={<CardSkeleton />}>
              <QueryBuilder apiKey={apiKey} />
            </Suspense>
          </ErrorBoundary>
        </div>
      ) : (
        <div className="flex items-center justify-center min-h-[400px]">
          <p className="text-muted-foreground">Please enter your API key to view analytics data.</p>
        </div>
      )}
    </>
  );
}
