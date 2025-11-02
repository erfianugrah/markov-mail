import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line } from 'recharts'
import { loadStats, loadDecisions, loadRiskDistribution, loadTimeline, getApiKey, setApiKey, clearApiKey, type Stats } from '@/lib/api'
import { Activity, Shield, AlertTriangle, CheckCircle, Clock, Key, LogOut } from 'lucide-react'

const COLORS = {
  allow: 'hsl(142 76% 36%)',
  warn: 'hsl(48 96% 53%)',
  block: 'hsl(0 84% 60%)',
}

function App() {
  const [timeRange, setTimeRange] = useState<number>(24)
  const [stats, setStats] = useState<Stats | null>(null)
  const [decisions, setDecisions] = useState<Array<{ decision: string; count: number }>>([])
  const [riskDistribution, setRiskDistribution] = useState<Array<{ riskBucket: string; count: number }>>([])
  const [timeline, setTimeline] = useState<Array<Record<string, number | string>>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)

  // Check for existing API key on mount
  useEffect(() => {
    const existingKey = getApiKey()
    setHasApiKey(!!existingKey)
  }, [])

  useEffect(() => {
    if (!hasApiKey) {
      setLoading(false)
      return
    }

    async function fetchData() {
      try {
        setLoading(true)
        setError(null)

        const [statsData, decisionsData, riskData, timelineData] = await Promise.all([
          loadStats(timeRange),
          loadDecisions(timeRange),
          loadRiskDistribution(timeRange),
          loadTimeline(timeRange),
        ])

        setStats(statsData)
        setDecisions(decisionsData)
        setRiskDistribution(riskData)
        setTimeline(timelineData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [timeRange, hasApiKey])

  const handleLogin = () => {
    if (apiKeyInput.trim()) {
      setApiKey(apiKeyInput.trim())
      setHasApiKey(true)
      setApiKeyInput('')
    }
  }

  const handleLogout = () => {
    clearApiKey()
    setHasApiKey(false)
    setStats(null)
    setDecisions([])
    setRiskDistribution([])
    setTimeline([])
  }

  // Show login if no API key
  if (!hasApiKey) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Card className="w-96">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              API Key Required
            </CardTitle>
            <CardDescription>Enter your admin API key to access the dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="Admin API Key"
                  className="w-full px-3 py-2 border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
              </div>
              <Button onClick={handleLogin} className="w-full">
                Login
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading dashboard...</div>
      </div>
    )
  }

  if (error && !stats) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>Failed to load analytics data</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-destructive">{error}</p>
            <p className="text-xs text-muted-foreground mt-2">
              Check your API key or try logging out and in again
            </p>
            <Button onClick={handleLogout} variant="outline" className="w-full mt-4">
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Fraud Detection Analytics</h1>
            <p className="text-muted-foreground mt-2">
              Real-time insights from your fraud detection system
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Select value={String(timeRange)} onValueChange={(v) => setTimeRange(Number(v))}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Time range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Last 1 hour</SelectItem>
                <SelectItem value="6">Last 6 hours</SelectItem>
                <SelectItem value="24">Last 24 hours</SelectItem>
                <SelectItem value="168">Last 7 days</SelectItem>
                <SelectItem value="720">Last 30 days</SelectItem>
              </SelectContent>
            </Select>

            <Button onClick={handleLogout} variant="outline" size="icon" title="Logout">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Validations</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalValidations.toLocaleString()}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Allowed</CardTitle>
                <CheckCircle className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalAllows.toLocaleString()}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Warned</CardTitle>
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalWarns.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">{stats.warnRate.toFixed(1)}% of total</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Blocked</CardTitle>
                <Shield className="h-4 w-4 text-red-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalBlocks.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">{stats.blockRate.toFixed(1)}% of total</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.avgLatency.toFixed(0)}ms</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Charts Grid */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Decision Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Decision Breakdown</CardTitle>
              <CardDescription>Distribution of validation decisions</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={{
                  allow: { label: 'Allow', color: COLORS.allow },
                  warn: { label: 'Warn', color: COLORS.warn },
                  block: { label: 'Block', color: COLORS.block },
                }}
                className="h-[300px]"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={decisions}
                      dataKey="count"
                      nameKey="decision"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                    >
                      {decisions.map((entry) => (
                        <Cell
                          key={entry.decision}
                          fill={COLORS[entry.decision as keyof typeof COLORS] || 'hsl(var(--chart-1))'}
                        />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Risk Distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Risk Distribution</CardTitle>
              <CardDescription>Distribution by risk score buckets</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={{
                  count: { label: 'Count', color: 'hsl(var(--chart-1))' },
                }}
                className="h-[300px]"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={riskDistribution}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="riskBucket" className="text-xs" />
                    <YAxis className="text-xs" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>

        {/* Timeline Chart - Full Width */}
        <Card>
          <CardHeader>
            <CardTitle>Validation Timeline</CardTitle>
            <CardDescription>Hourly breakdown of decisions over time</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                allow: { label: 'Allow', color: COLORS.allow },
                warn: { label: 'Warn', color: COLORS.warn },
                block: { label: 'Block', color: COLORS.block },
              }}
              className="h-[350px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeline}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="hour"
                    className="text-xs"
                    tickFormatter={(value) => {
                      const date = new Date(value)
                      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit' })
                    }}
                  />
                  <YAxis className="text-xs" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend />
                  <Line type="monotone" dataKey="allow" stroke={COLORS.allow} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="warn" stroke={COLORS.warn} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="block" stroke={COLORS.block} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default App
