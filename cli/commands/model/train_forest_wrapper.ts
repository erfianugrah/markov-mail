/**
 * Random Forest Training Command
 *
 * Handles Random Forest model training with conflict zone weighting,
 * feature export, and model management
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

interface ForestTrainOptions {
	input?: string;
	features?: string;
	labelColumn?: string;
	skipMx?: boolean;
	nTrees?: number;
	maxDepth?: number;
	minSamplesLeaf?: number;
	conflictWeight?: number;
	output?: string;
	upload?: boolean;
	kvKey?: string;
	binding?: string;
	help?: boolean;
}

function parseForestTrainArgs(args: string[]): ForestTrainOptions {
	const options: ForestTrainOptions = {};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === '--help' || arg === '-h') {
			options.help = true;
			continue;
		}

		if (arg.startsWith('--')) {
			const key = arg.slice(2);
			const next = args[i + 1];

			// Convert kebab-case to camelCase
			const camelKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

			if (!next || next.startsWith('--')) {
				// Boolean flag
				options[camelKey as keyof ForestTrainOptions] = true as any;
			} else {
				// Value parameter
				const value = next;

				// Type coercion for numeric values
				if (
					camelKey === 'nTrees' ||
					camelKey === 'maxDepth' ||
					camelKey === 'minSamplesLeaf'
				) {
					options[camelKey as keyof ForestTrainOptions] = parseInt(value, 10) as any;
				} else if (camelKey === 'conflictWeight') {
					options[camelKey as keyof ForestTrainOptions] = parseFloat(value) as any;
				} else if (camelKey === 'skipMx' || camelKey === 'upload') {
					options[camelKey as keyof ForestTrainOptions] = (value === 'true' || value === '1') as any;
				} else {
					options[camelKey as keyof ForestTrainOptions] = value as any;
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
║           🌲 Random Forest Training Command                   ║
╚═══════════════════════════════════════════════════════════════╝

USAGE
  npm run cli forest:train [options]

OPTIONS
  --input <path>              Input CSV dataset (default: data/main.csv)
  --features <path>           Feature matrix output (default: data/features/export.csv)
  --label-column <name>       Label column name (default: label)
  --skip-mx                   Skip MX record lookups (faster, less accurate)
  --n-trees <n>               Number of trees (default: 10, test: 20, 50, 100)
  --max-depth <n>             Maximum tree depth (default: 6)
  --min-samples-leaf <n>      Minimum samples per leaf (default: 20)
  --conflict-weight <n>       Weight for conflict zone samples (default: 20.0)
  --output <path>             Model output path (default: config/production/random-forest.<date>.json)
  --upload                    Upload to KV after training
  --kv-key <key>              KV key for upload (default: random_forest.json)
  --binding <name>            KV binding name (default: CONFIG)
  --help, -h                  Show this help

EXAMPLES
  # Quick training with 10 trees
  npm run cli forest:train -- --skip-mx

  # Production training with 50 trees and upload
  npm run cli forest:train -- --n-trees 50 --upload

  # Test different tree counts for performance comparison
  npm run cli forest:train -- --n-trees 20 --output models/rf-20trees.json
  npm run cli forest:train -- --n-trees 50 --output models/rf-50trees.json
  npm run cli forest:train -- --n-trees 100 --output models/rf-100trees.json

  # Custom conflict weighting
  npm run cli forest:train -- --conflict-weight 30.0 --upload

  # Full featured training
  npm run cli forest:train -- --n-trees 50 --max-depth 6 --min-samples-leaf 20 --upload

NOTES
  - Random Forest uses conflict zone weighting to handle high-entropy fraud patterns
  - Feature export with MX lookups can take 2-4 hours for large datasets
  - Use --skip-mx for faster iteration during development
  - Training requires Python venv with scikit-learn, pandas, numpy
  - Uploaded models are immediately available via KV hot-reload (60s TTL)
  - More trees = better accuracy but larger model size (KV limit: 25MB)
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

export default async function forestTrainCommand(args: string[]) {
	const options = parseForestTrainArgs(args);

	if (options.help) {
		showHelp();
		return;
	}

	const input = options.input || 'data/main.csv';
	const features = options.features || 'data/features/export.csv';
	const labelColumn = options.labelColumn || 'label';
	const skipMx = options.skipMx ?? false;
	const timestamp = new Date().toISOString().split('T')[0];
	const output = options.output || `config/production/random-forest.${timestamp}.json`;
	const nTrees = options.nTrees || 10;
	const maxDepth = options.maxDepth || 6;
	const minSamplesLeaf = options.minSamplesLeaf || 20;
	const conflictWeight = options.conflictWeight || 20.0;
	const shouldUpload = options.upload ?? false;
	const kvKey = options.kvKey || 'random_forest.json';
	const binding = options.binding || 'CONFIG';

	console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           🌲🌲 Random Forest Training Workflow                 ║
╚═══════════════════════════════════════════════════════════════╝

Configuration:
  📥 Input:              ${input}
  📊 Features:           ${features}
  🏷️  Label Column:       ${labelColumn}
  🚫 Skip MX:            ${skipMx ? 'Yes (faster)' : 'No (full features)'}
  🌲 Number of Trees:    ${nTrees}
  📏 Max Depth:          ${maxDepth}
  🌿 Min Samples/Leaf:   ${minSamplesLeaf}
  ⚖️  Conflict Weight:    ${conflictWeight}x
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

		// Step 2: Train Random Forest with Python
		console.log('\n🌲 Step 2/3: Training Random Forest (Python)...\n');

		const trainResult = run(venvPython, [
			'cli/commands/model/train_forest.py',
			'--dataset',
			features,
			'--output',
			output,
			'--n-trees',
			String(nTrees),
			'--max-depth',
			String(maxDepth),
			'--min-samples-leaf',
			String(minSamplesLeaf),
			'--conflict-weight',
			String(conflictWeight),
		]);

		if (!trainResult.success) {
			throw new Error('Model training failed');
		}

		if (!existsSync(output)) {
			throw new Error(`Model output file not created: ${output}`);
		}

		console.log(`\n✅ Random Forest trained successfully: ${output}\n`);

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
  🌲 Random Forest:     ${output}
  ${shouldUpload ? `☁️  KV Location:       ${binding}/${kvKey}` : ''}
  🌲 Trees:             ${nTrees}
  ⚖️  Conflict Weight:   ${conflictWeight}x

Next Steps:
  ${!shouldUpload ? '• Upload model to KV:  npm run cli kv:put random_forest.json --file ' + output : ''}
  • Test model:         npm run cli test:batch -- --input <test-data.csv>
  • Deploy to prod:     npm run cli deploy
  • Try more trees:     npm run cli forest:train -- --n-trees 50 --upload
`);

	} catch (error: any) {
		console.error(`\n❌ Training workflow failed: ${error.message}\n`);
		console.error('Stack trace:', error.stack);
		process.exit(1);
	}
}
