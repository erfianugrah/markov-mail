/**
 * API Client for D1 Database queries
 * MIGRATION NOTE: Updated from Analytics Engine to D1
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
  data: Array<Record<string, string | number>>;
  rows?: number;
}

// Helper to build time filter WHERE clause (D1/SQLite syntax)
function buildTimeFilter(hours: number): string {
  // For "all time", query last 6 months
  return hours === 0
    ? `WHERE timestamp >= datetime('now', '-180 days')`
    : `WHERE timestamp >= datetime('now', '-${hours} hours')`;
}

// Helper to build time filter for queries with additional AND conditions
function buildTimeFilterWith(hours: number, condition: string): string {
  if (hours === 0) {
    // For "all time", query last 6 months
    return `WHERE timestamp >= datetime('now', '-180 days') AND ${condition}`;
  }
  return `WHERE timestamp >= datetime('now', '-${hours} hours') AND ${condition}`;
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
  // Get counts by decision type (D1 syntax)
  const decisionsResult = await query(`
    SELECT
      decision,
      COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY decision
  `, hours);

  // Get averages separately
  const avgsResult = await query(`
    SELECT
      AVG(risk_score) as avg_risk,
      AVG(latency) as avg_latency
    FROM validations
    ${buildTimeFilter(hours)}
  `, hours);

  // Calculate totals by decision
  let blocks = 0;
  let warns = 0;
  let allows = 0;

  if (decisionsResult.data) {
    decisionsResult.data.forEach((row) => {
      const decision = String(row.decision);
      const count = Number(row.count);

      if (decision === 'block') blocks = count;
      else if (decision === 'warn') warns = count;
      else if (decision === 'allow') allows = count;
    });
  }

  const total = blocks + warns + allows || 1;
  const avgRow = avgsResult.data?.[0] || {};

  return {
    totalValidations: total,
    totalBlocks: blocks,
    totalWarns: warns,
    totalAllows: allows,
    blockRate: (blocks / total) * 100,
    warnRate: (warns / total) * 100,
    avgRiskScore: Number(avgRow.avg_risk) || 0,
    avgLatency: Number(avgRow.avg_latency) || 0,
  };
}

export async function loadDecisions(hours: number = 24) {
  const result = await query(`
    SELECT
      decision,
      COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY decision
    ORDER BY count DESC
  `, hours);

  return (result.data || []).map((row) => ({
    decision: String(row.decision),
    count: Number(row.count),
  }));
}

export async function loadRiskDistribution(hours: number = 24) {
  const result = await query(`
    SELECT
      CASE
        WHEN risk_score < 0.2 THEN 'very_low'
        WHEN risk_score < 0.4 THEN 'low'
        WHEN risk_score < 0.6 THEN 'medium'
        WHEN risk_score < 0.8 THEN 'high'
        ELSE 'very_high'
      END as risk_bucket,
      COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY risk_bucket
    ORDER BY risk_bucket
  `, hours);

  return (result.data || []).map((row) => ({
    riskBucket: String(row.risk_bucket),
    count: Number(row.count),
  }));
}

export async function loadTimeline(hours: number = 24) {
  const result = await query(`
    SELECT
      strftime('%Y-%m-%d %H:00:00', timestamp) as hour,
      decision,
      COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY hour, decision
    ORDER BY hour ASC
  `, hours);

  // Transform data for Recharts
  const grouped = new Map<string, Record<string, number | string>>();

  if (result.data) {
    result.data.forEach((row) => {
      const hour = String(row.hour);
      const decision = String(row.decision);
      const count = Number(row.count);

      if (!grouped.has(hour)) {
        grouped.set(hour, { hour });
      }

      const entry = grouped.get(hour)!;
      entry[decision] = count;
    });
  }

  return Array.from(grouped.values());
}

// Additional chart data loaders
export async function loadCountries(hours: number = 24) {
  const result = await query(`
    SELECT country, COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY country
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return (result.data || []).map((row) => ({ country: String(row.country), count: Number(row.count) }));
}

export async function loadPatternTypes(hours: number = 24) {
  const result = await query(`
    SELECT
      pattern_type,
      pattern_classification_version,
      COUNT(*) as count
    FROM validations
    ${buildTimeFilterWith(hours, "pattern_type IS NOT NULL AND pattern_type != 'none'")}
    GROUP BY pattern_type, pattern_classification_version
    ORDER BY count DESC
    LIMIT 20
  `, hours);
  return (result.data || []).map((row) => ({
    patternType: String(row.pattern_type),
    version: String(row.pattern_classification_version || 'unknown'),
    count: Number(row.count)
  }));
}

export async function loadBlockReasons(hours: number = 24) {
  const result = await query(`
    SELECT
      block_reason,
      pattern_classification_version,
      COUNT(*) as count
    FROM validations
    ${buildTimeFilterWith(hours, "decision = 'block' AND block_reason IS NOT NULL")}
    GROUP BY block_reason, pattern_classification_version
    ORDER BY count DESC
    LIMIT 20
  `, hours);
  return (result.data || []).map((row) => ({
    reason: String(row.block_reason),
    version: String(row.pattern_classification_version || 'unknown'),
    count: Number(row.count)
  }));
}

export async function loadDomains(hours: number = 24) {
  const result = await query(`
    SELECT domain, COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY domain
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return (result.data || []).map((row) => ({ domain: String(row.domain), count: Number(row.count) }));
}

export async function loadTLDs(hours: number = 24) {
  const result = await query(`
    SELECT tld, COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY tld
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return (result.data || []).map((row) => ({ tld: String(row.tld), count: Number(row.count) }));
}

export async function loadPatternFamilies(hours: number = 24) {
  const result = await query(`
    SELECT pattern_family, COUNT(*) as count
    FROM validations
    ${buildTimeFilterWith(hours, "pattern_family IS NOT NULL AND pattern_family != 'none'")}
    GROUP BY pattern_family
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return (result.data || []).map((row) => ({ family: String(row.pattern_family), count: Number(row.count) }));
}

export async function loadDisposableDomains(hours: number = 24) {
  const result = await query(`
    SELECT domain, COUNT(*) as count
    FROM validations
    ${buildTimeFilterWith(hours, "is_disposable = 1")}
    GROUP BY domain
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return (result.data || []).map((row) => ({ domain: String(row.domain), count: Number(row.count) }));
}

export async function loadFreeProviders(hours: number = 24) {
  const result = await query(`
    SELECT domain, COUNT(*) as count
    FROM validations
    ${buildTimeFilterWith(hours, "is_free_provider = 1")}
    GROUP BY domain
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return (result.data || []).map((row) => ({ domain: String(row.domain), count: Number(row.count) }));
}

export async function loadPlusAddressing(hours: number = 24) {
  const result = await query(`
    SELECT domain, COUNT(*) as count
    FROM validations
    ${buildTimeFilterWith(hours, "has_plus_addressing = 1")}
    GROUP BY domain
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return (result.data || []).map((row) => ({ domain: String(row.domain), count: Number(row.count) }));
}

export async function loadKeyboardWalks(hours: number = 24) {
  const result = await query(`
    SELECT has_keyboard_walk, COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY has_keyboard_walk
    ORDER BY count DESC
  `, hours);
  return (result.data || []).map((row) => ({ hasWalk: Number(row.has_keyboard_walk), count: Number(row.count) }));
}

export async function loadGibberish(hours: number = 24) {
  const result = await query(`
    SELECT is_gibberish, COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY is_gibberish
    ORDER BY count DESC
  `, hours);
  return (result.data || []).map((row) => ({ isGibberish: String(row.is_gibberish), count: Number(row.count) }));
}

export async function loadEntropyScores(hours: number = 24) {
  const result = await query(`
    SELECT entropy_score, COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY entropy_score
    ORDER BY entropy_score
  `, hours);

  // Bucket the scores client-side (0.0-1.0 range, buckets of 0.1)
  const buckets = new Map<string, number>([
    ['0.0-0.1', 0],
    ['0.1-0.2', 0],
    ['0.2-0.3', 0],
    ['0.3-0.4', 0],
    ['0.4-0.5', 0],
    ['0.5-0.6', 0],
    ['0.6-0.7', 0],
    ['0.7-0.8', 0],
    ['0.8-0.9', 0],
    ['0.9-1.0', 0],
  ]);

  if (result.data) {
    result.data.forEach((row) => {
      const score = Number(row.entropy_score);
      const count = Number(row.count);

      if (score < 0.1) buckets.set('0.0-0.1', buckets.get('0.0-0.1')! + count);
      else if (score < 0.2) buckets.set('0.1-0.2', buckets.get('0.1-0.2')! + count);
      else if (score < 0.3) buckets.set('0.2-0.3', buckets.get('0.2-0.3')! + count);
      else if (score < 0.4) buckets.set('0.3-0.4', buckets.get('0.3-0.4')! + count);
      else if (score < 0.5) buckets.set('0.4-0.5', buckets.get('0.4-0.5')! + count);
      else if (score < 0.6) buckets.set('0.5-0.6', buckets.get('0.5-0.6')! + count);
      else if (score < 0.7) buckets.set('0.6-0.7', buckets.get('0.6-0.7')! + count);
      else if (score < 0.8) buckets.set('0.7-0.8', buckets.get('0.7-0.8')! + count);
      else if (score < 0.9) buckets.set('0.8-0.9', buckets.get('0.8-0.9')! + count);
      else buckets.set('0.9-1.0', buckets.get('0.9-1.0')! + count);
    });
  }

  return Array.from(buckets.entries()).map(([bucket, count]) => ({ bucket, count }));
}

export async function loadBotScores(hours: number = 24) {
  const result = await query(`
    SELECT bot_score, COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY bot_score
    ORDER BY bot_score
  `, hours);

  // Bucket the scores client-side
  const buckets = new Map<string, number>([
    ['0-30', 0],
    ['30-50', 0],
    ['50-70', 0],
    ['70-90', 0],
    ['90-100', 0],
  ]);

  if (result.data) {
    result.data.forEach((row) => {
      const score = Number(row.bot_score);
      const count = Number(row.count);

      if (score < 30) buckets.set('0-30', buckets.get('0-30')! + count);
      else if (score < 50) buckets.set('30-50', buckets.get('30-50')! + count);
      else if (score < 70) buckets.set('50-70', buckets.get('50-70')! + count);
      else if (score < 90) buckets.set('70-90', buckets.get('70-90')! + count);
      else buckets.set('90-100', buckets.get('90-100')! + count);
    });
  }

  return Array.from(buckets.entries()).map(([range, count]) => ({ range, count }));
}

export async function loadLatencyDistribution(hours: number = 24) {
  const result = await query(`
    SELECT latency, COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY latency
    ORDER BY latency
  `, hours);

  // Bucket the latencies client-side
  const buckets = new Map<string, number>([
    ['0-10ms', 0],
    ['10-50ms', 0],
    ['50-100ms', 0],
    ['100-200ms', 0],
    ['200ms+', 0],
  ]);

  if (result.data) {
    result.data.forEach((row) => {
      const latency = Number(row.latency);
      const count = Number(row.count);

      if (latency < 10) buckets.set('0-10ms', buckets.get('0-10ms')! + count);
      else if (latency < 50) buckets.set('10-50ms', buckets.get('10-50ms')! + count);
      else if (latency < 100) buckets.set('50-100ms', buckets.get('50-100ms')! + count);
      else if (latency < 200) buckets.set('100-200ms', buckets.get('100-200ms')! + count);
      else buckets.set('200ms+', buckets.get('200ms+')! + count);
    });
  }

  return Array.from(buckets.entries()).map(([range, count]) => ({ range, count }));
}

export async function loadASNs(hours: number = 24) {
  const result = await query(`
    SELECT asn, COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY asn
    ORDER BY count DESC
    LIMIT 10
  `, hours);
  return (result.data || []).map((row) => ({ asn: Number(row.asn), count: Number(row.count) }));
}

export async function loadTLDRiskScores(hours: number = 24) {
  const result = await query(`
    SELECT
      tld,
      AVG(tld_risk_score) as avg_risk,
      COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY tld
    ORDER BY avg_risk DESC
    LIMIT 10
  `, hours);
  return (result.data || []).map((row) => ({ tld: String(row.tld), avgRisk: Number(row.avg_risk), count: Number(row.count) }));
}

export async function loadDomainReputation(hours: number = 24) {
  const result = await query(`
    SELECT
      domain,
      AVG(domain_reputation_score) as avg_reputation,
      COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY domain
    ORDER BY avg_reputation DESC
    LIMIT 10
  `, hours);
  return (result.data || []).map((row) => ({ domain: String(row.domain), avgReputation: Number(row.avg_reputation), count: Number(row.count) }));
}

export async function loadPatternConfidence(hours: number = 24) {
  const result = await query(`
    SELECT pattern_confidence, COUNT(*) as count
    FROM validations
    ${buildTimeFilter(hours)}
    GROUP BY pattern_confidence
    ORDER BY pattern_confidence
  `, hours);

  // Bucket the confidence scores client-side
  const buckets = new Map<string, number>([
    ['0-20%', 0],
    ['20-40%', 0],
    ['40-60%', 0],
    ['60-80%', 0],
    ['80-100%', 0],
  ]);

  if (result.data) {
    result.data.forEach((row) => {
      const confidence = Number(row.pattern_confidence);
      const count = Number(row.count);

      if (confidence < 0.2) buckets.set('0-20%', buckets.get('0-20%')! + count);
      else if (confidence < 0.4) buckets.set('20-40%', buckets.get('20-40%')! + count);
      else if (confidence < 0.6) buckets.set('40-60%', buckets.get('40-60%')! + count);
      else if (confidence < 0.8) buckets.set('60-80%', buckets.get('60-80%')! + count);
      else buckets.set('80-100%', buckets.get('80-100%')! + count);
    });
  }

  return Array.from(buckets.entries()).map(([range, count]) => ({ range, count }));
}
