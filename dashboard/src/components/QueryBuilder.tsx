import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { query } from '@/lib/api'
import { Play, FileText, Download } from 'lucide-react'

const DEFAULT_QUERY = `SELECT
  blob1 as decision,
  blob7 as pattern_type,
  blob5 as domain,
  double1 as risk_score,
  double2 as entropy_score,
  double3 as bot_score,
  timestamp
FROM ANALYTICS
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
  AND double1 > 0.5
ORDER BY timestamp DESC
LIMIT 100`

export function QueryBuilder() {
  const [sql, setSql] = useState(DEFAULT_QUERY)
  const [result, setResult] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hours, setHours] = useState(24)

  const runQuery = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await query(sql, hours)
      setResult(response.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run query')
    } finally {
      setLoading(false)
    }
  }

  const exportToCSV = () => {
    if (!result.length) return

    const headers = Object.keys(result[0])
    const csv = [
      headers.join(','),
      ...result.map(row =>
        headers.map(h => {
          const val = row[h]
          return typeof val === 'string' && val.includes(',') ? `"${val}"` : val
        }).join(',')
      )
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `query-result-${new Date().toISOString()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportToJSON = () => {
    if (!result.length) return

    const json = JSON.stringify(result, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `query-result-${new Date().toISOString()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom SQL Query</CardTitle>
        <CardDescription>
          Write SQL queries against the ANALYTICS table. View{' '}
          <a
            href="https://developers.cloudflare.com/analytics/analytics-engine/sql-api/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            Analytics Engine SQL documentation
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          className="w-full h-64 p-3 font-mono text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          spellCheck={false}
        />

        <div className="flex gap-2 flex-wrap">
          <Button onClick={runQuery} disabled={loading}>
            <Play className="h-4 w-4 mr-2" />
            {loading ? 'Running...' : 'Run Query'}
          </Button>
          <Button variant="outline" onClick={() => setSql(DEFAULT_QUERY)}>
            <FileText className="h-4 w-4 mr-2" />
            Reset to Example
          </Button>
          {result.length > 0 && (
            <>
              <Button variant="outline" onClick={exportToCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
              <Button variant="outline" onClick={exportToJSON}>
                <Download className="h-4 w-4 mr-2" />
                Export JSON
              </Button>
            </>
          )}
        </div>

        {error && (
          <div className="p-4 border border-destructive rounded-md bg-destructive/10">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {result.length > 0 && (
          <div className="border rounded-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    {Object.keys(result[0]).map((key) => (
                      <th key={key} className="px-4 py-2 text-left font-medium">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.map((row, i) => (
                    <tr key={i} className="border-t">
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="px-4 py-2">
                          {String(val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 bg-muted text-sm text-muted-foreground">
              {result.length} row{result.length !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
