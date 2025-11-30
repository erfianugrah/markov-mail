import { useState, useEffect } from 'react';
import { getMetricsSummary } from '../lib/api';

interface Metrics {
  totalValidations: number;
  blockRate: number;
  avgLatency: number;
  errorRate: number;
}

interface MetricsGridProps {
  apiKey: string;
  hours?: number;
}

export default function MetricsGrid({ apiKey, hours = 24 }: MetricsGridProps) {
  const [metrics, setMetrics] = useState<Metrics>({
    totalValidations: 0,
    blockRate: 0,
    avgLatency: 0,
    errorRate: 0,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMetrics() {
      if (!apiKey) return;

      try {
        setLoading(true);
        setError(null);
        const summary = await getMetricsSummary(hours, apiKey);

        setMetrics({
          totalValidations: summary.totalValidations,
          blockRate: summary.totalValidations > 0
            ? (summary.blockCount / summary.totalValidations * 100)
            : 0,
          avgLatency: summary.avgLatency,
          errorRate: summary.errorRate,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load metrics');
      } finally {
        setLoading(false);
      }
    }

    fetchMetrics();
  }, [apiKey, hours]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-6 animate-pulse">
            <div className="h-4 bg-muted rounded w-24 mb-4"></div>
            <div className="h-8 bg-muted rounded w-16"></div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
        <p className="text-sm font-medium text-destructive">Failed to load metrics</p>
        <p className="text-sm text-muted-foreground mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
      <MetricCard
        title="Total Validations"
        value={metrics.totalValidations.toLocaleString()}
        trend="+12%"
        trendUp
      />
      <MetricCard
        title="Block Rate"
        value={`${metrics.blockRate}%`}
        trend="-2%"
        trendUp={false}
      />
      <MetricCard
        title="Avg Latency"
        value={`${metrics.avgLatency}ms`}
        trend="-5ms"
        trendUp={false}
      />
      <MetricCard
        title="Error Rate"
        value={`${metrics.errorRate}%`}
        trend="0%"
      />
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string;
  trend?: string;
  trendUp?: boolean;
}

function MetricCard({ title, value, trend, trendUp }: MetricCardProps) {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-3xl font-bold text-foreground">{value}</p>
        {trend && (
          <span
            className={`text-sm font-medium ${
              trendUp === undefined
                ? 'text-muted-foreground'
                : trendUp
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {trend}
          </span>
        )}
      </div>
    </div>
  );
}
