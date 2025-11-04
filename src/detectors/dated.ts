/**
 * Dated Pattern Detector - Age-Aware Edition
 *
 * Detects email patterns with date or year components, distinguishing between:
 *
 * FRAUD PATTERNS (high risk):
 * - Current/recent years: user2025@, signup2024@ (timestamp-based generation)
 * - Month+year: user_oct2024@, test_jan2025@ (automated campaigns)
 * - Full dates: user_20241031@ (timestamp formatting)
 *
 * LEGITIMATE PATTERNS (low risk):
 * - Birth years: sarah1990@, john.smith.1985@ (personal identifiers)
 * - Historical years in plausible age range (13-65 years old)
 *
 * Algorithm uses temporal distance from current date as primary fraud indicator,
 * combined with demographic-aware age ranges for birth year plausibility.
 */

export interface DatedPatternResult {
  hasDatedPattern: boolean;
  basePattern: string;       // "firstname.lastname" from "firstname.lastname.2024"
  dateComponent: string | null; // "2024", "oct2024", "20241031"
  dateType: 'year' | 'month-year' | 'full-date' | 'short-year' | 'none';
  confidence: number;        // 0.0-1.0
  metadata?: {
    year?: number;
    month?: string;
    position: 'trailing' | 'middle' | 'leading';
    yearAge?: number;        // How many years ago (for age analysis)
    ageCategory?: 'future' | 'recent_timestamp' | 'underage' | 'plausible_birth_year' | 'elderly_birth_year' | 'ancient';
    isSuspicious?: boolean;  // True if likely fraud, false if likely birth year
  };
}

// Common month abbreviations and names
const MONTHS = [
  'jan', 'january', 'feb', 'february', 'mar', 'march',
  'apr', 'april', 'may', 'jun', 'june',
  'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september',
  'oct', 'october', 'nov', 'november', 'dec', 'december'
];

const MONTH_PATTERN = MONTHS.join('|');

/**
 * Classify year based on age-aware demographic analysis
 * Returns risk score and category based on temporal distance from current date
 */
function classifyYearAge(year: number, dateType: 'year' | 'month-year' | 'full-date' | 'short-year'): {
  risk: number;
  category: 'future' | 'recent_timestamp' | 'underage' | 'plausible_birth_year' | 'elderly_birth_year' | 'ancient';
  isSuspicious: boolean;
} {
  const currentYear = new Date().getFullYear();
  const yearAge = currentYear - year;

  // Future year = impossible (very high risk)
  if (year > currentYear) {
    return { risk: 0.95, category: 'future', isSuspicious: true };
  }

  // 0-2 years old = recent timestamp (very high risk for fraud)
  if (yearAge >= 0 && yearAge <= 2) {
    return { risk: 0.90, category: 'recent_timestamp', isSuspicious: true };
  }

  // 3-12 years old = too young for account creation (high risk)
  if (yearAge >= 3 && yearAge <= 12) {
    return { risk: 0.70, category: 'underage', isSuspicious: true };
  }

  // 13-65 years old = plausible birth year range (LOW RISK)
  // This covers Gen Z (13-28), Millennials (29-44), Gen X (45-60), early Boomers (61-65)
  if (yearAge >= 13 && yearAge <= 65) {
    // However, month+year or full-date is still suspicious even in birth range
    if (dateType === 'month-year') {
      // sarah_jan1990@ is weird, sarah1990@ is normal
      return { risk: 0.60, category: 'plausible_birth_year', isSuspicious: true };
    }
    if (dateType === 'full-date') {
      // sarah_19900115@ is very suspicious
      return { risk: 0.75, category: 'plausible_birth_year', isSuspicious: true };
    }

    // Just year in plausible range = LOW RISK (likely birth year)
    return { risk: 0.20, category: 'plausible_birth_year', isSuspicious: false };
  }

  // 66-100 years old = elderly but possible (medium risk)
  if (yearAge >= 66 && yearAge <= 100) {
    return { risk: 0.40, category: 'elderly_birth_year', isSuspicious: false };
  }

  // >100 years old = implausible (high risk)
  return { risk: 0.80, category: 'ancient', isSuspicious: true };
}

