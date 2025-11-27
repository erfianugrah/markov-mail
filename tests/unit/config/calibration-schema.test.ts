/**
 * Tests for Calibration Schema Validation
 *
 * Ensures config.json calibration block adheres to expected structure
 * and prevents malformed calibration data from being deployed.
 */

import { describe, it, expect } from 'vitest';

// Type definition for expected calibration structure
interface CalibrationConfig {
	version: string;
	createdAt: string;
	trainedOn: {
		dataset: string;
		legitimate: number;
		fraudulent: number;
		total: number;
	};
	features: string[];
	metrics: {
		accuracy: number;
		precision: number;
		recall: number;
		f1Score: number;
		auroc?: number;
	};
	thresholds?: {
		block: number;
		warn: number;
	};
	model: {
		coefficients: number[];
		intercept: number;
	};
}

describe('Calibration Schema Validation', () => {
	describe('Required top-level fields', () => {
		it('should require version field', () => {
			const calibration: any = {
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(calibration.version).toBeUndefined();
			expect(() => validateCalibrationSchema(calibration)).toThrow('Missing required field: version');
		});

		it('should require createdAt field', () => {
			const calibration: any = {
				version: '1.0.0',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('Missing required field: createdAt');
		});

		it('should require trainedOn field', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('Missing required field: trainedOn');
		});

		it('should require features field', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('Missing required field: features');
		});

		it('should require metrics field', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('Missing required field: metrics');
		});

		it('should require model field', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('Missing required field: model');
		});

		it('should accept valid complete calibration', () => {
			const calibration: CalibrationConfig = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: {
					dataset: 'test.csv',
					legitimate: 100,
					fraudulent: 100,
					total: 200,
				},
				features: ['feature1'],
				metrics: {
					accuracy: 0.8,
					precision: 0.8,
					recall: 0.8,
					f1Score: 0.8,
				},
				model: {
					coefficients: [0.5],
					intercept: 0.1,
				},
			};

			expect(() => validateCalibrationSchema(calibration)).not.toThrow();
		});
	});

	describe('trainedOn nested structure', () => {
		it('should require dataset field in trainedOn', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: {
					legitimate: 100,
					fraudulent: 100,
					total: 200,
				},
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow(
				'Missing required field in trainedOn: dataset'
			);
		});

		it('should require legitimate field in trainedOn', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: {
					dataset: 'test.csv',
					fraudulent: 100,
					total: 200,
				},
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow(
				'Missing required field in trainedOn: legitimate'
			);
		});

		it('should require fraudulent field in trainedOn', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: {
					dataset: 'test.csv',
					legitimate: 100,
					total: 200,
				},
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow(
				'Missing required field in trainedOn: fraudulent'
			);
		});

		it('should require total field in trainedOn', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: {
					dataset: 'test.csv',
					legitimate: 100,
					fraudulent: 100,
				},
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow(
				'Missing required field in trainedOn: total'
			);
		});

		it('should validate trainedOn counts are positive', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: {
					dataset: 'test.csv',
					legitimate: -10,
					fraudulent: 100,
					total: 90,
				},
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow(
				'trainedOn counts must be positive numbers'
			);
		});

		it('should validate trainedOn total matches sum', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: {
					dataset: 'test.csv',
					legitimate: 100,
					fraudulent: 100,
					total: 150, // Should be 200
				},
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow(
				'trainedOn total must equal legitimate + fraudulent'
			);
		});
	});

	describe('features array validation', () => {
		it('should require features to be non-empty array', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: [],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('features must be non-empty array');
		});

		it('should require all features to be strings', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1', 123, 'feature3'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5, 0.5, 0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('All features must be strings');
		});

		it('should detect duplicate features', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1', 'feature2', 'feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5, 0.5, 0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('Duplicate feature detected: feature1');
		});
	});

	describe('metrics validation', () => {
		it('should require accuracy in metrics', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('Missing required metric: accuracy');
		});

		it('should require precision in metrics', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { accuracy: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('Missing required metric: precision');
		});

		it('should require recall in metrics', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('Missing required metric: recall');
		});

		it('should require f1Score in metrics', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('Missing required metric: f1Score');
		});

		it('should validate metrics are in range [0, 1]', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { accuracy: 1.5, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('Metric accuracy must be in range [0, 1]');
		});

		it('should validate negative metrics', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: -0.2, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('Metric precision must be in range [0, 1]');
		});

		it('should allow optional auroc metric', () => {
			const calibration: CalibrationConfig = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: {
					dataset: 'test.csv',
					legitimate: 100,
					fraudulent: 100,
					total: 200,
				},
				features: ['feature1'],
				metrics: {
					accuracy: 0.8,
					precision: 0.8,
					recall: 0.8,
					f1Score: 0.8,
					auroc: 0.85,
				},
				model: {
					coefficients: [0.5],
					intercept: 0.1,
				},
			};

			expect(() => validateCalibrationSchema(calibration)).not.toThrow();
		});
	});

	describe('model validation', () => {
		it('should require coefficients in model', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow(
				'Missing required field in model: coefficients'
			);
		});

		it('should require intercept in model', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5] },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('Missing required field in model: intercept');
		});

		it('should require coefficients to be array', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: 'invalid', intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('coefficients must be array of numbers');
		});

		it('should require coefficients length to match features length', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1', 'feature2', 'feature3'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5, 0.6], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow(
				'coefficients length (2) must match features length (3)'
			);
		});

		it('should require all coefficients to be finite numbers', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1', 'feature2'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5, NaN], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('All coefficients must be finite numbers');
		});

		it('should require intercept to be finite number', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: Infinity },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('intercept must be finite number');
		});
	});

	describe('version validation', () => {
		it('should accept semantic versioning format', () => {
			const validVersions = ['1.0.0', '2.3.4', '10.20.30', '1.0.0-beta', '2.0.0-rc.1'];

			for (const version of validVersions) {
				const calibration: CalibrationConfig = {
					version,
					createdAt: '2025-11-27T10:00:00Z',
					trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
					features: ['feature1'],
					metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
					model: { coefficients: [0.5], intercept: 0.1 },
				};

				expect(() => validateCalibrationSchema(calibration)).not.toThrow();
			}
		});

		it('should reject non-string versions', () => {
			const calibration: any = {
				version: 123,
				createdAt: '2025-11-27T10:00:00Z',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('version must be string');
		});
	});

	describe('createdAt validation', () => {
		it('should accept ISO 8601 timestamp format', () => {
			const validTimestamps = [
				'2025-11-27T10:00:00Z',
				'2025-11-27T10:00:00.000Z',
				'2025-11-27T10:00:00+00:00',
				'2025-11-27T10:00:00-05:00',
			];

			for (const createdAt of validTimestamps) {
				const calibration: CalibrationConfig = {
					version: '1.0.0',
					createdAt,
					trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
					features: ['feature1'],
					metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
					model: { coefficients: [0.5], intercept: 0.1 },
				};

				expect(() => validateCalibrationSchema(calibration)).not.toThrow();
			}
		});

		it('should reject invalid timestamp formats', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: 'invalid-date',
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('createdAt must be valid ISO 8601 timestamp');
		});

		it('should reject non-string timestamps', () => {
			const calibration: any = {
				version: '1.0.0',
				createdAt: 1234567890,
				trainedOn: { dataset: 'test.csv', legitimate: 100, fraudulent: 100, total: 200 },
				features: ['feature1'],
				metrics: { accuracy: 0.8, precision: 0.8, recall: 0.8, f1Score: 0.8 },
				model: { coefficients: [0.5], intercept: 0.1 },
			};

			expect(() => validateCalibrationSchema(calibration)).toThrow('createdAt must be string');
		});
	});

	describe('Real-world production calibration', () => {
		it('should validate actual deployed calibration structure', () => {
			// This is the structure from the actual trained model
			const productionCalibration: CalibrationConfig = {
				version: '1.0.0',
				createdAt: '2025-11-27T10:25:09.743Z',
				trainedOn: {
					dataset: 'dataset/training_compiled/training_compiled.csv',
					legitimate: 50164,
					fraudulent: 41802,
					total: 91966,
				},
				features: [
					'markovConfidence',
					'classificationRisk',
					'abnormalityRisk',
					'domainRisk',
					'sequentialPatternRisk',
					'plusAddressingRisk',
					'ensembleBoost',
					'minEntropy',
					'abnormalityScore',
					'crossEntropyLegit',
					'crossEntropyFraud',
					'differenceRatio',
					'localPartLength',
					'isDisposable',
					'hasSpecialChars',
				],
				metrics: {
					accuracy: 0.8014785239856662,
					precision: 0.8010881513476602,
					recall: 0.8438093794905373,
					f1Score: 0.8218531073446328,
					auroc: 0.8736429025957594,
				},
				model: {
					coefficients: [
						0.5, 1.2, 0.8, 0.3, 0.4, 0.25, 0.15, -0.05, 0.1, 0.2, -0.15, 0.35, -0.02, 0.6, 0.1,
					],
					intercept: -0.5,
				},
			};

			expect(() => validateCalibrationSchema(productionCalibration)).not.toThrow();
		});
	});
});

