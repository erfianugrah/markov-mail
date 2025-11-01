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
  // Pattern detection signals
  patternFamily?: string;
  patternType?: string;
  patternConfidence?: number;
  patternRiskScore?: number;
  normalizedEmail?: string;
  hasPlusAddressing?: boolean;
  hasKeyboardWalk?: boolean;
  keyboardWalkType?: string;
  // Phase 6A signals
  isGibberish?: boolean;
  gibberishConfidence?: number;
  tldRiskScore?: number;
  // Phase 7: Markov Chain signals
  markovDetected?: boolean;
  markovConfidence?: number;
  markovCrossEntropyLegit?: number;
  markovCrossEntropyFraud?: number;
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