/**
 * Detects if an email contains date/year patterns
 */
export function detectDatedPattern(email: string): DatedPatternResult {
  const normalizedEmail = email.toLowerCase().trim();
  const [localPart] = normalizedEmail.split('@');

  if (!localPart || localPart.length < 4) {
    return {
      hasDatedPattern: false,
      basePattern: localPart || '',
      dateComponent: null,
      dateType: 'none',
      confidence: 0.0
    };
  }

  // Check patterns in order of specificity (most specific first)
  // This ensures full-date and month-year patterns are checked before simpler year patterns

  // Pattern 1: Full date (20241031, 2024-10-31, 2024_10_31, 19900115)
  // Examples: user_20241031, firstname.lastname.2024-10-31, john_19900115
  // CHECK THIS FIRST - most specific pattern
  const fullDatePattern = /^(.+?)[._-]?(20\d{2}|19\d{2})[._-]?(\d{2})[._-]?(\d{2})([._-].+)?$/;
  const fullDateMatch = localPart.match(fullDatePattern);

  if (fullDateMatch) {
    const [, prefix, yearStr, monthStr, dayStr, suffix] = fullDateMatch;
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);
    const currentYear = new Date().getFullYear();

    // Validate date ranges
    if (
      year >= 1900 && year <= 2099 &&
      month >= 1 && month <= 12 &&
      day >= 1 && day <= 31
    ) {
      const position = suffix ? 'middle' : 'trailing';
      const basePattern = suffix ? `${prefix}.[DATE].${suffix.substring(1)}` : prefix;

      // Full dates are ALWAYS very suspicious, even in birth year range
      const ageClass = classifyYearAge(year, 'full-date');
      const yearAge = currentYear - year;

      // Full date formatting is extremely rare for legitimate users
      let confidence = ageClass.risk;

      return {
        hasDatedPattern: true,
        basePattern,
        dateComponent: `${yearStr}${monthStr}${dayStr}`,
        dateType: 'full-date',
        confidence: Math.min(confidence, 1.0),
        metadata: {
          year,
          month: monthStr,
          position,
          yearAge,
          ageCategory: ageClass.category,
          isSuspicious: ageClass.isSuspicious
        }
      };
    }
  }

  // Pattern 2: Month + Year (oct2024, jan2025, jan1990, 102024, 012025)
  // Examples: user_oct2024, firstname.lastname.jan2025, sarah_jan1990, test_012025
  // CHECK THIS SECOND - more specific than plain year
  const monthYearPattern = new RegExp(
    `^(.+?)[._-]?((?:${MONTH_PATTERN})|(?:\\d{2}))(20\\d{2}|19\\d{2})([._-].+)?$`,
    'i'
  );
  const monthYearMatch = localPart.match(monthYearPattern);

  if (monthYearMatch) {
    const [, prefix, monthStr, yearStr, suffix] = monthYearMatch;
    const year = parseInt(yearStr, 10);
    const currentYear = new Date().getFullYear();

    if (year >= 1900 && year <= 2099) {
      const position = suffix ? 'middle' : 'trailing';
      const basePattern = suffix ? `${prefix}.[MONTH-YEAR].${suffix.substring(1)}` : prefix;

      // Month+year is ALWAYS suspicious, even in birth year range
      // (sarah_jan1990@ is weird, sarah1990@ is normal)
      const ageClass = classifyYearAge(year, 'month-year');
      const yearAge = currentYear - year;

      // Base confidence from age classification (already elevated for month-year)
      let confidence = ageClass.risk;

      // Additional confidence for very recent years
      if (year === currentYear || year === currentYear + 1) {
        confidence = Math.min(confidence + 0.1, 1.0);
      }

      return {
        hasDatedPattern: true,
        basePattern,
        dateComponent: `${monthStr}${yearStr}`,
        dateType: 'month-year',
        confidence: Math.min(confidence, 1.0),
        metadata: {
          year,
          month: monthStr,
          position,
          yearAge,
          ageCategory: ageClass.category,
          isSuspicious: ageClass.isSuspicious
        }
      };
    }
  }

  // Pattern 3: Four-digit year (2024, 2025, etc.)
  // Examples: john.doe.2024, user_2025, firstname.lastname.2024
  const yearPattern = /^(.+?)[._-]?(20\d{2}|19\d{2})([._-].+)?$/;
  const yearMatch = localPart.match(yearPattern);

  if (yearMatch) {
    const [, prefix, yearStr, suffix] = yearMatch;
    const year = parseInt(yearStr, 10);
    const currentYear = new Date().getFullYear();

    // Accept all reasonable years (1900-2099), use age classification for risk
    if (year >= 1900 && year <= 2099) {
      const position = suffix ? 'middle' : 'trailing';
      const basePattern = suffix ? `${prefix}.[YEAR].${suffix.substring(1)}` : prefix;

      // Use age-aware classification
      const ageClass = classifyYearAge(year, 'year');
      const yearAge = currentYear - year;

      // Base confidence from age classification
      let confidence = ageClass.risk;

      // Adjust confidence based on position
      if (!suffix) {
        // Trailing position is most common (slight increase in confidence)
        confidence = Math.min(confidence + 0.05, 1.0);
      } else {
        // Middle position is less common (could be legitimate like john.1985.smith@)
        confidence = Math.max(confidence - 0.05, 0.0);
      }

      return {
        hasDatedPattern: true,
        basePattern,
        dateComponent: yearStr,
        dateType: 'year',
        confidence: Math.min(confidence, 1.0),
        metadata: {
          year,
          position,
          yearAge,
          ageCategory: ageClass.category,
          isSuspicious: ageClass.isSuspicious
        }
      };
    }
  }

  // Pattern 4: Leading year (less common but exists)
  // Examples: 2024.john.doe, 2025_username
  const leadingYearPattern = /^(20\d{2}|19\d{2})[._-](.+)$/;
  const leadingYearMatch = localPart.match(leadingYearPattern);

  if (leadingYearMatch) {
    const [, yearStr, suffix] = leadingYearMatch;
    const year = parseInt(yearStr, 10);
    const currentYear = new Date().getFullYear();

    if (year >= 1900 && year <= 2099) {
      // Use age-aware classification
      const ageClass = classifyYearAge(year, 'year');
      const yearAge = currentYear - year;

      // Leading position is unusual, add slight suspicion
      let confidence = ageClass.risk + 0.1;

      return {
        hasDatedPattern: true,
        basePattern: suffix,
        dateComponent: yearStr,
        dateType: 'year',
        confidence: Math.min(confidence, 1.0),
        metadata: {
          year,
          position: 'leading',
          yearAge,
          ageCategory: ageClass.category,
          isSuspicious: ageClass.isSuspicious
        }
      };
    }
  }

  // Pattern 5: Two-digit year (24, 25, 90, 85)
  // Examples: john.doe.24, user_25, sarah90, mike85
  // CHECK THIS LAST - most ambiguous pattern (could be random numbers)
  const shortYearPattern = /^(.+?)[._-]?(\d{2})$/;
  const shortYearMatch = localPart.match(shortYearPattern);

  if (shortYearMatch) {
    const [, prefix, yearStr] = shortYearMatch;
    const twoDigitYear = parseInt(yearStr, 10);
    const currentYear = new Date().getFullYear();

    // Convert 2-digit year to 4-digit year
    // Assume 00-40 = 2000-2040, 41-99 = 1941-1999
    let fourDigitYear: number;
    if (twoDigitYear <= 40) {
      fourDigitYear = 2000 + twoDigitYear;
    } else {
      fourDigitYear = 1900 + twoDigitYear;
    }

    // Need longer base to avoid false positives (42, 007, etc.)
    if (prefix.length < 4) {
      // Short bases like "a85", "xy90" are ambiguous, skip
      return {
        hasDatedPattern: false,
        basePattern: localPart,
        dateComponent: null,
        dateType: 'none',
        confidence: 0.0
      };
    }

    // Use age-aware classification
    const ageClass = classifyYearAge(fourDigitYear, 'short-year');
    const yearAge = currentYear - fourDigitYear;

    // Base confidence from age classification
    let confidence = ageClass.risk;

    // Slightly reduce confidence for 2-digit years (more ambiguous than 4-digit)
    // But don't reduce too much - birth years like sarah90@ are still legitimate
    confidence = Math.max(confidence - 0.05, 0.0);

    // Only flag as dated pattern if confidence is somewhat meaningful
    // Lower threshold to allow birth years through
    if (confidence < 0.10) {
      return {
        hasDatedPattern: false,
        basePattern: localPart,
        dateComponent: null,
        dateType: 'none',
        confidence: 0.0
      };
    }

    return {
      hasDatedPattern: true,
      basePattern: prefix,
      dateComponent: yearStr,
      dateType: 'short-year',
      confidence: Math.min(confidence, 1.0),
      metadata: {
        year: fourDigitYear,
        position: 'trailing',
        yearAge,
        ageCategory: ageClass.category,
        isSuspicious: ageClass.isSuspicious
      }
    };
  }

  // No dated pattern detected after checking all patterns
  return {
    hasDatedPattern: false,
    basePattern: localPart,
    dateComponent: null,
    dateType: 'none',
    confidence: 0.0
  };
}

