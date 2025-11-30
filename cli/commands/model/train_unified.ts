/**
 * Unified Model Training Command
 *
 * Trains Random Forest models with configurable tree count.
 * A single tree (n_trees=1) acts as a traditional decision tree.
 * Multiple trees create an ensemble Random Forest.
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';

interface ModelTrainOptions {
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

function parseArgs(args: string[]): ModelTrainOptions {
	const options: ModelTrainOptions = {};

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
				options[camelKey as keyof ModelTrainOptions] = true as any;
			} else {
				// Value parameter
				const value = next;

				// Type coercion
				if (
					camelKey === 'nTrees' ||
					camelKey === 'maxDepth' ||
					camelKey === 'minSamplesLeaf'
				) {
					options[camelKey as keyof ModelTrainOptions] = parseInt(value, 10) as any;
				} else if (camelKey === 'conflictWeight') {
					options[camelKey as keyof ModelTrainOptions] = parseFloat(value) as any;
				} else if (camelKey === 'skipMx' || camelKey === 'upload') {
					options[camelKey as keyof ModelTrainOptions] = (value === 'true' || value === '1') as any;
				} else {
					options[camelKey as keyof ModelTrainOptions] = value as any;
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
║           🌲 Unified Model Training Command                   ║
╚═══════════════════════════════════════════════════════════════╝

DESCRIPTION
  Train Random Forest models with configurable tree count.

  • n_trees = 1  → Decision Tree (fast, small, ~5KB)
  • n_trees = 10 → Random Forest (balanced, ~28KB)
  • n_trees = 50 → High Accuracy Forest (~140KB)

USAGE
  npm run cli model:train [options]

OPTIONS
  --input <path>              Input CSV dataset (default: data/main.csv)
  --features <path>           Feature matrix output (default: data/features/export.csv)
  --label-column <name>       Label column name (default: label)
  --skip-mx                   Skip MX record lookups (faster, less accurate)
  --n-trees <n>               Number of trees (default: 10)
                              1 = decision tree, 10+ = random forest
  --max-depth <n>             Maximum tree depth (default: 6)
  --min-samples-leaf <n>      Minimum samples per leaf (default: 20)
  --conflict-weight <n>       Weight for conflict zone samples (default: 20.0)
  --output <path>             Model output path (auto-generated if not specified)
  --upload                    Upload to KV after training
  --kv-key <key>              KV key for upload (default: based on n_trees)
                              n_trees=1  → decision_tree.json
                              n_trees>1  → random_forest.json
  --binding <name>            KV binding name (default: CONFIG)
  --help, -h                  Show this help

EXAMPLES
  # Train decision tree (1 tree, fast, small)
  npm run cli model:train -- --n-trees 1 --skip-mx --upload

  # Train balanced random forest (10 trees, production default)
  npm run cli model:train -- --n-trees 10 --upload

  # Train high-accuracy forest (50 trees, best performance)
  npm run cli model:train -- --n-trees 50 --upload

  # Train and compare different tree counts
  npm run cli model:train -- --n-trees 10 --output models/rf-10.json
  npm run cli model:train -- --n-trees 20 --output models/rf-20.json
  npm run cli model:train -- --n-trees 50 --output models/rf-50.json
  npm run cli model:train -- --n-trees 100 --output models/rf-100.json

  # Custom conflict weighting
  npm run cli model:train -- --n-trees 50 --conflict-weight 30.0 --upload

  # Quick development iteration (skip MX, single tree)
  npm run cli model:train -- --n-trees 1 --skip-mx

PERFORMANCE COMPARISON
  Trees | Size   | Training | Inference | Accuracy
  ------|--------|----------|-----------|----------
  1     | ~5KB   | 10s      | 0.1ms     | 88%
  10    | ~28KB  | 2min     | 1ms       | 90%
  20    | ~56KB  | 4min     | 2ms       | 91%
  50    | ~140KB | 10min    | 5ms       | 92%
  100   | ~280KB | 20min    | 10ms      | 93%

NOTES
  - Conflict zone weighting helps catch high-entropy fraud patterns
  - Feature export with MX lookups can take 2-4 hours for large datasets
  - Use --skip-mx for faster iteration during development
  - Training requires Python venv with scikit-learn, pandas, numpy
  - Uploaded models are immediately available via KV hot-reload (60s TTL)
  - KV size limit: 25MB (safe up to ~800 trees)
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

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default async function modelTrainCommand(args: string[]) {
	const options = parseArgs(args);

	if (options.help) {
		showHelp();
		return;
	}

	const input = options.input || 'data/main.csv';
	const features = options.features || 'data/features/export.csv';
	const labelColumn = options.labelColumn || 'label';
	const skipMx = options.skipMx ?? false;
	const nTrees = options.nTrees ?? 10;
	const maxDepth = options.maxDepth || 6;
	const minSamplesLeaf = options.minSamplesLeaf || 20;
	const conflictWeight = options.conflictWeight || 20.0;
	const timestamp = new Date().toISOString().split('T')[0];

	// Auto-generate output path based on tree count
	const modelType = nTrees === 1 ? 'decision-tree' : 'random-forest';
	const defaultOutput = `config/production/${modelType}.${timestamp}.json`;
	const output = options.output || defaultOutput;

	const shouldUpload = options.upload ?? false;

	// Auto-select KV key based on tree count
	const defaultKvKey = nTrees === 1 ? 'decision_tree.json' : 'random_forest.json';
	const kvKey = options.kvKey || defaultKvKey;
	const binding = options.binding || 'CONFIG';

	const modelName = nTrees === 1 ? 'Decision Tree' : `Random Forest (${nTrees} trees)`;

	console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           🌲 ${modelName} Training Workflow${' '.repeat(Math.max(0, 30 - modelName.length))}║
╚═══════════════════════════════════════════════════════════════╝

Configuration:
  📥 Input:              ${input}
  📊 Features:           ${features}
  🏷️  Label Column:       ${labelColumn}
  🚫 Skip MX:            ${skipMx ? 'Yes (faster)' : 'No (full features)'}
  🌲 Trees:              ${nTrees} ${nTrees === 1 ? '(decision tree)' : '(random forest)'}
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

		// Step 2: Train model with Python
		console.log(`\n🌲 Step 2/3: Training ${modelName} (Python)...\n`);

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

		// Check model size
		const stats = statSync(output);
		const sizeBytes = stats.size;
		const sizeFormatted = formatBytes(sizeBytes);
		const sizeMB = sizeBytes / 1024 / 1024;

		console.log(`\n✅ ${modelName} trained successfully: ${output}`);
		console.log(`   Size: ${sizeFormatted}`);

		if (sizeMB > 25) {
			console.warn(`   ⚠️  WARNING: Model exceeds KV 25MB limit!`);
			console.warn(`   Reduce n-trees or max-depth to fit within limit.`);
			if (shouldUpload) {
				throw new Error('Model too large for KV upload (>25MB)');
			}
		}

		// Step 3: Upload to KV (optional)
		if (shouldUpload) {
			console.log(`\n☁️  Step 3/3: Uploading to KV (${kvKey} on ${binding})...\n`);

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
  🌲 Model:             ${output}
  📦 Size:              ${sizeFormatted}
  🌲 Trees:             ${nTrees} ${nTrees === 1 ? '(decision tree)' : '(random forest)'}
  ${shouldUpload ? `☁️  KV Location:       ${binding}/${kvKey}` : ''}

Next Steps:
  ${!shouldUpload ? '• Upload to KV:       npm run cli kv:put ' + kvKey + ' --file ' + output : ''}
  • Test model:         npm run cli test:batch -- --input <test-data.csv>
  • Deploy to prod:     npm run deploy
  ${nTrees < 50 ? '• Try more trees:     npm run cli model:train -- --n-trees ' + (nTrees * 2) + ' --upload' : ''}
`);

	} catch (error: any) {
		console.error(`\n❌ Training workflow failed: ${error.message}\n`);
		if (error.stack && process.env.DEBUG) {
			console.error('Stack trace:', error.stack);
		}
		process.exit(1);
	}
}
