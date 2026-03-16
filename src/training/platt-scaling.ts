/**
 * Platt Scaling (1D Logistic Regression)
 *
 * Fits the sigmoid calibration function:
 *   P(fraud) = 1 / (1 + exp(-(coef * rawScore + intercept)))
 *
 * Uses Newton-Raphson (IRLS) optimization on log-loss with Platt's original
 * target correction to avoid overfitting on small calibration sets.
 *
 * Reference: Platt (1999) "Probabilistic Outputs for Support Vector Machines"
 *
 * This produces the exact same ForestCalibrationMeta format consumed by
 * src/detectors/forest-engine.ts applyCalibration().
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PlattCoefficients {
	coef: number;
	intercept: number;
	/** Number of samples used for fitting */
	samples: number;
	/** Number of Newton iterations until convergence */
	iterations: number;
}

export interface PlattConfig {
	/** Maximum Newton-Raphson iterations (default: 100) */
	maxIterations: number;
	/** Convergence tolerance for parameter updates (default: 1e-8) */
	tolerance: number;
}

export const DEFAULT_PLATT_CONFIG: PlattConfig = {
	maxIterations: 100,
	tolerance: 1e-8,
};

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

/**
 * Sigmoid function with overflow protection.
 */
function sigmoid(x: number): number {
	if (x > 500) return 1;
	if (x < -500) return 0;
	return 1 / (1 + Math.exp(-x));
}

/**
 * Fit Platt scaling via Newton-Raphson (IRLS).
 *
 * Given raw scores `x` and true binary labels `y`, fits:
 *   P(y=1|x) = sigmoid(coef * x + intercept)
 *
 * Uses Platt's target correction:
 *   t_i = (N+ + 1) / (N+ + 2)   if y_i = 1
 *   t_i = 1 / (N- + 2)          if y_i = 0
 * This prevents the sigmoid from saturating to 0/1 on small datasets.
 *
 * @param scores  Raw model scores (e.g., OOB predictions), one per sample
 * @param labels  True binary labels (0 or 1), one per sample
 * @param config  Optimization parameters
 * @returns Fitted coefficients { coef, intercept, samples, iterations }
 */
export function fitPlattScaling(
	scores: number[],
	labels: number[],
	config: PlattConfig = DEFAULT_PLATT_CONFIG,
): PlattCoefficients {
	const n = scores.length;
	if (n !== labels.length) {
		throw new Error(`Score count ${n} does not match label count ${labels.length}`);
	}
	if (n < 10) {
		throw new Error(`Platt scaling requires at least 10 samples, got ${n}`);
	}

	// Count positives and negatives
	let nPos = 0;
	for (let i = 0; i < n; i++) {
		if (labels[i] === 1) nPos++;
	}
	const nNeg = n - nPos;

	if (nPos === 0 || nNeg === 0) {
		throw new Error(
			`Platt scaling requires both classes. Got ${nPos} positive, ${nNeg} negative.`
		);
	}

	// Platt's target correction (avoids 0/1 saturation)
	const targetPos = (nPos + 1) / (nPos + 2);
	const targetNeg = 1 / (nNeg + 2);

	const targets = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		targets[i] = labels[i] === 1 ? targetPos : targetNeg;
	}

	// Newton-Raphson optimization
	// Parameters: coef (slope), intercept (bias)
	let coef = 0;
	let intercept = 0;
	let iterations = 0;

	for (let iter = 0; iter < config.maxIterations; iter++) {
		iterations = iter + 1;

		// Compute predictions and gradient/Hessian
		// grad = [dL/d_coef, dL/d_intercept]
		// H = [[d2L/d_coef2, d2L/d_coef_d_intercept],
		//      [d2L/d_intercept_d_coef, d2L/d_intercept2]]

		let g_coef = 0;      // gradient w.r.t. coef
		let g_intercept = 0;  // gradient w.r.t. intercept
		let h_cc = 0;        // Hessian: coef-coef
		let h_ci = 0;        // Hessian: coef-intercept
		let h_ii = 0;        // Hessian: intercept-intercept

		for (let i = 0; i < n; i++) {
			const z = coef * scores[i] + intercept;
			const p = sigmoid(z);

			// Gradient of cross-entropy loss w.r.t. parameters
			const diff = p - targets[i]; // (predicted - target)
			g_coef += diff * scores[i];
			g_intercept += diff;

			// Hessian (second derivatives)
			// For logistic loss, H = p*(1-p) * outer(x, x)
			const w = p * (1 - p) + 1e-12; // add epsilon to avoid division by zero
			h_cc += w * scores[i] * scores[i];
			h_ci += w * scores[i];
			h_ii += w;
		}

		// Solve 2x2 system: H * delta = -grad
		// Using Cramer's rule for the 2x2 case
		const det = h_cc * h_ii - h_ci * h_ci;
		if (Math.abs(det) < 1e-20) {
			// Singular Hessian — stop early
			break;
		}

		const d_coef = -(h_ii * g_coef - h_ci * g_intercept) / det;
		const d_intercept = -(h_cc * g_intercept - h_ci * g_coef) / det;

		coef += d_coef;
		intercept += d_intercept;

		// Check convergence
		if (Math.abs(d_coef) < config.tolerance && Math.abs(d_intercept) < config.tolerance) {
			break;
		}
	}

	return {
		coef: Math.round(coef * 1e6) / 1e6,
		intercept: Math.round(intercept * 1e6) / 1e6,
		samples: n,
		iterations,
	};
}

/**
 * Apply fitted Platt scaling to a raw score.
 * This is equivalent to forest-engine.ts applyCalibration() but provided
 * here for self-contained testing of the training pipeline.
 */
export function applyPlattScaling(rawScore: number, coef: number, intercept: number): number {
	const logit = coef * rawScore + intercept;
	const clamped = Math.max(-500, Math.min(500, logit));
	return 1 / (1 + Math.exp(-clamped));
}
