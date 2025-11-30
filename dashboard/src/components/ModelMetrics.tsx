import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { queryAnalytics } from '../lib/api';

interface ModelMetricsProps {
  apiKey: string;
}

interface ModelStats {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  truePositives: number;
  trueNegatives: number;
  falsePositives: number;
  falseNegatives: number;
}

export default function ModelMetrics({ apiKey }: ModelMetricsProps) {
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchModelMetrics() {
      if (!apiKey) return;

      try {
        setLoading(true);
        setError(null);

        // Query for decision tree performance metrics
        const sql = `
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) as tp,
            SUM(CASE WHEN decision = 'allow' THEN 1 ELSE 0 END) as tn,
            SUM(CASE WHEN decision = 'warn' THEN 1 ELSE 0 END) as fp,
            0 as fn
          FROM VALIDATIONS
          WHERE decision_tree_reason IS NOT NULL
            AND timestamp >= datetime('now', '-7 days')
        `;

        const response = await queryAnalytics({ sql }, apiKey);
        const row = response.results[0];

        const tp = row.tp || 0;
        const tn = row.tn || 0;
        const fp = row.fp || 0;
        const fn = row.fn || 0;
        const total = row.total || 1;

        const accuracy = ((tp + tn) / total) * 100;
        const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 0;
        const recall = tp + fn > 0 ? (tp / (tp + fn)) * 100 : 0;
        const f1Score = precision + recall > 0 ? (2 * (precision * recall) / (precision + recall)) : 0;

        setStats({
          accuracy,
          precision,
          recall,
          f1Score,
          truePositives: tp,
          trueNegatives: tn,
          falsePositives: fp,
          falseNegatives: fn,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load model metrics');
      } finally {
        setLoading(false);
      }
    }

    fetchModelMetrics();
  }, [apiKey]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Model Performance</CardTitle>
          <CardDescription>Decision tree metrics (last 7 days)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center">
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
          <CardTitle>Model Performance</CardTitle>
          <CardDescription>Decision tree metrics (last 7 days)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-destructive">
            {error}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!stats) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Model Performance</CardTitle>
          <CardDescription>Decision tree metrics (last 7 days)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            No data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Performance</CardTitle>
        <CardDescription>Decision tree metrics (last 7 days)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MetricBox
            label="Accuracy"
            value={stats.accuracy.toFixed(2)}
            unit="%"
            color="text-blue-600 dark:text-blue-400"
          />
          <MetricBox
            label="Precision"
            value={stats.precision.toFixed(2)}
            unit="%"
            color="text-purple-600 dark:text-purple-400"
          />
          <MetricBox
            label="Recall"
            value={stats.recall.toFixed(2)}
            unit="%"
            color="text-green-600 dark:text-green-400"
          />
          <MetricBox
            label="F1 Score"
            value={stats.f1Score.toFixed(2)}
            unit="%"
            color="text-orange-600 dark:text-orange-400"
          />
        </div>

        <div className="border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Confusion Matrix</h3>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="border rounded p-3 bg-green-50 dark:bg-green-950">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {stats.truePositives.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground mt-1">True Positives</div>
            </div>
            <div className="border rounded p-3 bg-red-50 dark:bg-red-950">
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                {stats.falsePositives.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground mt-1">False Positives</div>
            </div>
            <div className="border rounded p-3 bg-red-50 dark:bg-red-950">
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                {stats.falseNegatives.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground mt-1">False Negatives</div>
            </div>
            <div className="border rounded p-3 bg-green-50 dark:bg-green-950">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {stats.trueNegatives.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground mt-1">True Negatives</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface MetricBoxProps {
  label: string;
  value: string;
  unit: string;
  color: string;
}

function MetricBox({ label, value, unit, color }: MetricBoxProps) {
  return (
    <div className="text-center">
      <div className="text-sm font-medium text-muted-foreground mb-1">{label}</div>
      <div className={`text-3xl font-bold ${color}`}>
        {value}
        <span className="text-lg">{unit}</span>
      </div>
    </div>
  );
}
