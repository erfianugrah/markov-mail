/**
 * Dataset Cleaning Command
 * Clean dataset by correcting mislabeled emails based on analysis
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';
import * as fs from 'fs';

export default async function cleanDataset(args: string[]) {
	const parsed = parseArgs(args);
	const inputPath = getOption(parsed, 'input') || 'dataset/pattern_labeled_emails.csv';
	const outputPath = getOption(parsed, 'output') || 'dataset/cleaned_emails.csv';
	const analysisPath = getOption(parsed, 'analysis');
	const dryRun = hasFlag(parsed, 'dry-run');
	const minConfidence = getOption(parsed, 'min-confidence') || 'medium'; // high, medium, low

	logger.section('Dataset Cleaning');
	logger.info(`Input: ${inputPath}`);
	logger.info(`Output: ${outputPath}`);
	logger.info(`Min Confidence: ${minConfidence}`);
	logger.info(`Dry Run: ${dryRun ? 'Yes' : 'No'}`);
	logger.info('');

	// Load dataset
	if (!fs.existsSync(inputPath)) {
		logger.error(`Dataset not found: ${inputPath}`);
		process.exit(1);
	}

	const content = fs.readFileSync(inputPath, 'utf-8');
	const lines = content.trim().split('\n');
	const header = lines[0];

	// Load analysis results if provided
	let suspiciousEmails = new Map<string, { suggestedLabel: string; confidence: string }>();
	if (analysisPath && fs.existsSync(analysisPath)) {
		const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf-8'));
		for (const s of analysis.suspicious) {
			suspiciousEmails.set(s.email, {
				suggestedLabel: s.suggestedLabel,
				confidence: s.confidence,
			});
		}
		logger.info(`Loaded ${suspiciousEmails.size} suspicious labels from analysis`);
	}

	// Apply heuristic-based cleaning rules
	const corrections: Array<{
		email: string;
		oldLabel: string;
		newLabel: string;
		reason: string;
	}> = [];

	const cleanedLines = [header];
	let corrected = 0;
	let skipped = 0;

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;

		const [email, label] = line.split(',');
		if (!email || label === undefined) continue;

		let newLabel = label;
		let reason = '';
		let shouldCorrect = false;

		// Check analysis results first
		const suspicious = suspiciousEmails.get(email);
		if (suspicious) {
			const confidenceLevel = suspicious.confidence;
			const meetsThreshold =
				(minConfidence === 'low') ||
				(minConfidence === 'medium' && confidenceLevel !== 'low') ||
				(minConfidence === 'high' && confidenceLevel === 'high');

			if (meetsThreshold) {
				newLabel = suspicious.suggestedLabel === 'legitimate' ? '0' : '1';
				reason = `Analysis: ${confidenceLevel} confidence`;
				shouldCorrect = newLabel !== label;
			}
		}
		// Apply heuristic rules if no analysis available
		else {
			const [localPart, domain] = email.split('@');
			const currentLabel = parseInt(label);

			// Rule 1: Professional firstname.lastname pattern labeled as fraud
			if (currentLabel === 1) {
				const hasRealName = /^[a-z]+\.[a-z]+$/i.test(localPart);
				const hasCompanyDomain = domain && /\.(com|org|edu|gov|co\.[a-z]{2}|ac\.[a-z]{2})$/.test(domain);
				const excludeBadDomains = !/(temp|fake|test|spam|trash|throwaway|guerrilla)/i.test(domain);

				if (hasRealName && hasCompanyDomain && excludeBadDomains) {
					newLabel = '0';
					reason = 'Heuristic: Professional email pattern';
					shouldCorrect = true;
				}
			}

			// Rule 2: Plus addressing labeled as fraud
			if (currentLabel === 1 && /\+/.test(localPart)) {
				const basePart = localPart.split('+')[0];
				const isReasonableBase = /^[a-z]{3,}$/i.test(basePart);
				if (isReasonableBase) {
					newLabel = '0';
					reason = 'Heuristic: Legitimate plus addressing';
					shouldCorrect = true;
				}
			}

			// Rule 3: Known legitimate domains labeled as fraud
			const knownLegitDomains = [
				'w3.org', 'ietf.org', 'ieee.org', 'apache.org', 'mozilla.org',
				'python.org', 'kernel.org', 'fsf.org', 'gnu.org',
			];
			if (currentLabel === 1 && knownLegitDomains.some(d => domain.endsWith(d))) {
				newLabel = '0';
				reason = 'Heuristic: Known legitimate domain';
				shouldCorrect = true;
			}

			// Rule 4: University/academic emails labeled as fraud
			if (currentLabel === 1 && /\.(edu|ac\.[a-z]{2})$/.test(domain)) {
				const hasReasonableLocal = /^[a-z]{2,15}$/i.test(localPart) || /^[a-z]+\.[a-z]+$/i.test(localPart);
				if (hasReasonableLocal) {
					newLabel = '0';
					reason = 'Heuristic: Academic domain';
					shouldCorrect = true;
				}
			}

			// Rule 5: Very short random strings labeled as legit (likely fraud)
			if (currentLabel === 0) {
				const hasRandomPattern = /^[a-z]{1,3}[0-9]{4,}$/i.test(localPart);
				const hasSequentialNumbers = /12345|67890|11111|22222/.test(localPart);
				const hasKeyboardWalk = /(qwerty|asdfgh|zxcvbn)/i.test(localPart);

				if ((hasRandomPattern || hasSequentialNumbers || hasKeyboardWalk) && localPart.length > 8) {
					newLabel = '1';
					reason = 'Heuristic: Fraud pattern detected';
					shouldCorrect = true;
				}
			}
		}

		if (shouldCorrect) {
			corrections.push({
				email,
				oldLabel: label === '0' ? 'legitimate' : 'fraudulent',
				newLabel: newLabel === '0' ? 'legitimate' : 'fraudulent',
				reason,
			});
			corrected++;
		}

		cleanedLines.push(`${email},${newLabel}`);
	}

	// Report changes
	logger.subsection('Cleaning Results');
	logger.info(`Total Records: ${lines.length - 1}`);
	logger.info(`Corrected: ${corrected} (${((corrected / (lines.length - 1)) * 100).toFixed(2)}%)`);
	logger.info(`Unchanged: ${lines.length - 1 - corrected}`);
	logger.info('');

	if (corrections.length > 0) {
		logger.subsection('Sample Corrections (First 20)');
		for (const c of corrections.slice(0, 20)) {
			console.log(`  ${c.email}`);
			console.log(`    ${c.oldLabel} → ${c.newLabel}`);
			console.log(`    Reason: ${c.reason}`);
			console.log('');
		}
	}

	// Generate review file for human verification
	const reviewPath = outputPath.replace('.csv', '_review.csv');
	const reviewLines = ['email,current_label,suggested_label,reason,confidence'];

	for (const c of corrections) {
		const currentLabel = c.oldLabel === 'legitimate' ? '0' : '1';
		const suggestedLabel = c.newLabel === 'legitimate' ? '0' : '1';
		const confidence = c.reason.includes('Analysis: high') ? 'high' :
			c.reason.includes('Analysis: medium') ? 'medium' :
			c.reason.includes('Heuristic') ? 'low' : 'unknown';

		// Escape reason text by replacing quotes and removing special characters
		const escapedReason = c.reason.replace(/"/g, '""');
		reviewLines.push(`${c.email},${currentLabel},${suggestedLabel},"${escapedReason}",${confidence}`);
	}

	fs.writeFileSync(reviewPath, reviewLines.join('\n'));
	logger.success(`Review file saved to: ${reviewPath}`);
	logger.info('');

	// Write cleaned output only if not dry run
	if (!dryRun) {
		fs.writeFileSync(outputPath, cleanedLines.join('\n'));
		logger.success(`Cleaned dataset saved to: ${outputPath}`);
		logger.warn('⚠️  AUTO-CLEANED - REQUIRES HUMAN REVIEW');
	} else {
		logger.info('Dry run - no files written');
	}

	// Summary
	logger.subsection('Next Steps - HUMAN REVIEW REQUIRED');
	logger.info('');
	logger.warn('Automated cleaning is NOT sufficient for production use!');
	logger.info('');
	logger.info('1. Review the corrections file:');
	logger.info(`   Open ${reviewPath} in Excel/Google Sheets`);
	logger.info('2. For each correction:');
	logger.info('   - Verify the email looks legitimate/fraudulent');
	logger.info('   - Check the reason makes sense');
	logger.info('   - Focus on HIGH confidence corrections first');
	logger.info('3. Manually edit the original dataset based on your review');
	logger.info('4. Retrain models with human-verified dataset:');
	logger.info(`   npm run cli train:markov --dataset ${outputPath} --upload --remote`);
	logger.info('5. Run batch test to verify improved accuracy:');
	logger.info(`   npm run cli test:batch --dataset ${outputPath}`);
}
