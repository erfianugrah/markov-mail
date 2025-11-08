import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { query } from '@/lib/api'
import { Search, Download, ArrowUpDown, ArrowUp, ArrowDown, RefreshCw } from 'lucide-react'

const VIEWS = {
  recent: {
    name: 'Recent Validations',
    sql: `SELECT
      timestamp,
      email_local_part,
      domain,
      tld,
      decision,
      risk_score,
      pattern_type,
      pattern_family,
      is_disposable,
      is_free_provider,
      markov_detected,
      markov_confidence,
      country,
      latency
    FROM validations ORDER BY timestamp DESC LIMIT {limit}`
  },
  'high-risk': {
    name: 'High Risk (>0.6)',
    sql: `SELECT
      timestamp,
      email_local_part,
      domain,
      decision,
      risk_score,
      block_reason,
      pattern_type,
      pattern_family,
      is_disposable,
      markov_detected,
      markov_confidence,
      bot_score,
      country
    FROM validations WHERE risk_score > 0.6 ORDER BY risk_score DESC, timestamp DESC LIMIT {limit}`
  },
  blocked: {
    name: 'Blocked Emails',
    sql: `SELECT
      timestamp,
      email_local_part,
      domain,
      risk_score,
      block_reason,
      pattern_type,
      pattern_family,
      is_disposable,
      markov_detected,
      markov_confidence,
      bot_score,
      country,
      client_ip
    FROM validations WHERE decision = 'block' ORDER BY timestamp DESC LIMIT {limit}`
  },
  patterns: {
    name: 'Pattern Detections',
    sql: `SELECT
      timestamp,
      email_local_part,
      domain,
      decision,
      risk_score,
      pattern_type,
      pattern_family,
      pattern_confidence,
      is_disposable,
      markov_detected
    FROM validations WHERE pattern_type IS NOT NULL AND pattern_type != 'none' ORDER BY timestamp DESC LIMIT {limit}`
  },
  disposable: {
    name: 'Disposable Domains',
    sql: `SELECT
      timestamp,
      email_local_part,
      domain,
      decision,
      risk_score,
      pattern_type,
      is_free_provider,
      domain_reputation_score,
      country,
      client_ip
    FROM validations WHERE is_disposable = 1 ORDER BY timestamp DESC LIMIT {limit}`
  },
  markov: {
    name: 'Markov Detections',
    sql: `SELECT
      timestamp,
      email_local_part,
      domain,
      decision,
      risk_score,
      markov_detected,
      markov_confidence,
      markov_cross_entropy_legit,
      markov_cross_entropy_fraud,
      pattern_type,
      country
    FROM validations WHERE markov_detected = 1 ORDER BY timestamp DESC LIMIT {limit}`
  },
  comprehensive: {
    name: 'Comprehensive View (All Columns)',
    sql: `SELECT
      timestamp,
      decision,
      block_reason,
      country,
      CASE WHEN risk_score < 0.2 THEN 'very_low' WHEN risk_score < 0.4 THEN 'low' WHEN risk_score < 0.6 THEN 'medium' WHEN risk_score < 0.8 THEN 'high' ELSE 'very_high' END as risk_bucket,
      domain,
      tld,
      pattern_type,
      pattern_family,
      is_disposable,
      is_free_provider,
      has_plus_addressing,
      email_local_part,
      client_ip,
      user_agent,
      variant,
      exclude_from_training,
      markov_detected,
      experiment_id,
      risk_score,
      entropy_score,
      bot_score,
      asn,
      latency,
      tld_risk_score,
      domain_reputation_score,
      pattern_confidence,
      markov_confidence,
      markov_cross_entropy_legit,
      markov_cross_entropy_fraud,
      ip_reputation_score,
      bucket,
      fingerprint_hash
    FROM validations ORDER BY timestamp DESC LIMIT {limit}`
  }
}

