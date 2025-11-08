import { useState, useEffect, useCallback } from 'react'
import { useChartColor } from '@/hooks/useChartColor'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, Brush } from 'recharts'
import {
  loadStats, loadDecisions, loadRiskDistribution, loadTimeline,
  loadCountries, loadPatternTypes, loadBlockReasons, loadDomains, loadTLDs,
  loadPatternFamilies, loadDisposableDomains, loadFreeProviders, loadPlusAddressing,
  loadEntropyScores, loadBotScores,
  loadLatencyDistribution, loadASNs, loadTLDRiskScores, loadDomainReputation,
  loadPatternConfidence, getApiKey, setApiKey, clearApiKey, type Stats
} from '@/lib/api'
import { Activity, Shield, AlertTriangle, CheckCircle, Clock, Key, LogOut, Target, Moon, Sun, RefreshCw, Maximize2, Minimize2 } from 'lucide-react'
import { SimpleBarChart } from '@/components/SimpleBarChart'
import { ExportButton } from '@/components/ExportButton'
import { QueryBuilder } from '@/components/QueryBuilder'
import { DataExplorer } from '@/components/DataExplorer'
import { DataManagement } from '@/components/DataManagement'

// Theme-aware colors that work in both light and dark modes
const COLORS = {
  allow: {
    light: 'hsl(142 76% 36%)',
    dark: 'hsl(142 70% 45%)'
  },
  warn: {
    light: 'hsl(48 96% 53%)',
    dark: 'hsl(48 90% 60%)'
  },
  block: {
    light: 'hsl(0 84% 60%)',
    dark: 'hsl(0 80% 65%)'
  },
}

// Helper to get color based on current theme
const getColor = (colorKey: keyof typeof COLORS, isDark: boolean) => {
  return isDark ? COLORS[colorKey].dark : COLORS[colorKey].light
}

// Color palette for charts
const CHART_COLORS = [
  { dark: 'hsl(220 70% 60%)', light: 'hsl(220 70% 50%)' },  // Blue
  { dark: 'hsl(142 70% 55%)', light: 'hsl(142 70% 45%)' },  // Green
  { dark: 'hsl(48 80% 55%)', light: 'hsl(48 80% 50%)' },   // Yellow
  { dark: 'hsl(270 70% 60%)', light: 'hsl(270 70% 50%)' },  // Purple
  { dark: 'hsl(30 80% 55%)', light: 'hsl(30 80% 50%)' },   // Orange
  { dark: 'hsl(330 80% 60%)', light: 'hsl(330 80% 55%)' },  // Magenta
  { dark: 'hsl(190 70% 55%)', light: 'hsl(190 70% 50%)' },  // Cyan
  { dark: 'hsl(100 70% 55%)', light: 'hsl(100 70% 50%)' },  // Lime
]

// Dynamic color getter by index
const getChartColor = (index: number, isDark: boolean): string => {
  const colorPair = CHART_COLORS[index % CHART_COLORS.length]
  return isDark ? colorPair.dark : colorPair.light
}

// Risk-based color getter (for Risk Distribution chart)
const getRiskColor = (bucket: string, isDark: boolean): string => {
  const b = bucket.toLowerCase()
  if (b.includes('high')) return isDark ? 'hsl(0 80% 55%)' : 'hsl(0 80% 50%)'
  if (b.includes('medium')) return isDark ? 'hsl(48 80% 55%)' : 'hsl(48 80% 50%)'
  return isDark ? 'hsl(142 70% 50%)' : 'hsl(142 70% 45%)'
}

