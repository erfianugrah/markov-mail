#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function parseArgs(argv) {
	const options = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith('--')) continue;
		const key = arg.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith('--')) {
			options[key] = true;
			continue;
		}
		options[key] = next;
		i++;
	}
	return options;
}

function run(command, args, opts = {}) {
	const result = spawnSync(command, args, { stdio: 'inherit', ...opts });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed`);
	}
}

async function main() {
	const argv = process.argv.slice(2);
	const options = parseArgs(argv);
	const input = options.input || 'data/main.csv';
	const features = options.features || 'data/features/export.csv';
	const labelColumn = options['label-column'] || 'label';
	const skipMx = options['skip-mx'] === 'true' || options['skip-mx'] === true;
	const timestamp = new Date().toISOString().split('T')[0];
	const output =
		options.output ||
		`config/production/decision-tree.${timestamp}.json`;
	const maxDepth = options['max-depth'] || '6';
	const minSamplesLeaf = options['min-samples-leaf'] || '50';
	const shouldUpload =
		options.upload === 'true' ||
		options.upload === true ||
		options.upload === '1';
	const kvKey = options['kv-key'] || 'decision_tree.json';
	const binding = options.binding || 'CONFIG';

	console.log('📤 Exporting features...');
	const featureArgs = [
		'run',
		'cli',
		'--',
		'features:export',
		'--input',
		input,
		'--output',
		features,
		'--label-column',
		labelColumn,
	];
	if (skipMx) {
		featureArgs.push('--skip-mx');
	}
	run('npm', featureArgs, { cwd: resolve(__dirname, '..') });

	console.log('🌲 Training decision tree (Python)...');
	run(
		'python',
		[
			'ml/export_tree.py',
			'--dataset',
			features,
			'--output',
			output,
			'--max-depth',
			String(maxDepth),
			'--min-samples-leaf',
			String(minSamplesLeaf),
		],
		{ cwd: resolve(__dirname, '..') }
	);

	if (shouldUpload) {
		console.log(`☁️  Uploading ${output} to KV (${kvKey})...`);
		run(
			'npm',
			[
				'run',
				'cli',
				'--',
				'kv:put',
				kvKey,
				'--binding',
				binding,
				'--file',
				output,
			],
			{ cwd: resolve(__dirname, '..') }
		);
	}

	console.log('✅ Decision tree training workflow completed.');
	console.log(`   Feature matrix: ${features}`);
	console.log(`   Tree output:    ${output}`);
	if (shouldUpload) {
		console.log(`   Uploaded to KV key "${kvKey}" on binding "${binding}"`);
	}
}

main().catch((error) => {
	console.error('❌ train-decision-tree failed:', error.message);
	process.exit(1);
});