export function DataExplorer() {
  const [view, setView] = useState<keyof typeof VIEWS>('recent')
  const [timeMinutes, setTimeMinutes] = useState('60')
  const [limit, setLimit] = useState('100')
  const [result, setResult] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState('30')
  const intervalRef = useRef<number | null>(null)

  const explore = async () => {
    try {
      setLoading(true)
      setError(null)

      const hours = Math.ceil(parseInt(timeMinutes) / 60)
      const selectedView = VIEWS[view]
      let sql = selectedView.sql.replace('{limit}', limit)

      // Add time filter if not in comprehensive view
      if (view !== 'comprehensive') {
        // Check if query already has WHERE clause
        if (sql.includes('WHERE')) {
          sql = sql.replace('WHERE', `WHERE timestamp >= datetime('now', '-${hours} hours') AND`)
        } else {
          sql = sql.replace('FROM validations', `FROM validations WHERE timestamp >= datetime('now', '-${hours} hours')`)
        }
      }

      const response = await query(sql, hours)
      setResult(response.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to explore data')
    } finally {
      setLoading(false)
    }
  }

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefresh && result.length > 0) {
      const seconds = parseInt(refreshInterval)
      intervalRef.current = window.setInterval(() => {
        explore()
      }, seconds * 1000)
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [autoRefresh, refreshInterval, result.length])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

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

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('desc')
    }
  }

  const sortedResult = [...result].sort((a, b) => {
    if (!sortColumn) return 0

    const aVal = a[sortColumn]
    const bVal = b[sortColumn]

    // Handle null/undefined
    if (aVal === null || aVal === undefined) return 1
    if (bVal === null || bVal === undefined) return -1

    // Numeric comparison for numbers
    const aNum = parseFloat(aVal)
    const bNum = parseFloat(bVal)
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return sortDirection === 'asc' ? aNum - bNum : bNum - aNum
    }

    // String comparison
    const aStr = String(aVal).toLowerCase()
    const bStr = String(bVal).toLowerCase()
    if (sortDirection === 'asc') {
      return aStr < bStr ? -1 : aStr > bStr ? 1 : 0
    } else {
      return bStr < aStr ? -1 : bStr > aStr ? 1 : 0
    }
  })

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
              <Button variant="outline" onClick={explore} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
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

        {result.length > 0 && (
          <div className="flex gap-3 items-center p-3 bg-muted/30 rounded-md border">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-4 h-4 cursor-pointer"
              />
              <span className="text-sm font-medium">Auto-refresh</span>
            </label>
            {autoRefresh && (
              <Select value={refreshInterval} onValueChange={setRefreshInterval}>
                <SelectTrigger className="w-[140px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">Every 10 sec</SelectItem>
                  <SelectItem value="30">Every 30 sec</SelectItem>
                  <SelectItem value="60">Every 1 min</SelectItem>
                  <SelectItem value="300">Every 5 min</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {error && (
          <div className="p-4 border border-destructive rounded-md bg-destructive/10">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {result.length > 0 && (
          <div className="border rounded-md overflow-hidden">
            <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
              <table className="w-full text-sm min-w-max">
                <thead className="sticky top-0 z-10">
                  <tr>
                    {Object.keys(result[0]).map((key) => (
                      <th
                        key={key}
                        className="px-4 py-2 text-left font-medium whitespace-nowrap cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-800 select-none bg-gray-100 dark:bg-gray-900 border-b border-border opacity-100"
                        onClick={() => handleSort(key)}
                      >
                        <div className="flex items-center gap-1">
                          {key}
                          {sortColumn === key ? (
                            sortDirection === 'asc' ?
                              <ArrowUp className="h-3 w-3" /> :
                              <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-30" />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedResult.map((row, i) => (
                    <tr key={i} className={`border-t hover:bg-muted/50 ${i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}`}>
                      {Object.entries(row).map(([key, val], j) => {
                        // Color coding for risk_score
                        if (key === 'risk_score') {
                          const score = parseFloat(String(val))
                          let colorClass = ''
                          if (score >= 0.7) colorClass = 'text-red-600 dark:text-red-400 font-semibold'
                          else if (score >= 0.4) colorClass = 'text-orange-600 dark:text-orange-400 font-semibold'
                          else if (score >= 0.2) colorClass = 'text-yellow-600 dark:text-yellow-400 font-medium'
                          else colorClass = 'text-green-600 dark:text-green-400'

                          return (
                            <td key={j} className={`px-4 py-2 whitespace-nowrap ${colorClass}`}>
                              {String(val)}
                            </td>
                          )
                        }

                        // Color coding for decision
                        if (key === 'decision') {
                          let bgClass = ''
                          let textClass = ''
                          if (val === 'block') {
                            bgClass = 'bg-red-100 dark:bg-red-950'
                            textClass = 'text-red-700 dark:text-red-300 font-semibold'
                          } else if (val === 'warn') {
                            bgClass = 'bg-yellow-100 dark:bg-yellow-950'
                            textClass = 'text-yellow-700 dark:text-yellow-300 font-medium'
                          } else if (val === 'allow') {
                            bgClass = 'bg-green-100 dark:bg-green-950'
                            textClass = 'text-green-700 dark:text-green-300'
                          }

                          return (
                            <td key={j} className="px-4 py-2 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded text-xs ${bgClass} ${textClass}`}>
                                {String(val)}
                              </span>
                            </td>
                          )
                        }

                        // Color coding for confidence scores
                        if (key === 'markov_confidence' || key === 'pattern_confidence' || key === 'bot_score') {
                          const score = parseFloat(String(val))
                          if (!isNaN(score)) {
                            let colorClass = ''
                            if (score >= 0.8) colorClass = 'text-red-600 dark:text-red-400 font-semibold'
                            else if (score >= 0.6) colorClass = 'text-orange-600 dark:text-orange-400 font-medium'
                            else if (score >= 0.4) colorClass = 'text-yellow-600 dark:text-yellow-400'
                            else colorClass = 'text-muted-foreground'

                            return (
                              <td key={j} className={`px-4 py-2 whitespace-nowrap ${colorClass}`}>
                                {String(val)}
                              </td>
                            )
                          }
                        }

                        // Color coding for entropy score (higher = more random)
                        if (key === 'entropy_score') {
                          const score = parseFloat(String(val))
                          if (!isNaN(score)) {
                            let colorClass = ''
                            if (score >= 4.0) colorClass = 'text-red-600 dark:text-red-400 font-semibold'
                            else if (score >= 3.5) colorClass = 'text-orange-600 dark:text-orange-400 font-medium'
                            else if (score >= 3.0) colorClass = 'text-yellow-600 dark:text-yellow-400'
                            else colorClass = 'text-muted-foreground'

                            return (
                              <td key={j} className={`px-4 py-2 whitespace-nowrap ${colorClass}`}>
                                {String(val)}
                              </td>
                            )
                          }
                        }

                        // Color coding for pattern types
                        if (key === 'pattern_type' && val !== 'none') {
                          let bgClass = 'bg-purple-100 dark:bg-purple-950'
                          let textClass = 'text-purple-700 dark:text-purple-300'

                          if (String(val).includes('keyboard')) {
                            bgClass = 'bg-orange-100 dark:bg-orange-950'
                            textClass = 'text-orange-700 dark:text-orange-300'
                          } else if (String(val).includes('repeat')) {
                            bgClass = 'bg-pink-100 dark:bg-pink-950'
                            textClass = 'text-pink-700 dark:text-pink-300'
                          }

                          return (
                            <td key={j} className="px-4 py-2 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded text-xs ${bgClass} ${textClass}`}>
                                {String(val)}
                              </span>
                            </td>
                          )
                        }

                        // Color coding for block reasons
                        if (key === 'block_reason' && val) {
                          return (
                            <td key={j} className="px-4 py-2 whitespace-nowrap text-red-600 dark:text-red-400 font-medium">
                              {String(val)}
                            </td>
                          )
                        }

                        // Color coding for boolean flags
                        if (key === 'is_disposable' || key === 'markov_detected' || key === 'is_free_provider') {
                          if (val === 'yes' || val === 'disposable' || val === 'true') {
                            return (
                              <td key={j} className="px-4 py-2 whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded text-xs bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 font-medium">
                                  {String(val)}
                                </span>
                              </td>
                            )
                          }
                        }

                        return (
                          <td key={j} className="px-4 py-2 whitespace-nowrap">
                            {String(val)}
                          </td>
                        )
                      })}
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