function App() {
  const [timeRange, setTimeRange] = useState<number>(24)
  const [stats, setStats] = useState<Stats | null>(null)
  const [decisions, setDecisions] = useState<Array<{ decision: string; count: number }>>([])
  const [riskDistribution, setRiskDistribution] = useState<Array<{ riskBucket: string; count: number }>>([])
  const [timeline, setTimeline] = useState<Array<Record<string, number | string>>>([])
  const [countries, setCountries] = useState<any[]>([])
  const [patternTypes, setPatternTypes] = useState<any[]>([])
  const [blockReasons, setBlockReasons] = useState<any[]>([])
  const [domains, setDomains] = useState<any[]>([])
  const [tlds, setTLDs] = useState<any[]>([])
  const [patternFamilies, setPatternFamilies] = useState<any[]>([])
  const [disposableDomains, setDisposableDomains] = useState<any[]>([])
  const [freeProviders, setFreeProviders] = useState<any[]>([])
  const [plusAddressing, setPlusAddressing] = useState<any[]>([])
  const [entropyScores, setEntropyScores] = useState<any[]>([])
  const [botScores, setBotScores] = useState<any[]>([])
  const [latencyDist, setLatencyDist] = useState<any[]>([])
  const [asns, setASNs] = useState<any[]>([])
  const [tldRiskScores, setTLDRiskScores] = useState<any[]>([])
  const [domainReputation, setDomainReputation] = useState<any[]>([])
  const [patternConfidence, setPatternConfidence] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      // Check localStorage first, fallback to system preference
      const saved = localStorage.getItem('darkMode')
      if (saved !== null) {
        return saved === 'true'
      }
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return false
  })

  // Chart-specific loading states
  const [decisionsLoading, setDecisionsLoading] = useState(false)
  const [riskLoading, setRiskLoading] = useState(false)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [decisionsFullscreen, setDecisionsFullscreen] = useState(false)
  const [riskFullscreen, setRiskFullscreen] = useState(false)
  const [timelineFullscreen, setTimelineFullscreen] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  // Get computed chart colors for bars (CSS variables don't work in Recharts)
  const barChartColor = useChartColor('--color-chart-1', darkMode)

  // Check for existing API key on mount
  useEffect(() => {
    const existingKey = getApiKey()
    setHasApiKey(!!existingKey)
  }, [])

  // Handle dark mode
  useEffect(() => {
    console.log('[Dark Mode] Toggling to:', darkMode)
    if (darkMode) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('darkMode', 'true')
      console.log('[Dark Mode] Added .dark class, classes:', document.documentElement.className)
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('darkMode', 'false')
      console.log('[Dark Mode] Removed .dark class, classes:', document.documentElement.className)
    }

    // Debug CSS variables
    const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--color-background').trim()
    console.log('[Dark Mode] CSS variable --color-background:', bgColor)
    console.log('[Dark Mode] Body background:', getComputedStyle(document.body).backgroundColor)
  }, [darkMode])

  // Note: Removed forced chart re-render for smoother transitions
  // ResponsiveContainer handles resize automatically

  useEffect(() => {
    if (!hasApiKey) {
      setLoading(false)
      return
    }

    async function fetchData() {
      try {
        setLoading(true)
        setError(null)

        const [
          statsData, decisionsData, riskData, timelineData,
          countriesData, patternTypesData, blockReasonsData, domainsData, tldsData,
          patternFamiliesData, disposableDomainsData, freeProvidersData, plusAddressingData,
          entropyScoresData, botScoresData,
          latencyDistData, asnsData, tldRiskScoresData, domainReputationData, patternConfidenceData
        ] = await Promise.all([
          loadStats(timeRange),
          loadDecisions(timeRange),
          loadRiskDistribution(timeRange),
          loadTimeline(timeRange),
          loadCountries(timeRange),
          loadPatternTypes(timeRange),
          loadBlockReasons(timeRange),
          loadDomains(timeRange),
          loadTLDs(timeRange),
          loadPatternFamilies(timeRange),
          loadDisposableDomains(timeRange),
          loadFreeProviders(timeRange),
          loadPlusAddressing(timeRange),
          loadEntropyScores(timeRange),
          loadBotScores(timeRange),
          loadLatencyDistribution(timeRange),
          loadASNs(timeRange),
          loadTLDRiskScores(timeRange),
          loadDomainReputation(timeRange),
          loadPatternConfidence(timeRange),
        ])

        setStats(statsData)
        setDecisions(decisionsData)
        setRiskDistribution(riskData)
        setTimeline(timelineData)
        setCountries(countriesData)
        setPatternTypes(patternTypesData)
        setBlockReasons(blockReasonsData)
        setDomains(domainsData)
        setTLDs(tldsData)
        setPatternFamilies(patternFamiliesData)
        setDisposableDomains(disposableDomainsData)
        setFreeProviders(freeProvidersData)
        setPlusAddressing(plusAddressingData)
        setEntropyScores(entropyScoresData)
        setBotScores(botScoresData)
        setLatencyDist(latencyDistData)
        setASNs(asnsData)
        setTLDRiskScores(tldRiskScoresData)
        setDomainReputation(domainReputationData)
        setPatternConfidence(patternConfidenceData)
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

  // Individual chart refresh handlers
  const refreshDecisions = useCallback(async () => {
    setDecisionsLoading(true)
    try {
      const data = await loadDecisions(timeRange)
      setDecisions(data)
    } catch (err) {
      console.error('Failed to refresh decisions:', err)
    } finally {
      setDecisionsLoading(false)
    }
  }, [timeRange])

  const refreshRisk = useCallback(async () => {
    setRiskLoading(true)
    try {
      const data = await loadRiskDistribution(timeRange)
      setRiskDistribution(data)
    } catch (err) {
      console.error('Failed to refresh risk:', err)
    } finally {
      setRiskLoading(false)
    }
  }, [timeRange])

  const refreshTimeline = useCallback(async () => {
    setTimelineLoading(true)
    try {
      const data = await loadTimeline(timeRange)
      setTimeline(data)
    } catch (err) {
      console.error('Failed to refresh timeline:', err)
    } finally {
      setTimelineLoading(false)
    }
  }, [timeRange])

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
      <div className={`${activeTab === 'explorer' || activeTab === 'management' ? 'max-w-full' : 'max-w-7xl'} mx-auto space-y-6`}>
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
                <SelectItem value="0">All time</SelectItem>
              </SelectContent>
            </Select>

            <ExportButton
              data={{
                stats,
                decisions,
                riskDistribution,
                timeline,
                countries,
                patternTypes,
                blockReasons,
                domains,
                tlds,
                patternFamilies,
                disposableDomains,
                freeProviders,
                plusAddressing,
                entropyScores,
                botScores,
                latencyDist,
                asns,
                tldRiskScores,
                domainReputation,
                patternConfidence
              }}
              filename={`fraud-detection-${new Date().toISOString().split('T')[0]}`}
            />

            <Button
              onClick={() => setDarkMode(!darkMode)}
              variant="outline"
              size="icon"
              title="Toggle dark mode"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <Button onClick={handleLogout} variant="outline" size="icon" title="Logout">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-6" onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="query">Query Builder</TabsTrigger>
            <TabsTrigger value="explorer">Data Explorer</TabsTrigger>
            <TabsTrigger value="management">Data Management</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Stats Cards */}
            {stats && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
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
                <CardTitle className="text-sm font-medium">Avg Risk Score</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.avgRiskScore.toFixed(2)}</div>
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

        {/* Fullscreen Backdrops */}
        {decisionsFullscreen && (
          <div
            className="fullscreen-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setDecisionsFullscreen(false)
              }
            }}
          />
        )}
        {riskFullscreen && (
          <div
            className="fullscreen-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setRiskFullscreen(false)
              }
            }}
          />
        )}
        {timelineFullscreen && (
          <div
            className="fullscreen-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setTimelineFullscreen(false)
              }
            }}
          />
        )}

        {/* Charts Grid */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Decision Breakdown */}
          <Card
            className={decisionsFullscreen ? "chart-fullscreen fixed inset-4 z-50 overflow-auto bg-card shadow-2xl" : "chart-card"}
            onClick={(e) => decisionsFullscreen && e.stopPropagation()}
          >
            <CardHeader
              actions={
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={refreshDecisions}
                    disabled={decisionsLoading}
                    title="Refresh"
                  >
                    <RefreshCw className={`h-4 w-4 ${decisionsLoading ? 'animate-spin' : ''}`} />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setDecisionsFullscreen(!decisionsFullscreen)}
                    title={decisionsFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  >
                    {decisionsFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </Button>
                </>
              }
            >
              <CardTitle className="text-base">Decision Breakdown</CardTitle>
              <CardDescription>Distribution of validation decisions</CardDescription>
            </CardHeader>
            <CardContent>
              {decisionsLoading ? (
                <div className={`${decisionsFullscreen ? 'h-[calc(100vh-200px)]' : 'h-[300px]'} flex items-center justify-center`}>
                  <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ChartContainer
                  config={{
                    allow: {
                      label: 'Allow',
                      theme: { light: COLORS.allow.light, dark: COLORS.allow.dark }
                    },
                    warn: {
                      label: 'Warn',
                      theme: { light: COLORS.warn.light, dark: COLORS.warn.dark }
                    },
                    block: {
                      label: 'Block',
                      theme: { light: COLORS.block.light, dark: COLORS.block.dark }
                    },
                  }}
                  className={decisionsFullscreen ? 'h-[calc(100vh-200px)]' : 'h-[300px]'}
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
                            fill={getColor(entry.decision as keyof typeof COLORS, darkMode) || 'hsl(var(--chart-1))'}
                          />
                        ))}
                      </Pie>
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Risk Distribution */}
          <Card
            className={riskFullscreen ? "chart-fullscreen fixed inset-4 z-50 overflow-auto bg-card shadow-2xl" : "chart-card"}
            onClick={(e) => riskFullscreen && e.stopPropagation()}
          >
            <CardHeader
              actions={
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={refreshRisk}
                    disabled={riskLoading}
                    title="Refresh"
                  >
                    <RefreshCw className={`h-4 w-4 ${riskLoading ? 'animate-spin' : ''}`} />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setRiskFullscreen(!riskFullscreen)}
                    title={riskFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  >
                    {riskFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </Button>
                </>
              }
            >
              <CardTitle className="text-base">Risk Distribution</CardTitle>
              <CardDescription>Distribution by risk score buckets</CardDescription>
            </CardHeader>
            <CardContent>
              {riskLoading ? (
                <div className={`${riskFullscreen ? 'h-[calc(100vh-200px)]' : 'h-[300px]'} flex items-center justify-center`}>
                  <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ChartContainer
                  config={{
                    count: { label: 'Count', color: barChartColor },
                  }}
                  className={riskFullscreen ? 'h-[calc(100vh-200px)]' : 'h-[300px]'}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={riskDistribution}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="riskBucket" className="text-xs" />
                      <YAxis className="text-xs" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {riskDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={getRiskColor(String(entry.riskBucket), darkMode)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Timeline Chart - Full Width */}
        <Card
          className={timelineFullscreen ? "chart-fullscreen fixed inset-4 z-50 overflow-auto bg-card shadow-2xl" : "chart-card"}
          onClick={(e) => timelineFullscreen && e.stopPropagation()}
        >
          <CardHeader
            actions={
              <>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={refreshTimeline}
                  disabled={timelineLoading}
                  title="Refresh"
                >
                  <RefreshCw className={`h-4 w-4 ${timelineLoading ? 'animate-spin' : ''}`} />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setTimelineFullscreen(!timelineFullscreen)}
                  title={timelineFullscreen ? "Exit fullscreen" : "Fullscreen"}
                >
                  {timelineFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
              </>
            }
          >
            <CardTitle className="text-base">Validation Timeline</CardTitle>
            <CardDescription>Hourly breakdown of decisions over time</CardDescription>
          </CardHeader>
          <CardContent>
            {timelineLoading ? (
              <div className={`${timelineFullscreen ? 'h-[calc(100vh-200px)]' : 'h-[350px]'} flex items-center justify-center`}>
                <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ChartContainer
                config={{
                  allow: {
                    label: 'Allow',
                    theme: { light: COLORS.allow.light, dark: COLORS.allow.dark }
                  },
                  warn: {
                    label: 'Warn',
                    theme: { light: COLORS.warn.light, dark: COLORS.warn.dark }
                  },
                  block: {
                    label: 'Block',
                    theme: { light: COLORS.block.light, dark: COLORS.block.dark }
                  },
                }}
                className={timelineFullscreen ? 'h-[calc(100vh-200px)]' : 'h-[350px]'}
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
                    <Line type="monotone" dataKey="allow" stroke={getColor('allow', darkMode)} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="warn" stroke={getColor('warn', darkMode)} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="block" stroke={getColor('block', darkMode)} strokeWidth={2} dot={false} />
                    <Brush
                      dataKey="hour"
                      height={30}
                      stroke="hsl(var(--color-primary))"
                      fill="hsl(var(--color-muted))"
                      tickFormatter={(value) => {
                        const date = new Date(value)
                        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Additional Charts Grid - 2 columns */}
        <div className="grid gap-6 md:grid-cols-2">
          <SimpleBarChart
            title="Top Countries"
            description="Most common validation countries"
            data={countries}
            dataKey="count"
            nameKey="country"
            isDark={darkMode}
            getBarColor={(_, index) => getChartColor(index, darkMode)}
          />

          <SimpleBarChart
            title="Pattern Types"
            description="Detected pattern types (grouped by algorithm version)"
            data={patternTypes.map(p => ({
              ...p,
              displayName: p.version && p.version !== 'unknown' ? `${p.patternType} (v${p.version})` : p.patternType
            }))}
            dataKey="count"
            nameKey="displayName"
            isDark={darkMode}
            color="hsl(var(--chart-2))"
            getBarColor={(entry) => {
              const type = String(entry.patternType || entry.displayName).toLowerCase()
              if (type.includes('repeat')) return darkMode ? 'hsl(330 80% 60%)' : 'hsl(330 80% 55%)'
              if (type.includes('sequential')) return darkMode ? 'hsl(270 70% 60%)' : 'hsl(270 70% 55%)'
              if (type === 'none') return darkMode ? 'hsl(142 70% 50%)' : 'hsl(142 70% 45%)'
              return darkMode ? 'hsl(220 70% 60%)' : 'hsl(220 70% 50%)'
            }}
          />

          <SimpleBarChart
            title="Block Reasons"
            description="Top reasons for blocking emails (grouped by algorithm version)"
            data={blockReasons.map(r => ({
              ...r,
              displayName: r.version && r.version !== 'unknown' ? `${r.reason} (v${r.version})` : r.reason
            }))}
            dataKey="count"
            nameKey="displayName"
            isDark={darkMode}
            color="hsl(var(--chart-3))"
            getBarColor={(entry) => {
              const reason = String(entry.reason || entry.displayName).toLowerCase()
              if (reason.includes('sequential')) return darkMode ? 'hsl(270 70% 60%)' : 'hsl(270 70% 55%)'
              if (reason.includes('disposable')) return darkMode ? 'hsl(15 70% 55%)' : 'hsl(15 70% 50%)'
              if (reason.includes('plus')) return darkMode ? 'hsl(48 80% 55%)' : 'hsl(48 80% 50%)'
              if (reason.includes('tld')) return darkMode ? 'hsl(10 80% 55%)' : 'hsl(10 80% 50%)'
              if (reason.includes('markov')) return darkMode ? 'hsl(330 80% 60%)' : 'hsl(330 80% 55%)'
              return darkMode ? 'hsl(0 80% 55%)' : 'hsl(0 80% 50%)'
            }}
          />

          <SimpleBarChart
            title="Top Domains"
            description="Most validated email domains"
            data={domains}
            dataKey="count"
            nameKey="domain"
            isDark={darkMode}
            color="hsl(var(--chart-4))"
            getBarColor={(_, index) => getChartColor(index, darkMode)}
          />

          <SimpleBarChart
            title="Top TLDs"
            description="Most common top-level domains"
            data={tlds}
            dataKey="count"
            nameKey="tld"
            isDark={darkMode}
            color="hsl(var(--chart-5))"
            getBarColor={(_, index) => getChartColor(index, darkMode)}
          />

          <SimpleBarChart
            title="Pattern Families"
            description="Detected pattern families"
            data={patternFamilies}
            dataKey="count"
            nameKey="family"
            isDark={darkMode}
            color="hsl(var(--chart-1))"
            getBarColor={(_, index) => getChartColor(index, darkMode)}
          />

          <SimpleBarChart
            title="Disposable Domains"
            description="Top disposable email domains"
            data={disposableDomains}
            dataKey="count"
            nameKey="domain"
            isDark={darkMode}
            color="hsl(var(--chart-2))"
            getBarColor={(_, index) => getChartColor(index, darkMode)}
          />

          <SimpleBarChart
            title="Free Email Providers"
            description="Top free email providers"
            data={freeProviders}
            dataKey="count"
            nameKey="domain"
            isDark={darkMode}
            color="hsl(var(--chart-3))"
            getBarColor={(_, index) => getChartColor(index, darkMode)}
          />

          <SimpleBarChart
            title="Plus Addressing"
            description="Domains using plus addressing"
            data={plusAddressing}
            dataKey="count"
            nameKey="domain"
            isDark={darkMode}
            color="hsl(var(--chart-4))"
            getBarColor={(_, index) => getChartColor(index, darkMode)}
          />

          <SimpleBarChart
            title="Entropy Scores"
            description="Distribution of entropy scores"
            data={entropyScores}
            dataKey="count"
            nameKey="bucket"
            isDark={darkMode}
            color="hsl(var(--chart-2))"
            getBarColor={(_, index) => getChartColor(index, darkMode)}
          />

          <SimpleBarChart
            title="Bot Scores"
            description="Distribution of bot detection scores"
            data={botScores}
            dataKey="count"
            nameKey="range"
            isDark={darkMode}
            color="hsl(var(--chart-3))"
            getBarColor={(_, index) => getChartColor(index, darkMode)}
          />

          <SimpleBarChart
            title="Latency Distribution"
            description="API response time distribution"
            data={latencyDist}
            dataKey="count"
            nameKey="range"
            isDark={darkMode}
            color="hsl(var(--chart-4))"
            getBarColor={(_, index) => getChartColor(index, darkMode)}
          />

          <SimpleBarChart
            title="Top ASNs"
            description="Most common autonomous system numbers"
            data={asns}
            dataKey="count"
            nameKey="asn"
            isDark={darkMode}
            color="hsl(var(--chart-5))"
            getBarColor={(_, index) => getChartColor(index, darkMode)}
          />

          <SimpleBarChart
            title="TLD Risk Scores"
            description="Average risk score by TLD"
            data={tldRiskScores}
            dataKey="avgRisk"
            nameKey="tld"
            isDark={darkMode}
            color="hsl(var(--chart-1))"
            getBarColor={(_, index) => getChartColor(index, darkMode)}
          />

          <SimpleBarChart
            title="Domain Reputation"
            description="Top domains by reputation score"
            data={domainReputation}
            dataKey="avgReputation"
            nameKey="domain"
            isDark={darkMode}
            color="hsl(var(--chart-2))"
            getBarColor={(_, index) => getChartColor(index, darkMode)}
          />

          <SimpleBarChart
            title="Pattern Confidence"
            description="Pattern matching confidence distribution"
            data={patternConfidence}
            dataKey="count"
            nameKey="range"
            isDark={darkMode}
            color="hsl(var(--chart-3))"
            getBarColor={(_, index) => getChartColor(index, darkMode)}
          />
        </div>
          </TabsContent>

          <TabsContent value="query">
            <QueryBuilder />
          </TabsContent>

          <TabsContent value="explorer">
            <DataExplorer />
          </TabsContent>

          <TabsContent value="management">
            <DataManagement />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

export default App
