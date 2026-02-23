import {
  isDisposableDomain as isDisposableDomainFallback,
  matchesDisposablePattern,
  isFreeEmailProvider,
} from '../data/disposable-domains';

export interface DomainValidationResult {
  valid: boolean;
  isDisposable: boolean;
  isFreeProvider: boolean;
  matchesDisposablePattern: boolean;
  reason?: string;
  signals: {
    domainLength: number;
    hasValidTLD: boolean;
    subdomainDepth: number;
  };
}

/**
 * Check if a domain is disposable using provided set or fallback
 */
function isDisposableDomain(domain: string, disposableDomains?: Set<string>): boolean {
  const normalizedDomain = domain.toLowerCase().trim();

  // Use KV-loaded list if available, otherwise fallback to hardcoded
  if (disposableDomains && disposableDomains.size > 0) {
    return disposableDomains.has(normalizedDomain);
  }

  return isDisposableDomainFallback(normalizedDomain);
}

/**
 * Validate domain and check for disposable/suspicious patterns
 *
 * @param domain - Domain to validate
 * @param disposableDomains - Optional Set of disposable domains from KV (falls back to hardcoded if not provided)
 */
export function validateDomain(domain: string, disposableDomains?: Set<string>): DomainValidationResult {
  const normalizedDomain = domain.toLowerCase().trim();

  // Basic validation
  if (!normalizedDomain || normalizedDomain.length === 0) {
    return {
      valid: false,
      isDisposable: false,
      isFreeProvider: false,
      matchesDisposablePattern: false,
      reason: 'Empty domain',
      signals: {
        domainLength: 0,
        hasValidTLD: false,
        subdomainDepth: 0,
      },
    };
  }

  // Check domain length
  if (normalizedDomain.length > 255) {
    return {
      valid: false,
      isDisposable: false,
      isFreeProvider: false,
      matchesDisposablePattern: false,
      reason: 'Domain too long',
      signals: {
        domainLength: normalizedDomain.length,
        hasValidTLD: false,
        subdomainDepth: 0,
      },
    };
  }

  // Check for valid structure
  const parts = normalizedDomain.split('.');
  const subdomainDepth = parts.length - 2; // example.com = 0, sub.example.com = 1

  // Must have at least domain + TLD
  if (parts.length < 2) {
    return {
      valid: false,
      isDisposable: false,
      isFreeProvider: false,
      matchesDisposablePattern: false,
      reason: 'Invalid domain structure',
      signals: {
        domainLength: normalizedDomain.length,
        hasValidTLD: false,
        subdomainDepth: 0,
      },
    };
  }

  // Check TLD
  const tld = parts[parts.length - 1];
  const hasValidTLD = tld.length >= 2 && /^[a-z]+$/.test(tld);

  if (!hasValidTLD) {
    return {
      valid: false,
      isDisposable: false,
      isFreeProvider: false,
      matchesDisposablePattern: false,
      reason: 'Invalid TLD',
      signals: {
        domainLength: normalizedDomain.length,
        hasValidTLD: false,
        subdomainDepth,
      },
    };
  }

  // Check against disposable list
  const isDisposableExact = isDisposableDomain(normalizedDomain, disposableDomains);
  const matchesPattern = matchesDisposablePattern(normalizedDomain);
  const isFree = isFreeEmailProvider(normalizedDomain);

  // Determine if disposable
  const isDisposableResult = isDisposableExact || matchesPattern;

  const result: DomainValidationResult = {
    valid: !isDisposableResult, // Invalid if disposable
    isDisposable: isDisposableResult,
    isFreeProvider: isFree,
    matchesDisposablePattern: matchesPattern,
    signals: {
      domainLength: normalizedDomain.length,
      hasValidTLD,
      subdomainDepth,
    },
  };

  if (isDisposableExact) {
    result.reason = 'Known disposable email domain';
  } else if (matchesPattern) {
    result.reason = 'Domain matches disposable pattern';
  }

  return result;
}

/**
 * Check if domain has suspicious characteristics
 */
