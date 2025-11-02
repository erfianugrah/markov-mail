/**
 * API Client for Analytics Engine queries
 */

const API_BASE = import.meta.env.DEV ? 'http://localhost:8787' : '';

// Get API key from localStorage or fallback to env var
export function getApiKey(): string {
  return localStorage.getItem('apiKey') || import.meta.env.VITE_API_KEY || '';
}

export function setApiKey(key: string): void {
  localStorage.setItem('apiKey', key);
}

export function clearApiKey(): void {
  localStorage.removeItem('apiKey');
}

export interface QueryResult {
  success: boolean;
  data: {
    data: Array<Record<string, string | number>>;
    rows: number;
  };
}

export async function query(sql: string, hours: number = 24): Promise<QueryResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('API key not set. Please enter your API key.');
  }

  const encodedSQL = encodeURIComponent(sql);
  const response = await fetch(`${API_BASE}/admin/analytics?query=${encodedSQL}&hours=${hours}`, {
    method: 'GET',
    headers: {
      'X-API-Key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export interface Stats {
  totalValidations: number;
  totalBlocks: number;
  totalWarns: number;
  totalAllows: number;
  blockRate: number;
  warnRate: number;
  avgLatency: number;
}

export async function loadStats(hours: number = 24): Promise<Stats> {
  const result = await query(`
    SELECT
      SUM(_sample_interval) as total,
      SUM(CASE WHEN blob1 = 'block' THEN _sample_interval ELSE 0 END) as blocks,
      SUM(CASE WHEN blob1 = 'warn' THEN _sample_interval ELSE 0 END) as warns,
      SUM(CASE WHEN blob1 = 'allow' THEN _sample_interval ELSE 0 END) as allows,
      AVG(double1) as avg_latency
    FROM ANALYTICS
    WHERE timestamp >= NOW() - INTERVAL '${hours}' HOUR
  `, hours);

  const row = result.data.data[0];
  const total = Number(row.total) || 1;
  const blocks = Number(row.blocks) || 0;
  const warns = Number(row.warns) || 0;
  const allows = Number(row.allows) || 0;

  return {
    totalValidations: total,
    totalBlocks: blocks,
    totalWarns: warns,
    totalAllows: allows,
    blockRate: (blocks / total) * 100,
    warnRate: (warns / total) * 100,
    avgLatency: Number(row.avg_latency) || 0,
  };
}

export async function loadDecisions(hours: number = 24) {
  const result = await query(`
    SELECT
      blob1 as decision,
      SUM(_sample_interval) as count
    FROM ANALYTICS
    WHERE timestamp >= NOW() - INTERVAL '${hours}' HOUR
    GROUP BY decision
    ORDER BY count DESC
  `, hours);

  return result.data.data.map((row) => ({
    decision: String(row.decision),
    count: Number(row.count),
  }));
}

export async function loadRiskDistribution(hours: number = 24) {
  const result = await query(`
    SELECT
      blob4 as risk_bucket,
      SUM(_sample_interval) as count
    FROM ANALYTICS
    WHERE timestamp >= NOW() - INTERVAL '${hours}' HOUR
    GROUP BY risk_bucket
    ORDER BY risk_bucket
  `, hours);

  return result.data.data.map((row) => ({
    riskBucket: String(row.risk_bucket),
    count: Number(row.count),
  }));
}

export async function loadTimeline(hours: number = 24) {
  const result = await query(`
    SELECT
      toStartOfHour(timestamp) as hour,
      blob1 as decision,
      SUM(_sample_interval) as count
    FROM ANALYTICS
    WHERE timestamp >= NOW() - INTERVAL '${hours}' HOUR
    GROUP BY hour, decision
    ORDER BY hour ASC
  `, hours);

  // Transform data for Recharts
  const grouped = new Map<string, Record<string, number | string>>();

  result.data.data.forEach((row) => {
    const hour = String(row.hour);
    const decision = String(row.decision);
    const count = Number(row.count);

    if (!grouped.has(hour)) {
      grouped.set(hour, { hour });
    }

    const entry = grouped.get(hour)!;
    entry[decision] = count;
  });

  return Array.from(grouped.values());
}
