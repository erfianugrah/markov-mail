import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { query } from '@/lib/api'
import { Search, Download } from 'lucide-react'

const VIEWS = {
  recent: {
    name: 'Recent Validations',
    sql: `SELECT blob1 as decision, blob5 as domain, blob7 as pattern_type, double1 as risk_score, timestamp FROM ANALYTICS ORDER BY timestamp DESC LIMIT {limit}`
  },
  'high-risk': {
    name: 'High Risk (>0.6)',
    sql: `SELECT blob1 as decision, blob5 as domain, blob7 as pattern_type, double1 as risk_score, blob2 as block_reason, timestamp FROM ANALYTICS WHERE double1 > 0.6 ORDER BY double1 DESC, timestamp DESC LIMIT {limit}`
  },
  blocked: {
    name: 'Blocked Emails',
    sql: `SELECT blob5 as domain, blob2 as block_reason, blob7 as pattern_type, double1 as risk_score, timestamp FROM ANALYTICS WHERE blob1 = 'block' ORDER BY timestamp DESC LIMIT {limit}`
  },
  patterns: {
    name: 'Pattern Detections',
    sql: `SELECT blob7 as pattern_type, blob8 as pattern_family, blob5 as domain, double8 as pattern_confidence, timestamp FROM ANALYTICS WHERE blob7 != 'none' ORDER BY timestamp DESC LIMIT {limit}`
  },
  disposable: {
    name: 'Disposable Domains',
    sql: `SELECT blob5 as domain, blob1 as decision, double1 as risk_score, timestamp FROM ANALYTICS WHERE blob9 = 'true' ORDER BY timestamp DESC LIMIT {limit}`
  },
  comprehensive: {
    name: 'Comprehensive View (All Columns)',
    sql: `SELECT * FROM ANALYTICS ORDER BY timestamp DESC LIMIT {limit}`
  }
}

export function DataExplorer() {
  const [view, setView] = useState<keyof typeof VIEWS>('recent')
  const [timeMinutes, setTimeMinutes] = useState('60')
  const [limit, setLimit] = useState('100')
  const [result, setResult] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const explore = async () => {
    try {
      setLoading(true)
      setError(null)

      const hours = Math.ceil(parseInt(timeMinutes) / 60)
      const selectedView = VIEWS[view]
      let sql = selectedView.sql.replace('{limit}', limit)

      // Add time filter if not in comprehensive view
      if (view !== 'comprehensive') {
        sql = sql.replace('FROM ANALYTICS', `FROM ANALYTICS WHERE timestamp >= NOW() - INTERVAL '${hours}' HOUR AND`)
        sql = sql.replace('WHERE AND', 'WHERE')
      }

      const response = await query(sql, hours)
      setResult(response.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to explore data')
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
    a.download = `explorer-${view}-${new Date().toISOString()}.csv`
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
    a.download = `explorer-${view}-${new Date().toISOString()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data Explorer</CardTitle>
        <CardDescription>
          Browse analytics data with pre-built views
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3 flex-wrap">
          <Select value={view} onValueChange={(v) => setView(v as keyof typeof VIEWS)}>
            <SelectTrigger className="w-[250px]">
              <SelectValue placeholder="Select view" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(VIEWS).map(([key, { name }]) => (
                <SelectItem key={key} value={key}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={timeMinutes} onValueChange={setTimeMinutes}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Time range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15">Last 15 minutes</SelectItem>
              <SelectItem value="60">Last 1 hour</SelectItem>
              <SelectItem value="360">Last 6 hours</SelectItem>
              <SelectItem value="1440">Last 24 hours</SelectItem>
            </SelectContent>
          </Select>

          <Select value={limit} onValueChange={setLimit}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Limit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">50 rows</SelectItem>
              <SelectItem value="100">100 rows</SelectItem>
              <SelectItem value="500">500 rows</SelectItem>
              <SelectItem value="1000">1000 rows</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={explore} disabled={loading}>
            <Search className="h-4 w-4 mr-2" />
            {loading ? 'Exploring...' : 'Explore'}
          </Button>

          {result.length > 0 && (
            <>
              <Button variant="outline" onClick={exportToCSV}>
                <Download className="h-4 w-4 mr-2" />
                CSV
              </Button>
              <Button variant="outline" onClick={exportToJSON}>
                <Download className="h-4 w-4 mr-2" />
                JSON
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
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    {Object.keys(result[0]).map((key) => (
                      <th key={key} className="px-4 py-2 text-left font-medium whitespace-nowrap">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.map((row, i) => (
                    <tr key={i} className="border-t hover:bg-muted/50">
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="px-4 py-2 whitespace-nowrap">
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

        {result.length === 0 && !loading && !error && (
          <div className="text-center py-12 text-muted-foreground">
            Select options and click Explore to view data
          </div>
        )}
      </CardContent>
    </Card>
  )
}
