/**
 * Model Training Commands
 *
 * Handles decision tree model training, feature export, and model management
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

interface TrainOptions {
	input?: string;
	features?: string;
	labelColumn?: string;
	skipMx?: boolean;
	maxDepth?: number;
	minSamplesLeaf?: number;
	output?: string;
	upload?: boolean;
	kvKey?: string;
	binding?: string;
	help?: boolean;
}

function parseTrainArgs(args: string[]): TrainOptions {
	const options: TrainOptions = {};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === '--help' || arg === '-h') {
			options.help = true;
			continue;
		}

		if (arg.startsWith('--')) {
			const key = arg.slice(2);
			const next = args[i + 1];

			if (!next || next.startsWith('--')) {
				// Boolean flag
				options[key as keyof TrainOptions] = true as any;
			} else {
				// Value parameter
				const value = next;

				// Type coercion for numeric values
				if (key === 'max-depth' || key === 'min-samples-leaf') {
					options[key.replace('-', '') as keyof TrainOptions] = parseInt(value, 10) as any;
				} else if (key === 'skip-mx' || key === 'upload') {
					options[key.replace('-', '') as keyof TrainOptions] = (value === 'true' || value === '1') as any;
				} else {
					options[key.replace('-', '') as keyof TrainOptions] = value as any;
				}

				i++;
			}
		}
	}

	return options;
}

function showHelp() {
	console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           🌲 Decision Tree Training Command                   ║
╚═══════════════════════════════════════════════════════════════╝

USAGE
  npm run cli tree:train [options]

OPTIONS
  --input <path>              Input CSV dataset (default: data/main.csv)
  --features <path>           Feature matrix output (default: data/features/export.csv)
  --label-column <name>       Label column name (default: label)
  --skip-mx                   Skip MX record lookups (faster, less accurate)
  --max-depth <n>             Maximum tree depth (default: 6)
  --min-samples-leaf <n>      Minimum samples per leaf (default: 50)
  --output <path>             Model output path (default: config/production/decision-tree.<date>.json)
  --upload                    Upload to KV after training
  --kv-key <key>              KV key for upload (default: decision_tree.json)
  --binding <name>            KV binding name (default: CONFIG)
  --help, -h                  Show this help

EXAMPLES
  # Quick training without MX (fast)
  npm run cli tree:train -- --skip-mx

  # Full training with MX features and upload
  npm run cli tree:train -- --upload

  # Custom parameters for improved model
  npm run cli tree:train -- --max-depth 8 --min-samples-leaf 30 --upload

  # Train on custom dataset
  npm run cli tree:train -- --input data/my-dataset.csv --output models/custom-tree.json

NOTES
  - Feature export with MX lookups can take 2-4 hours for large datasets
  - Use --skip-mx for faster iteration during development
  - Training requires Python venv with scikit-learn, pandas, numpy
  - Uploaded models are immediately available via KV hot-reload
`);
}

function run(command: string, args: string[], opts = {}): { success: boolean; stderr?: string } {
	console.log(`\n🔧 Running: ${command} ${args.join(' ')}\n`);

	const result = spawnSync(command, args, {
		stdio: 'inherit',
		cwd: resolve(__dirname, '../../..'),
		...opts
	});

	if (result.error) {
		console.error(`\n❌ Command failed to execute: ${result.error.message}`);
		return { success: false, stderr: result.error.message };
	}

	if (result.status !== 0) {
		console.error(`\n❌ Command exited with code ${result.status}`);
		return { success: false, stderr: `Exit code ${result.status}` };
	}

	return { success: true };
}

export default async function trainCommand(args: string[]) {
	const options = parseTrainArgs(args);

	if (options.help) {
		showHelp();
		return;
	}

	const input = options.input || 'data/main.csv';
	const features = options.features || 'data/features/export.csv';
	const labelColumn = options.labelColumn || 'label';
	const skipMx = options.skipMx ?? false;
	const timestamp = new Date().toISOString().split('T')[0];
	const output = options.output || `config/production/decision-tree.${timestamp}.json`;
	const maxDepth = options.maxDepth || 6;
	const minSamplesLeaf = options.minSamplesLeaf || 50;
	const shouldUpload = options.upload ?? false;
	const kvKey = options.kvKey || 'decision_tree.json';
	const binding = options.binding || 'CONFIG';

	console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           🌲 Decision Tree Training Workflow                  ║
╚═══════════════════════════════════════════════════════════════╝

Configuration:
  📥 Input:              ${input}
  📊 Features:           ${features}
  🏷️  Label Column:       ${labelColumn}
  🚫 Skip MX:            ${skipMx ? 'Yes (faster)' : 'No (full features)'}
  📏 Max Depth:          ${maxDepth}
  🌿 Min Samples/Leaf:   ${minSamplesLeaf}
  💾 Output:             ${output}
  ☁️  Upload to KV:       ${shouldUpload ? `Yes (${kvKey} on ${binding})` : 'No'}
`);

	// Validation
	if (!existsSync(input)) {
		console.error(`\n❌ Error: Input file not found: ${input}`);
		console.error('   Please check the path and try again.\n');
		process.exit(1);
	}

	const venvPython = 'venv/bin/python';
	if (!existsSync(venvPython)) {
		console.error(`\n❌ Error: Python venv not found at ${venvPython}`);
		console.error('   Please set up the venv first:\n');
		console.error('   python -m venv venv');
		console.error('   source venv/bin/activate');
		console.error('   pip install scikit-learn pandas numpy\n');
		process.exit(1);
	}

	try {
		// Step 1: Export features
		console.log('📤 Step 1/3: Exporting features...\n');

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

		const exportResult = run('npm', featureArgs);
		if (!exportResult.success) {
			throw new Error('Feature export failed');
		}

		// Step 2: Train model with Python
		console.log('\n🌲 Step 2/3: Training decision tree (Python)...\n');

		const trainResult = run(venvPython, [
			'cli/commands/model/export_tree.py',
			'--dataset',
			features,
			'--output',
			output,
			'--max-depth',
			String(maxDepth),
			'--min-samples-leaf',
			String(minSamplesLeaf),
		]);

		if (!trainResult.success) {
			throw new Error('Model training failed');
		}

		if (!existsSync(output)) {
			throw new Error(`Model output file not created: ${output}`);
		}

		console.log(`\n✅ Model trained successfully: ${output}\n`);

		// Step 3: Upload to KV (optional)
		if (shouldUpload) {
			console.log(`☁️  Step 3/3: Uploading to KV (${kvKey} on ${binding})...\n`);

			const uploadResult = run('npm', [
				'run',
				'cli',
				'--',
				'kv:put',
				kvKey,
				'--binding',
				binding,
				'--file',
				output,
			]);

			if (!uploadResult.success) {
				throw new Error('KV upload failed');
			}

			console.log(`\n✅ Model uploaded to KV successfully!\n`);
		}

		// Summary
		console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                   ✅ Training Complete!                        ║
╚═══════════════════════════════════════════════════════════════╝

Results:
  📊 Feature Matrix:    ${features}
  🌲 Trained Model:     ${output}
  ${shouldUpload ? `☁️  KV Location:       ${binding}/${kvKey}` : ''}

Next Steps:
  ${!shouldUpload ? '• Upload model to KV:  npm run cli kv:put decision_tree.json --file ' + output : ''}
  • Test model:         npm run cli test:batch -- --input <test-data.csv>
  • Deploy to prod:     npm run cli deploy
`);

	} catch (error: any) {
		console.error(`\n❌ Training workflow failed: ${error.message}\n`);
		console.error('Stack trace:', error.stack);
		process.exit(1);
	}
}
