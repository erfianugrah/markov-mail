export interface ValidationResult {
  valid: boolean;
  riskScore: number;
  signals: ValidationSignals;
  decision: 'allow' | 'warn' | 'block';
  message: string;
  code?: string;
}

export interface ValidationSignals {
  formatValid: boolean;
  entropyScore?: number;
  patternMatch?: string | null;
  localPartLength?: number;
  domainValid?: boolean;
  isDisposableDomain?: boolean;
  isFreeProvider?: boolean;
  domainReputationScore?: number;
  experimentId?: string;
  experimentVariant?: 'control' | 'treatment';
  experimentBucket?: number;
  // Pattern detection signals
  patternFamily?: string;
  patternType?: string;
  patternConfidence?: number;
  patternRiskScore?: number;
  normalizedEmail?: string;
  hasPlusAddressing?: boolean;
  tldRiskScore?: number;
  decisionTreeReason?: string;
  decisionTreePath?: string[];
  decisionTreeVersion?: string;
  plusAddressingRisk?: number;
  sequentialPatternRisk?: number;
  // Markov Chain and OOD detection signals (for RPC consumers)
  markovDetected?: boolean;      // True if suspicious pattern detected (sequential, dated, etc.)
  markovConfidence?: number;     // Confidence score (0-1) from pattern detection
  oodDetected?: boolean;         // True if Out-of-Distribution (random/gibberish pattern)
  identitySignals?: {
    name?: string;
    nameInEmail?: boolean;
    similarityScore?: number;
    tokenOverlap?: number;
  };
  geoSignals?: {
    ipCountry?: string;
    acceptLanguageCountry?: string | null;
    languageMismatch?: boolean;
    timezoneMismatch?: boolean;
    anomalyScore?: number;
  };
  mxSignals?: {
    hasRecords: boolean;
    recordCount: number;
    primaryProvider: string | null;
    ttl?: number | null;
    failure?: string;
  };
  // Random Forest model signals
  randomForestVersion?: string;
  randomForestScore?: number | null;
  featureVector?: Record<string, number> | null;
  // Linguistic/structure/statistical detail signals
  linguisticSignals?: Record<string, number | boolean>;
  structureSignals?: Record<string, number | boolean>;
  statisticalSignals?: Record<string, number>;
}

export interface EmailValidationResult {
  valid: boolean;
  reason?: string;
  signals: {
    formatValid: boolean;
    entropyScore: number;
    localPartLength: number;
  };
}

export interface Fingerprint {
  hash: string;
  ip: string;
  ja4?: string;
  ja3?: string;
  userAgent: string;
  country?: string;
  asn?: number;
  asOrg?: string;
  botScore?: number;
  deviceType?: string;
}

// Fraud detection result stored in context by middleware
export interface FraudDetectionResult {
  decision: 'allow' | 'warn' | 'block';
  riskScore: number;
  blockReason: string;
  valid: boolean;
  latencyMs: number;
  signals: ValidationSignals;
}