/**
 * Extract a normalized pattern family string for dated patterns
 * This allows grouping: john.doe.2024, jane.smith.2024 → "NAME.NAME.[YEAR]"
 */
export function getDatedPatternFamily(email: string): string | null {
  const result = detectDatedPattern(email);

  if (!result.hasDatedPattern) {
    return null;
  }

  const [, domain] = email.toLowerCase().split('@');
  const typeToken = result.dateType === 'year' || result.dateType === 'short-year'
    ? '[YEAR]'
    : result.dateType === 'month-year'
    ? '[MONTH-YEAR]'
    : '[DATE]';

  // Normalize the pattern - replace actual name with PATTERN
  return `[PATTERN].${typeToken}@${domain}`;
}

/**
 * Batch analysis: detect if multiple emails follow the same dated pattern
 */
export function analyzeDatedBatch(emails: string[]): {
  hasDatedPattern: boolean;
  patternFamily: string | null;
  confidence: number;
  matchingEmails: string[];
  dateComponents: string[];
} {
  if (emails.length < 2) {
    return {
      hasDatedPattern: false,
      patternFamily: null,
      confidence: 0.0,
      matchingEmails: [],
      dateComponents: []
    };
  }

  const patterns = new Map<string, { emails: string[]; dates: string[] }>();

  for (const email of emails) {
    const result = detectDatedPattern(email);
    if (result.hasDatedPattern) {
      const family = getDatedPatternFamily(email);
      if (family) {
        if (!patterns.has(family)) {
          patterns.set(family, { emails: [], dates: [] });
        }
        const entry = patterns.get(family)!;
        entry.emails.push(email);
        if (result.dateComponent) {
          entry.dates.push(result.dateComponent);
        }
      }
    }
  }

  // Find the most common pattern
  let maxCount = 0;
  let dominantPattern: string | null = null;
  let matchingEmails: string[] = [];
  let dateComponents: string[] = [];

  for (const [pattern, data] of patterns.entries()) {
    if (data.emails.length > maxCount) {
      maxCount = data.emails.length;
      dominantPattern = pattern;
      matchingEmails = data.emails;
      dateComponents = data.dates;
    }
  }

  if (!dominantPattern || maxCount < 2) {
    return {
      hasDatedPattern: false,
      patternFamily: null,
      confidence: 0.0,
      matchingEmails: [],
      dateComponents: []
    };
  }

  // Very high confidence if multiple emails share same dated pattern
  // This is a strong signal of automated generation
  let confidence = 0.7 + (maxCount * 0.1);
  confidence = Math.min(confidence, 1.0);

  return {
    hasDatedPattern: true,
    patternFamily: dominantPattern,
    confidence,
    matchingEmails,
    dateComponents
  };
}

/**
 * Check if date component is suspiciously recent/current
 */
export function isCurrentDatePattern(dateComponent: string): boolean {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  // Check for current year
  if (dateComponent.includes(currentYear.toString())) {
    return true;
  }

  // Check for current month abbreviations
  const currentMonthName = new Date().toLocaleString('en', { month: 'short' }).toLowerCase();
  if (dateComponent.includes(currentMonthName)) {
    return true;
  }

  return false;
}