export function isDomainSuspicious(domain: string): {
  suspicious: boolean;
  reasons: string[];
} {
  const normalizedDomain = domain.toLowerCase().trim();
  const reasons: string[] = [];

  // Check for very long domains (often spam)
  if (normalizedDomain.length > 50) {
    reasons.push('Domain excessively long');
  }

  // Check for many subdomains (often temporary services)
  const subdomainDepth = normalizedDomain.split('.').length - 2;
  if (subdomainDepth > 3) {
    reasons.push('Too many subdomains');
  }

  // Check for numeric-only domain name
  const domainName = normalizedDomain.split('.')[0];
  if (/^\d+$/.test(domainName)) {
    reasons.push('Domain name is all numbers');
  }

  // Check for very short domain (< 3 chars before TLD)
  if (domainName.length < 3) {
    reasons.push('Domain name too short');
  }

  // Check for excessive hyphens
  const hyphenCount = (domainName.match(/-/g) || []).length;
  if (hyphenCount > 3) {
    reasons.push('Too many hyphens in domain');
  }

  // Check for random-looking domain
  const hasOnlyConsonants = /^[bcdfghjklmnpqrstvwxyz]+$/.test(domainName);
  if (hasOnlyConsonants && domainName.length > 5) {
    reasons.push('Domain appears random (no vowels)');
  }

  return {
    suspicious: reasons.length > 0,
    reasons,
  };
}

/**
 * Get domain reputation score (0.0 = trusted, 1.0 = suspicious)
 *
 * This uses a tiered approach to handle diverse fraud patterns:
 * - Disposable domains (1.0) - Block immediately
 * - Sketchy free providers (0.6) - Higher scrutiny (mail.com, gmx.com, email.com)
 * - Trusted providers (0.1) - Lower scrutiny (gmail.com, outlook.com, icloud.com)
 * - Unknown/Corporate (0.3) - Neutral default
 *
 * @param domain - Domain to score
 * @param disposableDomains - Optional Set of disposable domains from KV (falls back to hardcoded if not provided)
 */
export function getDomainReputationScore(domain: string, disposableDomains?: Set<string>): number {
  const normalizedDomain = domain.toLowerCase().trim();
  const validation = validateDomain(normalizedDomain, disposableDomains);

  // 1. Known Disposable (Block immediately via other checks, scored 1.0)
  if (validation.isDisposable) {
    return 1.0;
  }

  // 2. "Sketchy" Free Providers - Currently suffering high bot abuse
  const sketchyProviders = [
    'mail.com',
    'email.com',
    'gmx.com',
    'gmx.de',
    'gmx.net',
    'yandex.com',
    'yandex.ru'
  ];
  if (sketchyProviders.includes(normalizedDomain)) {
    return 0.6; // High scrutiny
  }

  // 3. Privacy-focused providers - Legitimate services with strong verification
  const privacyProviders = [
    'proton.me',
    'protonmail.com',
    'pm.me',
    'tutanota.com',
    'tuta.com',
    'tuta.io'
  ];
  if (privacyProviders.includes(normalizedDomain)) {
    return 0.3; // Moderate scrutiny - neutral baseline
  }

  // 4. Trusted Free Providers - High friction signup, better abuse prevention
  const trustedProviders = [
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'icloud.com',
    'yahoo.com',
    'yahoo.co.uk',
    'yahoo.co.jp',
    'aol.com'
  ];
  if (trustedProviders.includes(normalizedDomain)) {
    return 0.1; // Low scrutiny
  }

  // 5. Suspicious characteristics add to base score
  const suspicious = isDomainSuspicious(normalizedDomain);
  let suspicionScore = 0.0;

  if (suspicious.suspicious) {
    suspicionScore += 0.1 * suspicious.reasons.length;
  }

  // Subdomain depth (more subdomains = more suspicious)
  if (validation.signals.subdomainDepth > 2) {
    suspicionScore += 0.1 * validation.signals.subdomainDepth;
  }

  // 6. Default neutral for corporate/ISP domains + suspicion adjustments
  return Math.min(0.3 + suspicionScore, 1.0);
}
