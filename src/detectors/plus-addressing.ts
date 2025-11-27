/**
 * Plus-Addressing Normalizer
 *
 * Handles email address normalization to detect abuse of plus-addressing (RFC 5233)
 * and provider-specific aliasing features.
 *
 * Examples of abuse:
 * - user+1@gmail.com, user+2@gmail.com, user+3@gmail.com
 * - All go to the same inbox but appear as different emails
 *
 * Also handles Gmail's dot-ignoring:
 * - person1.person2@gmail.com = person1person2@gmail.com
 */

export interface NormalizedEmailResult {
  original: string;
  normalized: string;      // base@domain.com
  hasPlus: boolean;
  plusTag: string | null;  // the "+tag" part
  providerNormalized: string; // Provider-specific normalization (e.g., Gmail dots)
  metadata?: {
    provider: string;
    dotsRemoved: number;
    suspiciousTag: boolean; // Tags like "+1", "+test", "+spam"
  };
}

// Providers that support plus-addressing
const PLUS_ADDRESSING_PROVIDERS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'protonmail.com',
  'proton.me',
  'fastmail.com'
]);

// Gmail-like providers that ignore dots in local part
const DOT_IGNORING_PROVIDERS = new Set([
  'gmail.com',
  'googlemail.com'
]);

/**
 * Normalize an email address by removing plus-addressing and provider-specific aliases
 */
export function normalizeEmail(email: string): NormalizedEmailResult {
  const original = email.toLowerCase().trim();
  const [localPart, domain] = original.split('@');

  if (!localPart || !domain) {
    return {
      original,
      normalized: original,
      hasPlus: false,
      plusTag: null,
      providerNormalized: original
    };
  }

  // Step 1: Handle plus-addressing
  let normalizedLocal = localPart;
  let hasPlus = false;
  let plusTag: string | null = null;

  const plusIndex = localPart.indexOf('+');
  if (plusIndex !== -1) {
    hasPlus = true;
    plusTag = localPart.substring(plusIndex + 1);
    normalizedLocal = localPart.substring(0, plusIndex);
  }

  const normalized = `${normalizedLocal}@${domain}`;

  // Step 2: Provider-specific normalization
  let providerNormalized = normalized;
  let dotsRemoved = 0;

  if (DOT_IGNORING_PROVIDERS.has(domain)) {
    // Gmail ignores dots in the local part
    const withoutDots = normalizedLocal.replace(/\./g, '');
    dotsRemoved = normalizedLocal.length - withoutDots.length;
    providerNormalized = `${withoutDots}@${domain}`;
  }

  // Step 3: Analyze the plus tag for suspicious patterns
  const suspiciousTag = isSuspiciousPlusTag(plusTag);

  return {
    original,
    normalized,
    hasPlus,
    plusTag,
    providerNormalized,
    metadata: {
      provider: domain,
      dotsRemoved,
      suspiciousTag
    }
  };
}

/**
 * Detect if a plus tag looks suspicious (sequential, test-related, etc.)
 */
function isSuspiciousPlusTag(tag: string | null): boolean {
  if (!tag) return false;

  const lowerTag = tag.toLowerCase();

  // Numeric tags (especially sequential)
  if (/^\d+$/.test(tag)) {
    return true;
  }

  // Common test/spam tags
  const suspiciousKeywords = [
    'test', 'spam', 'temp', 'fake', 'trash', 'junk',
    'disposable', 'throwaway', 'burner', 'trial'
  ];

  return suspiciousKeywords.some(keyword => lowerTag.includes(keyword));
}

/**
 * Batch analysis: detect if multiple emails are aliases of the same normalized address
 */
