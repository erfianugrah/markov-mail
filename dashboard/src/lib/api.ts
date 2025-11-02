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

// Helper to build time filter WHERE clause
function buildTimeFilter(hours: number): string {
  return hours === 0 ? '' : `WHERE timestamp >= NOW() - INTERVAL '${hours}' HOUR`;
}

// Helper to build time filter for queries with additional AND conditions
function buildTimeFilterWith(hours: number, condition: string): string {
  if (hours === 0) {
    return `WHERE ${condition}`;
  }
  return `WHERE timestamp >= NOW() - INTERVAL '${hours}' HOUR AND ${condition}`;
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
  avgRiskScore: number;
  avgLatency: number;
}

export async function loadStats(hours: number = 24): Promise<Stats> {
  const result = await query(`
    SELECT
      SUM(_sample_interval) as total,
      SUM(CASE WHEN blob1 = 'block' THEN _sample_interval ELSE 0 END) as blocks,
      SUM(CASE WHEN blob1 = 'warn' THEN _sample_interval ELSE 0 END) as warns,
      SUM(CASE WHEN blob1 = 'allow' THEN _sample_interval ELSE 0 END) as allows,
      AVG(double1) as avg_risk,
      AVG(double5) as avg_latency
    FROM ANALYTICS
    ${buildTimeFilter(hours)}
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
    avgRiskScore: Number(row.avg_risk) || 0,
    avgLatency: Number(row.avg_latency) || 0,
  };
}

export async function loadDecisions(hours: number = 24) {
  const result = await query(`
    SELECT
      blob1 as decision,
      SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilter(hours)}
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
    ${buildTimeFilter(hours)}
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
    ${buildTimeFilter(hours)}
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

// Additional chart data loaders
export async function loadCountries(hours: number = 24) {
  const result = await query(`
    SELECT blob3 as country, SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilter(hours)}
    GROUP BY country
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return result.data.data.map((row) => ({ country: String(row.country), count: Number(row.count) }));
}

export async function loadPatternTypes(hours: number = 24) {
  const result = await query(`
    SELECT blob7 as pattern_type, SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilterWith(hours, "blob7 != 'none'")}
    GROUP BY pattern_type
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return result.data.data.map((row) => ({ patternType: String(row.pattern_type), count: Number(row.count) }));
}

export async function loadBlockReasons(hours: number = 24) {
  const result = await query(`
    SELECT blob2 as block_reason, SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilterWith(hours, "blob1 = 'block' AND blob2 != 'none'")}
    GROUP BY block_reason
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return result.data.data.map((row) => ({ reason: String(row.block_reason), count: Number(row.count) }));
}

export async function loadDomains(hours: number = 24) {
  const result = await query(`
    SELECT blob5 as domain, SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilter(hours)}
    GROUP BY domain
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return result.data.data.map((row) => ({ domain: String(row.domain), count: Number(row.count) }));
}

export async function loadTLDs(hours: number = 24) {
  const result = await query(`
    SELECT blob6 as tld, SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilter(hours)}
    GROUP BY tld
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return result.data.data.map((row) => ({ tld: String(row.tld), count: Number(row.count) }));
}

export async function loadPatternFamilies(hours: number = 24) {
  const result = await query(`
    SELECT blob8 as pattern_family, SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilterWith(hours, "blob8 != 'none'")}
    GROUP BY pattern_family
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return result.data.data.map((row) => ({ family: String(row.pattern_family), count: Number(row.count) }));
}

export async function loadDisposableDomains(hours: number = 24) {
  const result = await query(`
    SELECT blob5 as domain, SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilterWith(hours, "blob9 = 'true'")}
    GROUP BY domain
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return result.data.data.map((row) => ({ domain: String(row.domain), count: Number(row.count) }));
}

export async function loadFreeProviders(hours: number = 24) {
  const result = await query(`
    SELECT blob5 as domain, SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilterWith(hours, "blob10 = 'true'")}
    GROUP BY domain
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return result.data.data.map((row) => ({ domain: String(row.domain), count: Number(row.count) }));
}

export async function loadPlusAddressing(hours: number = 24) {
  const result = await query(`
    SELECT blob5 as domain, SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilterWith(hours, "blob11 = 'true'")}
    GROUP BY domain
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return result.data.data.map((row) => ({ domain: String(row.domain), count: Number(row.count) }));
}

export async function loadKeyboardWalks(hours: number = 24) {
  const result = await query(`
    SELECT blob12 as walk_type, SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilterWith(hours, "blob12 != 'none'")}
    GROUP BY walk_type
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return result.data.data.map((row) => ({ type: String(row.walk_type), count: Number(row.count) }));
}

export async function loadGibberish(hours: number = 24) {
  const result = await query(`
    SELECT blob13 as is_gibberish, SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilter(hours)}
    GROUP BY is_gibberish
    ORDER BY count DESC
  `, hours);
  return result.data.data.map((row) => ({ isGibberish: String(row.is_gibberish), count: Number(row.count) }));
}

export async function loadEntropyScores(hours: number = 24) {
  const result = await query(`
    SELECT blob4 as entropy_bucket, SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilter(hours)}
    GROUP BY entropy_bucket
    ORDER BY entropy_bucket
  `, hours);
  return result.data.data.map((row) => ({ bucket: String(row.entropy_bucket), count: Number(row.count) }));
}

export async function loadBotScores(hours: number = 24) {
  const result = await query(`
    SELECT 
      CASE 
        WHEN double2 < 30 THEN '0-30'
        WHEN double2 < 50 THEN '30-50'
        WHEN double2 < 70 THEN '50-70'
        WHEN double2 < 90 THEN '70-90'
        ELSE '90-100'
      END as bot_score_range,
      SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilter(hours)}
    GROUP BY bot_score_range
    ORDER BY bot_score_range
  `, hours);
  return result.data.data.map((row) => ({ range: String(row.bot_score_range), count: Number(row.count) }));
}

export async function loadLatencyDistribution(hours: number = 24) {
  const result = await query(`
    SELECT 
      CASE 
        WHEN double5 < 10 THEN '0-10ms'
        WHEN double5 < 50 THEN '10-50ms'
        WHEN double5 < 100 THEN '50-100ms'
        WHEN double5 < 200 THEN '100-200ms'
        ELSE '200ms+'
      END as latency_range,
      SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilter(hours)}
    GROUP BY latency_range
    ORDER BY latency_range
  `, hours);
  return result.data.data.map((row) => ({ range: String(row.latency_range), count: Number(row.count) }));
}

export async function loadASNs(hours: number = 24) {
  const result = await query(`
    SELECT double3 as asn, SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilter(hours)}
    GROUP BY asn
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return result.data.data.map((row) => ({ asn: Number(row.asn), count: Number(row.count) }));
}

export async function loadTLDRiskScores(hours: number = 24) {
  const result = await query(`
    SELECT blob6 as tld, AVG(double6) as avg_risk, SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilter(hours)}
    GROUP BY tld
    ORDER BY avg_risk DESC
    LIMIT 10
  `, hours);
  return result.data.data.map((row) => ({ tld: String(row.tld), avgRisk: Number(row.avg_risk), count: Number(row.count) }));
}

export async function loadDomainReputation(hours: number = 24) {
  const result = await query(`
    SELECT blob5 as domain, AVG(double7) as avg_reputation, SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilter(hours)}
    GROUP BY domain
    ORDER BY avg_reputation DESC
    LIMIT 10
  `, hours);
  return result.data.data.map((row) => ({ domain: String(row.domain), avgReputation: Number(row.avg_reputation), count: Number(row.count) }));
}

export async function loadPatternConfidence(hours: number = 24) {
  const result = await query(`
    SELECT 
      CASE 
        WHEN double8 < 0.2 THEN '0-20%'
        WHEN double8 < 0.4 THEN '20-40%'
        WHEN double8 < 0.6 THEN '40-60%'
        WHEN double8 < 0.8 THEN '60-80%'
        ELSE '80-100%'
      END as confidence_range,
      SUM(_sample_interval) as count
    FROM ANALYTICS
    ${buildTimeFilter(hours)}
    GROUP BY confidence_range
    ORDER BY confidence_range
  `, hours);
  return result.data.data.map((row) => ({ range: String(row.confidence_range), count: Number(row.count) }));
}