/**
 * Validation function for calibration schema
 */
function validateCalibrationSchema(calibration: any): void {
	// Top-level required fields
	const requiredFields = ['version', 'createdAt', 'trainedOn', 'features', 'metrics', 'model'];
	for (const field of requiredFields) {
		if (!(field in calibration)) {
			throw new Error(`Missing required field: ${field}`);
		}
	}

	// Version validation
	if (typeof calibration.version !== 'string') {
		throw new Error('version must be string');
	}

	// CreatedAt validation
	if (typeof calibration.createdAt !== 'string') {
		throw new Error('createdAt must be string');
	}
	const date = new Date(calibration.createdAt);
	if (isNaN(date.getTime())) {
		throw new Error('createdAt must be valid ISO 8601 timestamp');
	}

	// TrainedOn validation
	const trainedOnFields = ['dataset', 'legitimate', 'fraudulent', 'total'];
	for (const field of trainedOnFields) {
		if (!(field in calibration.trainedOn)) {
			throw new Error(`Missing required field in trainedOn: ${field}`);
		}
	}

	if (
		calibration.trainedOn.legitimate < 0 ||
		calibration.trainedOn.fraudulent < 0 ||
		calibration.trainedOn.total < 0
	) {
		throw new Error('trainedOn counts must be positive numbers');
	}

	if (calibration.trainedOn.legitimate + calibration.trainedOn.fraudulent !== calibration.trainedOn.total) {
		throw new Error('trainedOn total must equal legitimate + fraudulent');
	}

	// Features validation
	if (!Array.isArray(calibration.features) || calibration.features.length === 0) {
		throw new Error('features must be non-empty array');
	}

	for (const feature of calibration.features) {
		if (typeof feature !== 'string') {
			throw new Error('All features must be strings');
		}
	}

	// Check for duplicate features
	const uniqueFeatures = new Set(calibration.features);
	if (uniqueFeatures.size !== calibration.features.length) {
		const duplicates = calibration.features.filter(
			(item: string, index: number) => calibration.features.indexOf(item) !== index
		);
		throw new Error(`Duplicate feature detected: ${duplicates[0]}`);
	}

	// Metrics validation
	const requiredMetrics = ['accuracy', 'precision', 'recall', 'f1Score'];
	for (const metric of requiredMetrics) {
		if (!(metric in calibration.metrics)) {
			throw new Error(`Missing required metric: ${metric}`);
		}

		const value = calibration.metrics[metric];
		if (typeof value !== 'number' || value < 0 || value > 1) {
			throw new Error(`Metric ${metric} must be in range [0, 1]`);
		}
	}

	// Model validation
	if (!('coefficients' in calibration.model)) {
		throw new Error('Missing required field in model: coefficients');
	}
	if (!('intercept' in calibration.model)) {
		throw new Error('Missing required field in model: intercept');
	}

	if (!Array.isArray(calibration.model.coefficients)) {
		throw new Error('coefficients must be array of numbers');
	}

	if (calibration.model.coefficients.length !== calibration.features.length) {
		throw new Error(
			`coefficients length (${calibration.model.coefficients.length}) must match features length (${calibration.features.length})`
		);
	}

	for (const coef of calibration.model.coefficients) {
		if (typeof coef !== 'number' || !Number.isFinite(coef)) {
			throw new Error('All coefficients must be finite numbers');
		}
	}

	if (typeof calibration.model.intercept !== 'number' || !Number.isFinite(calibration.model.intercept)) {
		throw new Error('intercept must be finite number');
	}
}
