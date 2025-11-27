/**
 * Dataset Analysis Command
 * Analyze dataset quality and identify potentially mislabeled emails
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';
import * as fs from 'fs';

interface EmailRecord {
	email: string;
	label: number; // 0 = legitimate, 1 = fraudulent
	riskScore?: number;
	reason?: string;
}

interface SuspiciousLabel {
	email: string;
	currentLabel: string;
	riskScore: number;
	reason: string;
	confidence: 'high' | 'medium' | 'low';
	suggestedLabel: string;
}

/**
 * Analyze email patterns to detect likely mislabels
 */
function analyzeLabelQuality(email: string, label: number, riskScore: number, reason: string): SuspiciousLabel | null {
	const isLabeledFraud = label === 1;
	const isLabeledLegit = label === 0;

	// Extract features
	const [localPart, domain] = email.split('@');
	const hasRealName = /^[a-z]+\.[a-z]+$/i.test(localPart); // firstname.lastname
	const hasCompanyDomain = domain && /\.(com|org|edu|co\.[a-z]{2}|ac\.[a-z]{2})$/.test(domain);
	const hasProfessionalPattern = hasRealName && hasCompanyDomain;

	// Check for known legitimate patterns
	const knownLegitPatterns = [
		/^[a-z]+\.[a-z]+@[a-z]+\.(com|org|edu)$/, // firstname.lastname@company.com
		/^[a-z]{2,10}@[a-z0-9\-]+\.(edu|ac\.[a-z]{2})$/, // short@university.edu
		/^[a-z]+@w3\.org$/, // w3.org emails
		/^[a-z]+\+[a-z]+@.*$/, // plus addressing
	];

	const matchesLegitPattern = knownLegitPatterns.some(pattern => pattern.test(email.toLowerCase()));

	// Suspicious cases: labeled as fraud but looks legitimate
	if (isLabeledFraud && riskScore < 0.35) {
		if (hasProfessionalPattern) {
			return {
				email,
				currentLabel: 'fraud',
				riskScore,
				reason,
				confidence: 'high',
				suggestedLabel: 'legitimate',
			};
		}
		if (matchesLegitPattern) {
			return {
				email,
				currentLabel: 'fraud',
				riskScore,
				reason,
				confidence: 'medium',
				suggestedLabel: 'legitimate',
			};
		}
		// Generic low-risk fraud label is suspicious
		if (riskScore < 0.20) {
			return {
				email,
				currentLabel: 'fraud',
				riskScore,
				reason,
				confidence: 'low',
				suggestedLabel: 'legitimate',
			};
		}
	}

	// Suspicious cases: labeled as legitimate but high risk
	if (isLabeledLegit && riskScore > 0.75) {
		const hasRandomPattern = /[0-9]{4,}|[a-z]{12,}[0-9]/.test(localPart);
		const hasSequentialPattern = /123|abc|qwerty/.test(localPart.toLowerCase());

		if (hasRandomPattern || hasSequentialPattern) {
			return {
				email,
				currentLabel: 'legitimate',
				riskScore,
				reason,
				confidence: 'medium',
				suggestedLabel: 'fraud',
			};
		}
	}

	return null;
}

