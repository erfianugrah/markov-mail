/**
 * Signal Aggregator - Multi-Detector Interop
 *
 * Combines signals from all detectors without hardcoding thresholds.
 * Uses voting/confidence-based approach where detectors reinforce each other.
 */

export interface DetectorSignal {
  name: string;
  isSuspicious: boolean;
  confidence: number; // 0-1
  weight?: number; // Optional weight for this detector (default: 1.0)
}

export interface AggregatedSignal {
  totalConfidence: number; // Combined confidence (0-1)
  agreementRatio: number; // Ratio of detectors that agree (0-1)
  strongSignals: string[]; // Names of high-confidence (>0.7) suspicious signals
  conflictingSignals: boolean; // True if detectors disagree significantly
}

/**
 * Aggregate signals from multiple detectors using weighted voting
 *
 * Algorithm:
 * 1. Each detector contributes its confidence * weight
 * 2. Signals that agree reinforce each other (multiplicative boost)
 * 3. High-confidence signals (>0.7) get extra weight
 * 4. Conflicting signals reduce overall confidence
 */
export function aggregateSignals(signals: DetectorSignal[]): AggregatedSignal {
  if (signals.length === 0) {
    return {
      totalConfidence: 0,
      agreementRatio: 0,
      strongSignals: [],
      conflictingSignals: false
    };
  }

  // Calculate weighted suspicious signals
  const suspiciousSignals = signals.filter(s => s.isSuspicious);
  const nonSuspiciousSignals = signals.filter(s => !s.isSuspicious);

  // Agreement ratio
  const agreementRatio = Math.max(
    suspiciousSignals.length,
    nonSuspiciousSignals.length
  ) / signals.length;

  // Strong signals (high confidence)
  const strongSignals = suspiciousSignals
    .filter(s => s.confidence > 0.7)
    .map(s => s.name);

  // Calculate total confidence with reinforcement
  let totalConfidence = 0;

  if (suspiciousSignals.length > 0) {
    // Base: Average weighted confidence of suspicious signals
    const weightedSum = suspiciousSignals.reduce(
      (sum, s) => sum + s.confidence * (s.weight || 1.0),
      0
    );
    const weightSum = suspiciousSignals.reduce(
      (sum, s) => sum + (s.weight || 1.0),
      0
    );
    const baseConfidence = weightedSum / weightSum;

    // Reinforcement: More detectors agreeing = higher confidence
    const reinforcementBonus = Math.min(
      (suspiciousSignals.length / signals.length) * 0.3, // Max +30%
      0.3
    );

    // Strong signal bonus: If multiple high-confidence detectors agree
    const strongSignalBonus = strongSignals.length >= 2 ? 0.15 : 0;

    totalConfidence = Math.min(
      baseConfidence + reinforcementBonus + strongSignalBonus,
      1.0
    );

    // Penalty: Conflicting signals reduce confidence
    if (agreementRatio < 0.6) {
      totalConfidence *= 0.7; // Reduce by 30% if significant disagreement
    }
  }

  return {
    totalConfidence,
    agreementRatio,
    strongSignals,
    conflictingSignals: agreementRatio < 0.6
  };
}

/**
 * Create a detector signal from detector results
 */
export function createSignal(
  name: string,
  result: {
    isSuspicious?: boolean;
    isDetected?: boolean;
    confidence: number;
  },
  weight?: number
): DetectorSignal {
  return {
    name,
    isSuspicious: result.isSuspicious ?? result.isDetected ?? false,
    confidence: result.confidence,
    weight
  };
}
