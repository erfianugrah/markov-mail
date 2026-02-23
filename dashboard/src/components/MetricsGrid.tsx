import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { getMetricsSummary } from '../lib/api';

interface Metrics {
  totalValidations: number;
  blockRate: number;
  warnRate: number;
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
    warnRate: 0,
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

        const warnRate = summary.totalValidations > 0
          ? (summary.warnCount / summary.totalValidations * 100)
          : 0;
        setMetrics({
          totalValidations: summary.totalValidations,
          blockRate: summary.totalValidations > 0
            ? (summary.blockCount / summary.totalValidations * 100)
            : 0,
          warnRate,
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

  // Calculate status colors
  const blockRateStatus = getBlockRateStatus(metrics.blockRate);
  const latencyStatus = getLatencyStatus(metrics.avgLatency);
  const allowRate = 100 - metrics.blockRate - metrics.warnRate;
  const allowRateStatus = getAllowRateStatus(allowRate);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
      <MetricCard
        title="Total Validations"
        value={metrics.totalValidations.toLocaleString()}
      />
      <MetricCard
        title="Allowed Rate"
        value={`${allowRate.toFixed(1)}%`}
        status={allowRateStatus.status}
        statusColor={allowRateStatus.color}
        showTrend={allowRate >= 85 || allowRate < 70}
        trendUp={allowRate >= 85}
      />
      <MetricCard
        title="Block Rate"
        value={`${metrics.blockRate.toFixed(1)}%`}
        status={blockRateStatus.status}
        statusColor={blockRateStatus.color}
        showTrend={metrics.blockRate > 10 || metrics.blockRate < 5}
        trendUp={metrics.blockRate > 10}
      />
      <MetricCard
        title="Avg Latency"
        value={`${Math.round(metrics.avgLatency)}ms`}
        status={latencyStatus.status}
        statusColor={latencyStatus.color}
        showTrend={metrics.avgLatency > 200 || metrics.avgLatency < 100}
        trendUp={metrics.avgLatency > 200}
      />
    </div>
  );
}

// Helper functions for status determination
function getAllowRateStatus(rate: number): { color: string; status: string } {
  if (rate >= 90) return { color: 'text-green-600 dark:text-green-400', status: 'Excellent' };
  if (rate >= 70) return { color: 'text-yellow-600 dark:text-yellow-400', status: 'Good' };
  return { color: 'text-red-600 dark:text-red-400', status: 'Low' };
}

function getBlockRateStatus(rate: number): { color: string; status: string } {
  if (rate < 5) return { color: 'text-green-600 dark:text-green-400', status: 'Low' };
  if (rate < 15) return { color: 'text-yellow-600 dark:text-yellow-400', status: 'Moderate' };
  return { color: 'text-red-600 dark:text-red-400', status: 'High' };
}

function getLatencyStatus(latency: number): { color: string; status: string } {
  if (latency < 100) return { color: 'text-green-600 dark:text-green-400', status: 'Fast' };
  if (latency < 200) return { color: 'text-yellow-600 dark:text-yellow-400', status: 'Normal' };
  return { color: 'text-red-600 dark:text-red-400', status: 'Slow' };
}

interface MetricCardProps {
  title: string;
  value: string;
  status?: string;
  statusColor?: string;
  showTrend?: boolean;
  trendUp?: boolean;
}

function MetricCard({ title, value, status, statusColor, showTrend, trendUp }: MetricCardProps) {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <div className="mt-2">
        <p className="text-3xl font-bold text-foreground">{value}</p>
        {status && statusColor && (
          <div className={`flex items-center gap-1 text-xs font-medium mt-1 ${statusColor}`}>
            {showTrend && (
              trendUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />
            )}
            <span className="truncate">{status}</span>
          </div>
        )}
      </div>
    </div>
  );
}
