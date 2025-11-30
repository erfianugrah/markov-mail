import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { queryAnalytics } from '../lib/api';
import ExportButton from './ExportButton';

interface QueryBuilderProps {
  apiKey: string;
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTime: number;
}

const EXAMPLE_QUERIES = [
  {
    name: 'Last 100 Validations',
    sql: 'SELECT * FROM validations ORDER BY timestamp DESC LIMIT 100',
  },
  {
    name: 'Block Rate by Hour',
    sql: `SELECT
  strftime('%Y-%m-%d %H:00', timestamp) as hour,
  COUNT(*) as total,
  SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) as blocks,
  ROUND(SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as block_rate
FROM validations
WHERE timestamp >= datetime('now', '-24 hours')
GROUP BY hour
ORDER BY hour DESC`,
  },
  {
    name: 'Top Blocked Emails',
    sql: `SELECT
  email_local_part || '@' || domain as email,
  COUNT(*) as block_count,
  GROUP_CONCAT(DISTINCT block_reason) as reasons
FROM validations
WHERE decision = 'block'
  AND timestamp >= datetime('now', '-7 days')
GROUP BY email
ORDER BY block_count DESC
LIMIT 20`,
  },
  {
    name: 'Decision Tree Performance',
    sql: `SELECT
  decision,
  COUNT(*) as count,
  ROUND(AVG(latency), 2) as avg_latency,
  ROUND(AVG(risk_score), 3) as avg_risk_score
FROM validations
WHERE decision_tree_reason IS NOT NULL
  AND timestamp >= datetime('now', '-24 hours')
GROUP BY decision`,
  },
];

export default function QueryBuilder({ apiKey }: QueryBuilderProps) {
  const [query, setQuery] = useState(EXAMPLE_QUERIES[0].sql);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executeQuery = async () => {
    if (!apiKey || !query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const startTime = performance.now();
      const response = await queryAnalytics({ sql: query }, apiKey);
      const executionTime = Math.round(performance.now() - startTime);

      setResult({
        columns: response.meta.columns,
        rows: response.results,
        rowCount: response.meta.rowCount,
        executionTime,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query execution failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>SQL Query Builder</CardTitle>
        <CardDescription>Execute custom queries against the analytics database</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Example Queries */}
        <div>
          <label className="text-sm font-medium mb-2 block">Quick Examples</label>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUERIES.map((example) => (
              <button
                key={example.name}
                onClick={() => setQuery(example.sql)}
                className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
              >
                {example.name}
              </button>
            ))}
          </div>
        </div>

        {/* SQL Editor */}
        <div>
          <label className="text-sm font-medium mb-2 block">SQL Query</label>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-32 p-3 text-sm font-mono rounded-md border border-border bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="SELECT * FROM validations LIMIT 10"
          />
        </div>

        {/* Execute Button */}
        <button
          onClick={executeQuery}
          disabled={loading || !query.trim()}
          className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Executing...' : 'Execute Query'}
        </button>

        {/* Error Display */}
        {error && (
          <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Results Display */}
        {result && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="text-muted-foreground">
                <span>{result.rowCount} rows returned</span>
                <span className="mx-2">•</span>
                <span>Executed in {result.executionTime}ms</span>
              </div>
              <div className="flex gap-2">
                <ExportButton data={result.rows} filename="query-results" format="csv" />
                <ExportButton data={result.rows} filename="query-results" format="json" />
              </div>
            </div>

            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {result.columns.map((col) => (
                      <th key={col} className="px-4 py-2 text-left font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, idx) => (
                    <tr key={idx} className="border-b last:border-0 hover:bg-muted/50">
                      {result.columns.map((col) => (
                        <td key={col} className="px-4 py-2">
                          {String(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