export function detectPlusAddressingAbuse(emails: string[]): {
  hasAbuse: boolean;
  normalizedGroups: Map<string, string[]>; // normalized -> original emails
  largestGroup: {
    normalized: string;
    variants: string[];
    count: number;
  } | null;
  confidence: number;
} {
  const groups = new Map<string, string[]>();

  // Group emails by their provider-normalized form
  for (const email of emails) {
    const result = normalizeEmail(email);
    const key = result.providerNormalized;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(email);
  }

  // Find the largest group
  let largestGroup: { normalized: string; variants: string[]; count: number } | null = null;
  let maxCount = 0;

  for (const [normalized, variants] of groups.entries()) {
    if (variants.length > maxCount) {
      maxCount = variants.length;
      largestGroup = {
        normalized,
        variants,
        count: variants.length
      };
    }
  }

  // Consider it abuse if we have 3+ variants of the same address
  const hasAbuse = maxCount >= 3;

  // Confidence increases with more variants
  // 3 variants: 0.7, 4 variants: 0.8, 5+ variants: 0.9+
  let confidence = 0.0;
  if (maxCount >= 3) {
    confidence = 0.6 + (maxCount * 0.1);
    confidence = Math.min(confidence, 1.0);
  }

  return {
    hasAbuse,
    normalizedGroups: groups,
    largestGroup,
    confidence
  };
}

/**
 * Check if an email provider supports plus-addressing
 */
export function supportsPlusAddressing(domain: string): boolean {
  return PLUS_ADDRESSING_PROVIDERS.has(domain.toLowerCase());
}

/**
 * Extract pattern from plus tags to detect sequential abuse
 * Example: user+1, user+2, user+3 → sequential pattern detected
 */
export function analyzePlusTagPattern(emails: string[]): {
  hasPattern: boolean;
  patternType: 'sequential' | 'dated' | 'keyword' | 'none';
  confidence: number;
  tags: string[];
} {
  const tags: string[] = [];

  for (const email of emails) {
    const result = normalizeEmail(email);
    if (result.plusTag) {
      tags.push(result.plusTag);
    }
  }

  if (tags.length < 2) {
    return {
      hasPattern: false,
      patternType: 'none',
      confidence: 0.0,
      tags
    };
  }

  // Check for sequential numbers
  const numericTags = tags.filter(tag => /^\d+$/.test(tag)).map(tag => parseInt(tag, 10));
  if (numericTags.length >= 2) {
    // Check if sequential or close together
    const sorted = numericTags.sort((a, b) => a - b);
    let isSequential = true;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] > 5) {
        // Allow small gaps
        isSequential = false;
        break;
      }
    }

    if (isSequential) {
      return {
        hasPattern: true,
        patternType: 'sequential',
        confidence: 0.85,
        tags
      };
    }
  }

  // Check for dated patterns (2024, jan, oct2024, etc.)
  const hasDatePatterns = tags.some(tag => {
    return /20\d{2}/.test(tag) || // Year
           /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(tag); // Month
  });

  if (hasDatePatterns) {
    return {
      hasPattern: true,
      patternType: 'dated',
      confidence: 0.75,
      tags
    };
  }

  // Check for repeated keywords
  const uniqueTags = new Set(tags.map(t => t.toLowerCase()));
  if (uniqueTags.size === 1 && tags.length >= 3) {
    // Same tag repeated multiple times
    return {
      hasPattern: true,
      patternType: 'keyword',
      confidence: 0.8,
      tags
    };
  }

  return {
    hasPattern: false,
    patternType: 'none',
    confidence: 0.0,
    tags
  };
}

/**
 * Get a canonical email address for deduplication
 * This is the most normalized form possible
 */
export function getCanonicalEmail(email: string): string {
  const result = normalizeEmail(email);
  return result.providerNormalized;
}

/**
 * Check if two emails are actually the same after normalization
 */
export function areEmailsEquivalent(email1: string, email2: string): boolean {
  return getCanonicalEmail(email1) === getCanonicalEmail(email2);
}

/**
 * Risk score contribution from plus-addressing analysis
 * Returns 0.0-1.0 based on how suspicious the plus-addressing usage is
 */
export function getPlusAddressingRiskScore(email: string, relatedEmails?: string[]): number {
  const result = normalizeEmail(email);

  let risk = 0.0;

  if (result.hasPlus) {
    // Base contribution for any plus-addressing usage
    risk += 0.2;

    // Factor 1: Suspicious plus tag keywords or numeric-only tags
    if (result.metadata?.suspiciousTag) {
      risk += 0.3;
    }
  }

  // Factor 3: Multiple related emails using same base
  if (relatedEmails && relatedEmails.length > 0) {
    const abuseAnalysis = detectPlusAddressingAbuse([email, ...relatedEmails]);
    if (abuseAnalysis.hasAbuse) {
      risk += 0.4;
    }
  }

  return Math.min(risk, 1.0);
}
