import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertCircle, Copy, Check } from 'lucide-react'

export function DataManagement() {
  const [timeHours, setTimeHours] = useState('24')
  const [timeFilter, setTimeFilter] = useState('')
  const [testFilter, setTestFilter] = useState('')
  const [copiedTime, setCopiedTime] = useState(false)
  const [copiedTest, setCopiedTest] = useState(false)

  const generateTimeFilter = () => {
    const hours = parseInt(timeHours) || 24
    const filter = `timestamp >= NOW() - INTERVAL '${hours}' HOUR`
    setTimeFilter(filter)
  }

  const generateTestDataFilter = () => {
    const filters = [
      "blob5 NOT LIKE '%test%'",
      "blob5 NOT LIKE '%example%'",
      "blob5 NOT LIKE '%demo%'",
      "blob14 NOT LIKE 'test%'",
      "blob14 NOT LIKE '%+test%'"
    ]
    setTestFilter(filters.join(' AND '))
  }

  const copyToClipboard = (text: string, type: 'time' | 'test') => {
    navigator.clipboard.writeText(text)
    if (type === 'time') {
      setCopiedTime(true)
      setTimeout(() => setCopiedTime(false), 2000)
    } else {
      setCopiedTest(true)
      setTimeout(() => setCopiedTest(false), 2000)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Analytics Engine Data Management</CardTitle>
          <CardDescription>
            Tools for managing and filtering Analytics Engine data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="p-4 border border-blue-500/50 rounded-md bg-blue-500/10">
            <div className="flex gap-2">
              <AlertCircle className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <strong>Important:</strong> Cloudflare Analytics Engine data is immutable and cannot be deleted directly.
                Data is automatically retained for 6 months. Use the tools below to generate SQL filters to exclude unwanted data from queries.
              </div>
            </div>
          </div>

          {/* Time Filter */}
          <div>
            <h3 className="text-lg font-semibold mb-2">Filter by Time Range</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Generate a SQL filter to exclude data older than a specified time.
            </p>
            <div className="flex gap-3 items-center mb-3">
              <input
                type="number"
                value={timeHours}
                onChange={(e) => setTimeHours(e.target.value)}
                min="1"
                placeholder="Hours"
                className="w-32 px-3 py-2 border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button onClick={generateTimeFilter}>Generate Time Filter</Button>
            </div>
            {timeFilter && (
              <div className="relative">
                <pre className="p-4 bg-muted rounded-md text-sm overflow-x-auto">
                  {timeFilter}
                </pre>
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(timeFilter, 'time')}
                >
                  {copiedTime ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            )}
          </div>

          {/* Test Data Filter */}
          <div>
            <h3 className="text-lg font-semibold mb-2">Filter Test Data</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Generate SQL filters to exclude common test data patterns.
            </p>
            <Button onClick={generateTestDataFilter} className="mb-3">
              Generate Test Data Filters
            </Button>
            {testFilter && (
              <div className="relative">
                <pre className="p-4 bg-muted rounded-md text-sm overflow-x-auto">
                  {testFilter}
                </pre>
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(testFilter, 'test')}
                >
                  {copiedTest ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            )}
          </div>

          {/* Dataset Information */}
          <div>
            <h3 className="text-lg font-semibold mb-2">Dataset Information</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <div className="font-medium min-w-[140px]">Dataset Name:</div>
                <div className="text-muted-foreground">ANALYTICS</div>
              </div>
              <div className="flex items-start gap-3">
                <div className="font-medium min-w-[140px]">Data Retention:</div>
                <div className="text-muted-foreground">6 months (automatic)</div>
              </div>
              <div className="flex items-start gap-3">
                <div className="font-medium min-w-[140px]">Deletion Policy:</div>
                <div className="text-muted-foreground">Data older than 6 months is automatically deleted</div>
              </div>
              <div className="flex items-start gap-3">
                <div className="font-medium min-w-[140px]">Manual Deletion:</div>
                <div className="text-muted-foreground">Not available - data is immutable</div>
              </div>
              <div className="flex items-start gap-3">
                <div className="font-medium min-w-[140px]">Column Mapping:</div>
                <div className="text-muted-foreground">
                  <a
                    href="https://developers.cloudflare.com/analytics/analytics-engine/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    View Analytics Engine documentation
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Usage Example */}
          <div>
            <h3 className="text-lg font-semibold mb-2">Usage Example</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Combine filters in your SQL queries:
            </p>
            <pre className="p-4 bg-muted rounded-md text-sm overflow-x-auto">
{`SELECT * FROM ANALYTICS
WHERE ${timeFilter || "timestamp >= NOW() - INTERVAL '24' HOUR"}
  AND ${testFilter || "blob5 NOT LIKE '%test%'"}
ORDER BY timestamp DESC
LIMIT 100`}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