export default async function analyzeDataset(args: string[]) {
	const parsed = parseArgs(args);
	const datasetPath = getOption(parsed, 'dataset') || 'dataset/pattern_labeled_emails.csv';
	const endpoint = getOption(parsed, 'endpoint') || 'https://fraud.erfi.dev/validate';
	const sampleSize = parseInt(getOption(parsed, 'sample') || '1000');
	const outputPath = getOption(parsed, 'output');
	const verbose = hasFlag(parsed, 'verbose');

	logger.section('Dataset Quality Analysis');
	logger.info(`Dataset: ${datasetPath}`);
	logger.info(`Endpoint: ${endpoint}`);
	logger.info(`Sample size: ${sampleSize}`);

	// Load dataset
	if (!fs.existsSync(datasetPath)) {
		logger.error(`Dataset not found: ${datasetPath}`);
		process.exit(1);
	}

	const content = fs.readFileSync(datasetPath, 'utf-8');
	const lines = content.trim().split('\n');

	// Skip header
	const records: EmailRecord[] = [];
	for (let i = 1; i < lines.length && i <= sampleSize; i++) {
		const [email, label] = lines[i].split(',');
		if (email && label !== undefined) {
			records.push({
				email: email.trim(),
				label: parseInt(label),
			});
		}
	}

	logger.info(`Loaded ${records.length} records`);
	logger.info('');

	// Test each email against the API
	logger.subsection('Testing emails against API...');
	const suspiciousLabels: SuspiciousLabel[] = [];
	let processed = 0;

	for (const record of records) {
		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: record.email }),
			});

			const data = await response.json() as any;
			record.riskScore = data.riskScore || 0;
			record.reason = data.message || data.reason || 'unknown';

			// Analyze for mislabels
			const suspicious = analyzeLabelQuality(
				record.email,
				record.label,
				record.riskScore ?? 0,
				record.reason || 'unknown'
			);

			if (suspicious) {
				suspiciousLabels.push(suspicious);
			}

			processed++;
			if (processed % 100 === 0) {
				logger.progress(processed, records.length, 'Testing');
			}
		} catch (error) {
			logger.warn(`Failed to test ${record.email}: ${error}`);
		}
	}

	logger.progress(processed, records.length, 'Testing');
	logger.info('');

	// Report suspicious labels
	logger.subsection('Suspicious Labels Found');
	logger.info('');

	const highConfidence = suspiciousLabels.filter(s => s.confidence === 'high');
	const mediumConfidence = suspiciousLabels.filter(s => s.confidence === 'medium');
	const lowConfidence = suspiciousLabels.filter(s => s.confidence === 'low');

	logger.info(`High Confidence Mislabels: ${highConfidence.length}`);
	logger.info(`Medium Confidence Mislabels: ${mediumConfidence.length}`);
	logger.info(`Low Confidence Mislabels: ${lowConfidence.length}`);
	logger.info(`Total Suspicious: ${suspiciousLabels.length} (${((suspiciousLabels.length / records.length) * 100).toFixed(2)}%)`);
	logger.info('');

	// Show high confidence mislabels
	if (highConfidence.length > 0) {
		logger.subsection('High Confidence Mislabels (Top 20)');
		logger.info('These are very likely mislabeled and should be corrected:');
		logger.info('');

		const top20 = highConfidence.slice(0, 20);
		for (const s of top20) {
			console.log(`  ${s.email}`);
			console.log(`    Current: ${s.currentLabel} → Suggested: ${s.suggestedLabel}`);
			console.log(`    Risk: ${s.riskScore.toFixed(2)} | Reason: ${s.reason}`);
			console.log('');
		}
	}

	// Show medium confidence mislabels
	if (mediumConfidence.length > 0 && verbose) {
		logger.subsection('Medium Confidence Mislabels (Top 10)');
		logger.info('These should be reviewed manually:');
		logger.info('');

		const top10 = mediumConfidence.slice(0, 10);
		for (const s of top10) {
			console.log(`  ${s.email}`);
			console.log(`    Current: ${s.currentLabel} → Suggested: ${s.suggestedLabel}`);
			console.log(`    Risk: ${s.riskScore.toFixed(2)} | Reason: ${s.reason}`);
			console.log('');
		}
	}

	// Calculate impact
	logger.subsection('Dataset Quality Metrics');
	const totalEmails = records.length;
	const fraudLabels = records.filter(r => r.label === 1).length;
	const legitLabels = records.filter(r => r.label === 0).length;
	const suspiciousFraud = suspiciousLabels.filter(s => s.currentLabel === 'fraud').length;
	const suspiciousLegit = suspiciousLabels.filter(s => s.currentLabel === 'legitimate').length;

	logger.info(`Total Records Analyzed: ${totalEmails}`);
	logger.info(`Fraud Labels: ${fraudLabels} (${((fraudLabels / totalEmails) * 100).toFixed(1)}%)`);
	logger.info(`Legit Labels: ${legitLabels} (${((legitLabels / totalEmails) * 100).toFixed(1)}%)`);
	logger.info('');
	logger.info(`Suspicious Fraud Labels: ${suspiciousFraud} (${((suspiciousFraud / fraudLabels) * 100).toFixed(1)}% of fraud)`);
	logger.info(`Suspicious Legit Labels: ${suspiciousLegit} (${((suspiciousLegit / legitLabels) * 100).toFixed(1)}% of legit)`);
	logger.info('');

	// Save results
	if (outputPath) {
		const output = {
			timestamp: new Date().toISOString(),
			dataset: datasetPath,
			endpoint,
			analyzed: records.length,
			suspicious: suspiciousLabels,
			metrics: {
				totalEmails,
				fraudLabels,
				legitLabels,
				suspiciousFraud,
				suspiciousLegit,
				qualityScore: ((totalEmails - suspiciousLabels.length) / totalEmails) * 100,
			},
		};

		fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
		logger.success(`Results saved to: ${outputPath}`);
	}

	// Recommendations
	logger.subsection('Recommendations');
	if (suspiciousLabels.length > totalEmails * 0.05) {
		logger.warn(`High mislabel rate (${((suspiciousLabels.length / totalEmails) * 100).toFixed(1)}%) detected`);
		logger.warn('Consider cleaning the dataset before retraining');
	} else {
		logger.success('Dataset quality looks good');
	}
	logger.info('');
	logger.info('Next steps:');
	logger.info('1. Review high-confidence mislabels manually');
	logger.info('2. Run: npm run cli dataset:clean --input dataset/pattern_labeled_emails.csv --output dataset/cleaned_emails.csv');
	logger.info('3. Retrain models with cleaned dataset');
}
