/**
 * Clean Enron dataset via CLI command.
 *
 * Mirrors the legacy scripts/clean_enron.py behavior but implemented in TypeScript
 * so the workflow stays inside the Bun CLI.
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { once } from 'events';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';

import { logger } from '../../utils/logger';
import { parseArgs, getOption } from '../../utils/args';

const EMAIL_STRIP_REGEX = /["'()\[\]{}]/g;
const WHITESPACE_REGEX = /\s+/g;

function normalizeEmail(value?: string | null): string | null {
	if (!value) return null;

	let email = value.trim().toLowerCase();
	if (!email) return null;

	email = email.replace(/mailto:/g, '');
	email = email.replace(/^<+/, '').replace(/>+$/, '');
	email = email.replace(EMAIL_STRIP_REGEX, '');
	email = email.replace(WHITESPACE_REGEX, '');
	email = email.replace(/[.,;]+$/, '');

	while (email.includes('..')) {
		email = email.replace('..', '.');
	}

	if (!email.includes('@')) return null;
	const parts = email.split('@');
	if (parts.length !== 2) return null;

	const [local, domain] = parts;
	if (!local || !domain || !domain.includes('.')) return null;

	return `${local}@${domain}`;
}

async function cleanEnron(inputPath: string, outputPath: string) {
	if (!existsSync(inputPath)) {
		throw new Error(`Input file not found: ${inputPath}`);
	}

	mkdirSync(dirname(outputPath), { recursive: true });

	const stats = { kept: 0, duplicates: 0, invalid: 0 };
	const seen = new Set<string>();

	const parser = parse({ columns: true, skip_empty_lines: true });
	const readStream = createReadStream(inputPath, { encoding: 'utf-8' });
	readStream.pipe(parser);

	const stringifier = stringify({
		header: true,
		columns: ['email', 'name', 'label', 'source'],
	});
	const writeStream = createWriteStream(outputPath, { encoding: 'utf-8' });
	stringifier.pipe(writeStream);

	for await (const record of parser) {
		const email = normalizeEmail(record?.email);
		if (!email) {
			stats.invalid += 1;
			continue;
		}
		if (seen.has(email)) {
			stats.duplicates += 1;
			continue;
		}
		seen.add(email);

		const rawLabel = (record?.label ?? '').trim().toLowerCase();
		const label = rawLabel.startsWith('fraud') ? 'fraud' : 'legit';
		const name = (record?.name ?? '').trim();

		stringifier.write([email, name, label, 'enron']);
		stats.kept += 1;
	}

	stringifier.end();
	await once(writeStream, 'finish');

	return stats;
}

export default async function cleanEnronCommand(rawArgs: string[]) {
	const parsed = parseArgs(rawArgs);
	const input = resolve(getOption(parsed, 'input') ?? 'data/enron.csv');
	const output = resolve(getOption(parsed, 'output') ?? 'data/enron-clean.csv');

	logger.section('🧼 Cleaning Enron Dataset');
	logger.info(`Input:  ${input}`);
	logger.info(`Output: ${output}`);

	try {
		const stats = await cleanEnron(input, output);
		logger.success(`Wrote ${stats.kept.toLocaleString()} rows to ${output}`);
		logger.info(
			`Skipped ${stats.duplicates.toLocaleString()} duplicates, ${stats.invalid.toLocaleString()} invalid rows`,
		);
	} catch (error) {
		logger.error(
			error instanceof Error ? error.message : `Failed to clean Enron dataset: ${String(error)}`,
		);
		process.exit(1);
	}
}
