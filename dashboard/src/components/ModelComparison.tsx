import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { queryAnalytics } from '../lib/api';

interface ModelComparisonProps {
  apiKey: string;
}

interface ModelStats {
  model_version: string;
  accuracy: number;
  avg_latency: number;
  predictions: number;
  block_rate: number;
}

interface ComparisonData {
  metric: string;
  [key: string]: string | number;
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export default function ModelComparison({ apiKey }: ModelComparisonProps) {
  const [models, setModels] = useState<ModelStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchComparison() {
      if (!apiKey) return;

      try {
        setLoading(true);
        setError(null);

        // Dynamically compare all model versions seen in the last 7 days
        const sql = `
          SELECT
            model_version,
            AVG(risk_score) as avg_score,
            AVG(latency) as avg_latency,
            COUNT(*) as predictions,
            SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as block_rate,
            SUM(CASE WHEN decision = 'allow' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as allow_rate
          FROM validations
          WHERE timestamp >= datetime('now', '-7 days')
            AND model_version IS NOT NULL
            AND model_version != 'unavailable'
          GROUP BY model_version
          ORDER BY predictions DESC
          LIMIT 5
        `;

        const response = await queryAnalytics({ query: sql }, apiKey);

        if (!response.results || response.results.length === 0) {
          setError('No model data in the last 7 days');
          return;
        }

        setModels(response.results.map((r: any) => ({
          model_version: r.model_version || 'unknown',
          accuracy: r.allow_rate || 0,
          avg_latency: r.avg_latency || 0,
          predictions: r.predictions || 0,
          block_rate: r.block_rate || 0,
        })));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load comparison');
      } finally {
        setLoading(false);
      }
    }

    fetchComparison();
  }, [apiKey]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Model Comparison</CardTitle>
          <CardDescription>Performance across model versions (last 7 days)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80 flex items-center justify-center">
            <div role="status" aria-label="Loading model comparison" className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || models.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Model Comparison</CardTitle>
          <CardDescription>Performance across model versions (last 7 days)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80 flex items-center justify-center text-muted-foreground text-sm">
            {error || 'No model versions to compare yet'}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Build chart data: one entry per metric, one bar per model
  const chartData: ComparisonData[] = [
    { metric: 'Block Rate (%)', ...Object.fromEntries(models.map(m => [m.model_version, Math.round(m.block_rate * 10) / 10])) },
    { metric: 'Avg Latency (ms)', ...Object.fromEntries(models.map(m => [m.model_version, Math.round(m.avg_latency * 10) / 10])) },
    { metric: 'Volume (k)', ...Object.fromEntries(models.map(m => [m.model_version, Math.round(m.predictions / 100) / 10])) },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Comparison</CardTitle>
        <CardDescription>
          {models.length} model version{models.length > 1 ? 's' : ''} active in the last 7 days
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="metric" className="text-xs" />
            <YAxis className="text-xs" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '0.5rem',
              }}
            />
            <Legend />
            {models.map((m, i) => (
              <Bar
                key={m.model_version}
                dataKey={m.model_version}
                fill={COLORS[i % COLORS.length]}
                name={m.model_version}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {models.map((m, i) => (
            <div key={m.model_version} className="p-3 border rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                <span className="font-mono text-xs font-medium text-foreground">{m.model_version}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {m.predictions.toLocaleString()} predictions &middot; {m.block_rate.toFixed(1)}% blocked &middot; {m.avg_latency.toFixed(0)}ms avg
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
