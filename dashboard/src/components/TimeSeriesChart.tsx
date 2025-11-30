import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { getTimeSeriesData } from '../lib/api';

interface TimeSeriesChartProps {
  apiKey: string;
  hours?: number;
}

interface TimeSeriesData {
  timestamp: string;
  blocks: number;
  warns: number;
  allows: number;
  total: number;
}

export default function TimeSeriesChart({ apiKey, hours = 24 }: TimeSeriesChartProps) {
  const [data, setData] = useState<TimeSeriesData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      if (!apiKey) return;

      try {
        setLoading(true);
        setError(null);
        const timeSeries = await getTimeSeriesData(hours, apiKey);

        // Validate response
        if (!timeSeries || !Array.isArray(timeSeries)) {
          throw new Error('Invalid response format from API');
        }

        // Transform API data to chart format
        const chartData = timeSeries.map((row) => ({
          timestamp: new Date(row.timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
          }),
          blocks: row.blocks,
          warns: row.warns,
          allows: row.count - row.blocks - row.warns,
          total: row.count,
        }));

        setData(chartData);
      } catch (err) {
        console.error('TimeSeriesChart error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');
        setData([]); // Set empty array on error
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [apiKey, hours]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Validation Trends</CardTitle>
          <CardDescription>Hourly validation patterns</CardDescription>
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
          <CardTitle>Validation Trends</CardTitle>
          <CardDescription>Hourly validation patterns</CardDescription>
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
        <CardTitle>Validation Trends</CardTitle>
        <CardDescription>Hourly validation patterns (last {hours}h)</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="timestamp"
              className="text-xs"
              interval="preserveStartEnd"
              minTickGap={50}
            />
            <YAxis className="text-xs" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '0.5rem',
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="blocks"
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              name="Blocked"
            />
            <Line
              type="monotone"
              dataKey="warns"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
              name="Warned"
            />
            <Line
              type="monotone"
              dataKey="allows"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              name="Allowed"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
