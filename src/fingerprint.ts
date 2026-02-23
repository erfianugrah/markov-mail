import type { Fingerprint } from './types';

/**
 * Generate a composite fingerprint from request data
 */
export async function generateFingerprint(request: Request): Promise<Fingerprint> {
  const headers = request.headers;
  const cf = (request as any).cf || {};

  // Extract key signals
  const ip = headers.get('cf-connecting-ip') ?? '';
  const ja4 = headers.get('cf-ja4') ?? cf.botManagement?.ja4 ?? '';
  const ja3 = headers.get('cf-ja3-hash') ?? cf.botManagement?.ja3Hash ?? '';
  const userAgent = headers.get('user-agent') ?? '';
  const country = headers.get('cf-ipcountry') ?? cf.country ?? '';
  const asnHeader = headers.get('cf-asn');
  const asn = cf.asn ?? (asnHeader ? parseInt(asnHeader, 10) : 0);
  const asOrg = cf.asOrganization ?? headers.get('cf-as-organization') ?? '';
  // Cloudflare Bot Management scores range 1 (bot) to 99 (human).
  // Without the Enterprise Bot Management add-on the score is always 0
  // ("not computed") or 1 ("automated" per basic Bot Fight Mode, which
  // flags ALL non-browser traffic including legitimate API consumers).
  // Scores ≤ 1 are unreliable for fraud heuristics — treat as undefined
  // so downstream rules skip the check instead of blocking every curl/API call.
  const botScoreHeader = headers.get('cf-bot-score');
  const parsedBotScore = botScoreHeader !== null ? parseInt(botScoreHeader, 10) : NaN;
  const rawBotScore = Number.isFinite(parsedBotScore) ? parsedBotScore : (cf.botManagement?.score ?? undefined);
  const botScore = (rawBotScore !== undefined && rawBotScore > 1) ? rawBotScore : undefined;
  const deviceType = headers.get('cf-device-type') ?? cf.deviceType ?? '';

  // Create composite fingerprint string (use 0 for undefined botScore to keep hashes stable)
  const fingerprintString = `${ip}:${ja4}:${asn}:${deviceType}:${botScore ?? 0}`;

  // Generate SHA-256 hash
  const hash = await hashString(fingerprintString);

  return {
    hash,
    ip,
    ja4,
    ja3,
    userAgent,
    country,
    asn,
    asOrg,
    botScore,
    deviceType,
  };
}

/**
 * Hash a string using SHA-256
 */
async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extract all available signals from request for logging/debugging
 */
export function extractAllSignals(request: Request) {
  const headers = request.headers;
  const cf = (request as any).cf || {};

  return {
    // Basic headers
    ip: headers.get('cf-connecting-ip'),
    userAgent: headers.get('user-agent'),
    acceptLanguage: headers.get('accept-language'),

    // Cloudflare headers
    ray: headers.get('cf-ray'),
    country: headers.get('cf-ipcountry'),
    region: headers.get('cf-region'),
    city: headers.get('cf-ipcity'),
    timezone: headers.get('cf-timezone'),
    postalCode: headers.get('cf-postal-code'),
    deviceType: headers.get('cf-device-type'),

    // Bot detection
    botScore: headers.get('cf-bot-score'),
    verifiedBot: headers.get('cf-verified-bot'),
    ja4: headers.get('cf-ja4'),
    ja3Hash: headers.get('cf-ja3-hash'),

    // From cf object (if available)
    cfData: {
      asn: cf.asn,
      asOrganization: cf.asOrganization,
      colo: cf.colo,
      httpProtocol: cf.httpProtocol,
      tlsVersion: cf.tlsVersion,
      tlsCipher: cf.tlsCipher,
      clientTcpRtt: cf.clientTcpRtt,
      botManagement: cf.botManagement ? {
        score: cf.botManagement.score,
        verifiedBot: cf.botManagement.verifiedBot,
        staticResource: cf.botManagement.staticResource,
        ja4: cf.botManagement.ja4,
        ja4Signals: cf.botManagement.ja4Signals,
      } : null,
    },
  };
}
