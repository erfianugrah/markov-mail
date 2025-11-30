/**
 * MX record resolver backed by Cloudflare's DNS-over-HTTPS endpoint.
 */

export interface MXRecordInfo {
	preference: number;
	exchange: string;
}

export type MXProvider =
	| 'google'
	| 'microsoft'
	| 'icloud'
	| 'yahoo'
	| 'zoho'
	| 'proton'
	| 'self_hosted'
	| 'other';

export interface MXAnalysis {
	hasRecords: boolean;
	recordCount: number;
	records: MXRecordInfo[];
	primaryProvider: MXProvider | null;
	providerHits: Record<MXProvider, number>;
	ttl?: number;
	failure?: string;
}

type DNSJsonAnswer = {
	data: string;
	name: string;
	TTL?: number;
};

type DNSJsonResponse = {
	Status: number;
	Answer?: DNSJsonAnswer[];
	Authority?: DNSJsonAnswer[];
};

const CF_DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_FETCH_DURATION_MS = 500;

const MX_CACHE = new Map<string, { timestamp: number; result: MXAnalysis }>();
const MX_INFLIGHT = new Map<string, Promise<MXAnalysis>>();

const PROVIDER_MATCHERS: Record<MXProvider, RegExp[]> = {
	google: [/\.googlemail\.com\.?$/i, /\.l\.google\.com\.?$/i],
	microsoft: [/\.mail\.protection\.outlook\.com\.?$/i, /\.outlook\.com\.?$/i, /\.office365\.com\.?$/i],
	icloud: [/\.icloud\.com\.?$/i, /\.me\.com\.?$/i],
	yahoo: [/\.yahoodns\.net\.?$/i, /\.yahoomail\.com\.?$/i],
	zoho: [/\.zoho(mail|email)\.com\.?$/i, /\.mx\.zoho\.com\.?$/i],
	proton: [/\.protonmail\.ch\.?$/i, /\.protonmail\.com\.?$/i],
	self_hosted: [],
	other: [],
};

function classifyProvider(exchange: string, domain: string): MXProvider {
  const normalized = exchange.toLowerCase().replace(/\.$/, '');
  const domainNormalized = domain.toLowerCase();

	if (normalized.endsWith(domainNormalized)) {
		return 'self_hosted';
	}

	for (const provider of Object.keys(PROVIDER_MATCHERS) as MXProvider[]) {
		if (provider === 'self_hosted' || provider === 'other') continue;
		const matchers = PROVIDER_MATCHERS[provider];
		if (matchers.some((regex) => regex.test(normalized))) {
			return provider;
		}
	}

	return 'other';
}

function parseMXAnswer(answer: DNSJsonAnswer): MXRecordInfo | null {
  const match = answer.data.match(/^(\d+)\s+(.+)$/);
  if (!match) {
    return null;
  }

	const preference = Number(match[1]);
	const exchange = match[2].replace(/\.$/, '');

	return {
		preference,
		exchange,
	};
}

function createEmptyAnalysis(failure?: string): MXAnalysis {
  return {
    hasRecords: false,
    recordCount: 0,
    records: [],
    primaryProvider: null,
    providerHits: {
      google: 0,
      microsoft: 0,
      icloud: 0,
      yahoo: 0,
      zoho: 0,
      proton: 0,
      self_hosted: 0,
      other: 0,
    },
    failure,
  };
}

async function fetchMXRecords(domain: string): Promise<MXAnalysis> {
  const url = `${CF_DOH_ENDPOINT}?name=${encodeURIComponent(domain)}&type=MX`;
  let response: Response;

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timeout = controller ? setTimeout(() => controller.abort(), MAX_FETCH_DURATION_MS) : undefined;

    try {
      response = await fetch(url, {
      headers: {
        accept: 'application/dns-json',
        'cache-control': 'no-cache',
      },
        signal: controller?.signal,
      });
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  } catch (error) {
    return createEmptyAnalysis(error instanceof Error ? error.message : String(error));
  }

  if (!response.ok) {
    return createEmptyAnalysis(`HTTP ${response.status}`);
  }

  let json: DNSJsonResponse;
  try {
    json = (await response.json()) as DNSJsonResponse;
  } catch (error) {
    return createEmptyAnalysis(error instanceof Error ? error.message : String(error));
  }

  if (json.Status !== 0 || !json.Answer) {
    return createEmptyAnalysis(json.Status === 0 ? undefined : `DNS Status ${json.Status}`);
  }

	const records: MXRecordInfo[] = [];
	let ttl: number | undefined;
	for (const answer of json.Answer) {
		const parsed = parseMXAnswer(answer);
		if (parsed) {
			records.push(parsed);
			if (typeof answer.TTL === 'number') {
				ttl = answer.TTL;
			}
		}
	}

  if (!records.length) {
    return { ...createEmptyAnalysis(), ttl };
  }

	const providerHits: Record<MXProvider, number> = {
		google: 0,
		microsoft: 0,
		icloud: 0,
		yahoo: 0,
		zoho: 0,
		proton: 0,
		self_hosted: 0,
		other: 0,
	};
	let primaryProvider: MXProvider | null = null;
	let highestScore = -1;

	for (const record of records) {
		const provider = classifyProvider(record.exchange, domain);
		providerHits[provider] = (providerHits[provider] ?? 0) + 1;
		if (providerHits[provider] > highestScore) {
			primaryProvider = provider;
			highestScore = providerHits[provider];
		}
	}

	return {
		hasRecords: true,
		recordCount: records.length,
		records,
		primaryProvider,
		providerHits,
		ttl,
	};
}

export async function resolveMXRecords(domain: string): Promise<MXAnalysis> {
  const key = domain.toLowerCase();
  const cached = MX_CACHE.get(key);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  if (MX_INFLIGHT.has(key)) {
    return MX_INFLIGHT.get(key)!;
  }

  const promise = (async () => {
    try {
      const result = await fetchMXRecords(key);
      MX_CACHE.set(key, { timestamp: Date.now(), result });
      return result;
    } finally {
      MX_INFLIGHT.delete(key);
    }
  })().catch((error) => {
    MX_INFLIGHT.delete(key);
    return createEmptyAnalysis(error instanceof Error ? error.message : String(error));
  });

  MX_INFLIGHT.set(key, promise);
  return promise;
}

export function getCachedMXRecords(domain: string): MXAnalysis | null {
  const cached = MX_CACHE.get(domain.toLowerCase());
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    MX_CACHE.delete(domain.toLowerCase());
    return null;
  }
  return cached.result;
}

export function __resetMXCacheForTests() {
  MX_CACHE.clear();
  MX_INFLIGHT.clear();
}
