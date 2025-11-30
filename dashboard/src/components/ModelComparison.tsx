import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { queryAnalytics } from '../lib/api';

interface ModelComparisonProps {
  apiKey: string;
}

interface ComparisonData {
  metric: string;
  baseline: number;
  mxEnhanced: number;
}

export default function ModelComparison({ apiKey }: ModelComparisonProps) {
  const [data, setData] = useState<ComparisonData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchComparison() {
      if (!apiKey) return;

      try {
        setLoading(true);
        setError(null);

        // Query for model performance comparison
        const sql = `
          SELECT
            model_version,
            AVG(CASE WHEN decision = 'block' THEN 0.0 WHEN decision = 'allow' THEN 100.0 ELSE 50.0 END) as accuracy,
            AVG(latency) as avg_latency,
            COUNT(*) as predictions
          FROM validations
          WHERE decision_tree_reason IS NOT NULL
            AND timestamp >= datetime('now', '-7 days')
            AND model_version IS NOT NULL
          GROUP BY model_version
        `;

        const response = await queryAnalytics({ sql }, apiKey);

        if (response.results.length >= 2) {
          const baseline = response.results.find((r: any) => r.model_version.includes('baseline'));
          const enhanced = response.results.find((r: any) => r.model_version.includes('mx-enhanced'));

          if (baseline && enhanced) {
            setData([
              {
                metric: 'Accuracy (%)',
                baseline: baseline.accuracy || 0,
                mxEnhanced: enhanced.accuracy || 0,
              },
              {
                metric: 'Latency (ms)',
                baseline: baseline.avg_latency || 0,
                mxEnhanced: enhanced.avg_latency || 0,
              },
              {
                metric: 'Predictions (k)',
                baseline: (baseline.predictions || 0) / 1000,
                mxEnhanced: (enhanced.predictions || 0) / 1000,
              },
            ]);
          } else {
            setError('Insufficient data for comparison');
          }
        } else {
          setError('No comparison data available');
        }
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
          <CardDescription>Baseline vs MX-Enhanced (last 7 days)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Model Comparison</CardTitle>
          <CardDescription>Baseline vs MX-Enhanced (last 7 days)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80 flex items-center justify-center text-destructive">
            {error}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Comparison</CardTitle>
        <CardDescription>Baseline vs MX-Enhanced model performance (last 7 days)</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
            <Bar dataKey="baseline" fill="#6366f1" name="Baseline Model" radius={[4, 4, 0, 0]} />
            <Bar dataKey="mxEnhanced" fill="#10b981" name="MX-Enhanced Model" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div className="p-3 border rounded-lg">
            <div className="font-medium text-muted-foreground mb-1">Baseline Model</div>
            <div className="text-xs text-muted-foreground">
              Standard decision tree without MX record analysis
            </div>
          </div>
          <div className="p-3 border rounded-lg bg-green-50 dark:bg-green-950/20">
            <div className="font-medium text-green-600 dark:text-green-400 mb-1">MX-Enhanced Model</div>
            <div className="text-xs text-muted-foreground">
              Enhanced with email infrastructure signals (MX, SPF, DMARC)
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
