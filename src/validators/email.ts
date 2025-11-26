import type { EmailValidationResult } from '../types';

/**
 * Basic email format validation using RFC 5322 simplified regex
 */
export function validateEmailFormat(email: string): boolean {
  // RFC 6531-compatible pattern (allows UTF-8 in local part and domain labels)
  const emailRegex = /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-]+@[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)*$/u;

  if (!emailRegex.test(email)) {
    return false;
  }

  // Additional checks
  const [localPart, domain] = email.split('@');

  // Local part shouldn't be empty or too long
  if (!localPart || localPart.length > 64) {
    return false;
  }

  // Domain shouldn't be empty or too long
  if (!domain || domain.length > 255) {
    return false;
  }

  // Domain should have at least one dot
  if (!domain.includes('.')) {
    return false;
  }

  // TLD should be at least 2 characters
  const tld = domain.split('.').pop();
  if (!tld || tld.length < 2) {
    return false;
  }

  return true;
}

/**
 * Calculate Shannon entropy to detect random strings
 * Higher entropy = more random (suspicious)
 */
export function calculateEntropy(str: string): number {
  const len = str.length;
  const frequencies: Record<string, number> = {};

  // Count character frequencies
  for (let i = 0; i < len; i++) {
    const char = str.charAt(i);
    frequencies[char] = (frequencies[char] || 0) + 1;
  }

  // Calculate Shannon entropy
  let entropy = 0;
  for (const char in frequencies) {
    const probability = frequencies[char] / len;
    entropy -= probability * Math.log2(probability);
  }

  // Normalize to 0-1 scale (max entropy for ASCII is ~6.6 bits)
  return Math.min(entropy / 6.6, 1);
}

/**
 * Validate email with basic checks
 */
export function validateEmail(email: string): EmailValidationResult {
  // Normalize email
  const normalizedEmail = email.toLowerCase().trim();

  // Check format
  const formatValid = validateEmailFormat(normalizedEmail);
  if (!formatValid) {
    return {
      valid: false,
      reason: 'Invalid email format',
      signals: {
        formatValid: false,
        entropyScore: 0,
        localPartLength: 0,
      },
    };
  }

  const [localPart, domain] = normalizedEmail.split('@');

  // Calculate entropy of local part (excluding common patterns)
  const entropyScore = calculateEntropy(localPart);

  // Build signals
  const signals = {
    formatValid: true,
    entropyScore,
    localPartLength: localPart.length,
  };

  // Very high entropy suggests random string (likely bogus)
  if (entropyScore > 0.85) {
    return {
      valid: false,
      reason: 'Suspicious random string pattern detected',
      signals,
    };
  }

  // Very short local parts are suspicious
  if (localPart.length < 3) {
    return {
      valid: false,
      reason: 'Email local part too short',
      signals,
    };
  }

  return {
    valid: true,
    signals,
  };
}
