/**
 * Full automation pipeline: export features, train model, run guardrail,
 * update thresholds, sync config, and snapshot artifacts.
 */

import { resolve, join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { $ } from 'bun';

import { parseArgs, getOption, hasFlag } from '../../utils/args';
import { logger } from '../../utils/logger';

import featuresExport from '../features/export';
import modelTrain from './train_unified';
import guardrail, { GuardrailError, type GuardrailRecommendation } from './guardrail';
import updateThresholds from '../config/update-thresholds';
import snapshotArtifacts from '../artifacts/snapshot';

type Step = () => Promise<void>;
type AttemptConfig = {
	label?: string;
	nTrees?: number;
	maxDepth?: number;
	minSamplesLeaf?: number;
	conflictWeight?: number;
	skipMx?: boolean;
	noSplit?: boolean;
	featureMode?: string;
};

type AttemptSummary = {
	label: string;
	params: AttemptConfig;
	status: 'success' | 'failed';
	message?: string;
	details?: Record<string, unknown>;
};

type ExportModeConfig = {
	name: string;
	skipMx: boolean;
	output: string;
};

type ExportModeState = ExportModeConfig & { completed: boolean };

type UploadState = {
	target: string;
	binding: string;
	dryRun: boolean;
	success: boolean;
	message?: string;
};

type ConfigSyncState = {
	configPath: string;
	heuristicsPath: string;
	binding: string;
	dryRun: boolean;
	success: boolean;
	message?: string;
};

type PipelineManifest = {
	runId: string;
	runDir: string;
	createdAt: string;
	dataset: string;
	labelColumn: string;
	exportModes: ExportModeState[];
	attempts: AttemptSummary[];
	finalAttempt?: AttemptSummary;
	finalRecommendation?: GuardrailRecommendation;
	thresholdsApplied?: boolean;
	upload?: UploadState;
	configSync?: ConfigSyncState;
	artifactsDir?: string;
	status: 'running' | 'success' | 'failed';
	failureReason?: string;
};

function determineRunId(): string {
	return new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
}

function listRunDirs(baseDir: string): string[] {
	if (!existsSync(baseDir)) {
		return [];
	}
	return readdirSync(baseDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(entry.name))
		.sort()
		.map((entry) => entry.name);
}

async function runStep(name: string, fn: Step) {
	logger.section(name);
	await fn();
}

async function syncConfigFiles(configPath: string, heuristicsPath: string, binding: string, dryRun: boolean) {
	if (!existsSync(configPath)) {
		throw new Error(`Config file not found: ${configPath}`);
	}
	if (!existsSync(heuristicsPath)) {
		throw new Error(`Risk heuristics file not found: ${heuristicsPath}`);
	}

	if (dryRun) {
		logger.info(`[dry-run] Would upload ${configPath} → config.json`);
		logger.info(`[dry-run] Would upload ${heuristicsPath} → risk-heuristics.json`);
		return;
	}

	await $`npx wrangler kv key put config.json --path=${configPath} --binding=${binding} --remote`;
	logger.success('config.json updated in KV');

	await $`npx wrangler kv key put risk-heuristics.json --path=${heuristicsPath} --binding=${binding} --remote`;
	logger.success('risk-heuristics.json updated in KV');
}

async function uploadModelToKv(modelPath: string, binding: string, kvKey: string, dryRun: boolean) {
	if (!existsSync(modelPath)) {
		throw new Error(`Model file not found: ${modelPath}`);
	}

	if (dryRun) {
		logger.info(`[dry-run] Would upload ${modelPath} → ${kvKey}`);
		return;
	}

	await $`npx wrangler kv key put ${kvKey} --path=${modelPath} --binding=${binding} --remote`;
	logger.success(`Uploaded ${modelPath} to KV key ${kvKey}`);
}

async function runGuardrailWithRetries(
	args: string[],
	retries: number,
	adjustment: { thresholdStep?: string; thresholdMin?: string; thresholdMax?: string }
): Promise<GuardrailRecommendation> {
	try {
		return await guardrail(args);
	} catch (error) {
		if (!(error instanceof GuardrailError) || retries <= 0) {
			throw error;
		}
		logger.warn(`Guardrail failed (${error.message}). Retrying calibration (${retries} remaining)...`);
		const retryArgs = [...args];
		if (adjustment.thresholdStep) retryArgs.push('--threshold-step', adjustment.thresholdStep);
		if (adjustment.thresholdMin) retryArgs.push('--threshold-min', adjustment.thresholdMin);
		if (adjustment.thresholdMax) retryArgs.push('--threshold-max', adjustment.thresholdMax);
		return runGuardrailWithRetries(retryArgs, retries - 1, adjustment);
	}
}

function parseSearchConfigs(raw: string | undefined): AttemptConfig[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			throw new Error('Search definition must be a JSON array');
		}
		return parsed.map((entry, index) => {
			if (typeof entry !== 'object' || entry === null) {
				throw new Error(`Search entry at index ${index} must be an object`);
			}
			return entry as AttemptConfig;
		});
	} catch (error) {
		throw new Error(`Failed to parse --search: ${(error as Error).message}`);
	}
}

function attemptLabel(idx: number, total: number, override?: string) {
	const base = `Attempt ${idx + 1}/${total}`;
	return override ? `${base} – ${override}` : base;
}

function normalizeExportModes(raw: string | undefined, featuresOutput: string, fastOutput?: string): ExportModeConfig[] {
	const tokens = (raw ?? 'full').split(',').map((token) => token.trim()).filter(Boolean);
	const unique = Array.from(new Set(tokens.length ? tokens : ['full']));
	return unique.map((mode) => {
		if (mode === 'fast') {
			const output = fastOutput ?? featuresOutput.replace(/\.csv$/i, '.fast.csv');
			return { name: 'fast', skipMx: true, output };
		}
		if (mode === 'full') {
			return { name: 'full', skipMx: false, output: featuresOutput };
		}
		throw new Error(`Unknown export mode "${mode}". Supported modes: fast, full.`);
	});
}

async function ensureExport(
	mode: ExportModeConfig,
	datasetPath: string,
	labelColumn: string,
	exportedModes: Set<string>,
	force?: boolean
) {
	if (exportedModes.has(mode.name) && !force) {
		return;
	}

	logger.section(`1️⃣ Feature Export (${mode.name})`);
	const args = ['--input', datasetPath, '--output', mode.output, '--label-column', labelColumn];
	if (mode.skipMx) {
		args.push('--skip-mx');
	}
	await featuresExport(args);
	exportedModes.add(mode.name);
}

function markExportComplete(manifestPath: string, modeName: string) {
	updateManifest(manifestPath, (manifest) => {
		const entry = manifest.exportModes.find((m) => m.name === modeName);
		if (entry) {
			entry.completed = true;
		}
	});
}

function createRunDir(baseDir?: string): { runDir: string; manifestPath: string } {
	const dir = resolve(
		baseDir ?? join('tmp', 'pipeline-runs', new Date().toISOString().replace(/[:T]/g, '-').split('.')[0])
	);
	mkdirSync(dir, { recursive: true });
	const manifestPath = join(dir, 'manifest.json');
	return { runDir: dir, manifestPath };
}

function writeManifest(path: string, manifest: PipelineManifest) {
	writeFileSync(path, JSON.stringify(manifest, null, 2));
}

function readManifest(path: string): PipelineManifest {
	return JSON.parse(readFileSync(path, 'utf-8')) as PipelineManifest;
}

function initManifest(
	manifestPath: string,
	data: {
		runDir: string;
		dataset: string;
		labelColumn: string;
		exportModes: ExportModeConfig[];
	}
): PipelineManifest {
	const manifest: PipelineManifest = {
		runId: `${Date.now()}`,
		runDir: data.runDir,
		createdAt: new Date().toISOString(),
		dataset: data.dataset,
		labelColumn: data.labelColumn,
		exportModes: data.exportModes.map((mode) => ({ ...mode, completed: false })),
		attempts: [],
		status: 'running',
	};
	writeManifest(manifestPath, manifest);
	return manifest;
}

function updateManifest(manifestPath: string, update: (manifest: PipelineManifest) => void): PipelineManifest {
	const manifest = readManifest(manifestPath);
	update(manifest);
	writeManifest(manifestPath, manifest);
	return manifest;
}

export default async function automationPipeline(rawArgs: string[]) {
	const parsed = parseArgs(rawArgs);

	const datasetPath = resolve(getOption(parsed, 'dataset') ?? 'data/main.csv');
	const labelColumn = getOption(parsed, 'label-column') ?? 'label';
	const featuresOutput = resolve(getOption(parsed, 'features-output') ?? 'data/features/export.csv');
	const fastFeaturesOutput = resolve(
		getOption(parsed, 'fast-features-output') ?? featuresOutput.replace(/\.csv$/i, '.fast.csv')
	);
	const modelOutput = resolve(getOption(parsed, 'model-output') ?? 'config/production/random-forest.auto.json');
	const calibrationInput = resolve(getOption(parsed, 'calibration-input') ?? 'data/calibration/latest.csv');
	const calibratedOutput = resolve(getOption(parsed, 'calibrated-output') ?? 'data/calibration/calibrated.guardrail.csv');
	const scanJson = resolve(getOption(parsed, 'scan-json') ?? 'data/calibration/threshold-scan.json');
	const scanCsv = resolve(getOption(parsed, 'scan-csv') ?? 'data/calibration/threshold-scan.csv');
	const recommendationPath = resolve(getOption(parsed, 'recommendation') ?? 'data/calibration/threshold-recommendation.json');
	const configPath = resolve(getOption(parsed, 'config') ?? 'config/production/config.json');
	const heuristicsPath = resolve(getOption(parsed, 'heuristics') ?? 'config/risk-heuristics.json');
	const binding = getOption(parsed, 'binding') ?? 'CONFIG';
	const snapshotOutput = getOption(parsed, 'snapshot-output');
	const exportModes = normalizeExportModes(getOption(parsed, 'export-modes'), featuresOutput, fastFeaturesOutput);
	const searchOption = getOption(parsed, 'search');
	const searchConfigs = parseSearchConfigs(searchOption);
	const attempts = searchConfigs.length ? searchConfigs : [{}];
	const runDirOption = getOption(parsed, 'run-dir');
	const resumeDirOption = getOption(parsed, 'resume');

	let runDir: string;
	let manifestPath: string;
	let manifest: PipelineManifest;

	if (resumeDirOption) {
		const resumeDir =
			resumeDirOption === 'latest'
				? (() => {
						const runsBase = resolve(runDirOption ?? join('tmp', 'pipeline-runs'));
						const dirs = listRunDirs(runsBase);
						if (!dirs.length) {
							throw new Error(`No previous runs found under ${runsBase}`);
						}
						return join(runsBase, dirs[dirs.length - 1]);
				  })()
				: resolve(resumeDirOption);
		runDir = resumeDir;
		manifestPath = join(runDir, 'manifest.json');
		if (!existsSync(manifestPath)) {
			throw new Error(`Resume manifest not found at ${manifestPath}`);
		}
		manifest = readManifest(manifestPath);
		if (manifest.status === 'success') {
			throw new Error('Cannot resume a completed run (status=success).');
		}
		if (manifest.dataset !== datasetPath) {
			logger.warn(`Dataset mismatch: manifest=${manifest.dataset}, current=${datasetPath}`);
		}
		if (manifest.labelColumn !== labelColumn) {
			logger.warn(`Label column mismatch: manifest=${manifest.labelColumn}, current=${labelColumn}`);
		}
	} else {
		const { runDir: dir, manifestPath: path } = createRunDir(runDirOption);
		runDir = dir;
		manifestPath = path;
		manifest = initManifest(manifestPath, {
			runDir,
			dataset: datasetPath,
			labelColumn,
			exportModes,
		});
	}

	const skipExport = hasFlag(parsed, 'skip-export');
	const skipGuardrail = hasFlag(parsed, 'skip-guardrail');
	const skipArtifacts = hasFlag(parsed, 'skip-artifacts');
	const uploadModel = hasFlag(parsed, 'upload-model');
	const uploadDryRun = hasFlag(parsed, 'upload-dry-run');
	const applyThresholds = hasFlag(parsed, 'apply-thresholds');
	const syncConfig = hasFlag(parsed, 'sync-config');
	const configDryRun = hasFlag(parsed, 'config-dry-run');

	const minRecall = getOption(parsed, 'min-recall');
	const maxFpr = getOption(parsed, 'max-fpr');
	const maxFnr = getOption(parsed, 'max-fnr');
	const minGap = getOption(parsed, 'min-gap');
	const thresholdMinArg = getOption(parsed, 'threshold-min');
	const thresholdMaxArg = getOption(parsed, 'threshold-max');
	const thresholdStepArg = getOption(parsed, 'threshold-step');
	const calibrationRetries = parseInt(getOption(parsed, 'calibration-retries') ?? '0', 10);
	const retryThresholdStep = getOption(parsed, 'retry-threshold-step');
	const retryThresholdMin = getOption(parsed, 'retry-threshold-min');
	const retryThresholdMax = getOption(parsed, 'retry-threshold-max');

	const nTrees = getOption(parsed, 'n-trees');
	const maxDepth = getOption(parsed, 'max-depth');
	const minSamplesLeaf = getOption(parsed, 'min-samples-leaf');
	const conflictWeight = getOption(parsed, 'conflict-weight');
	const noSplit = hasFlag(parsed, 'no-split');
	const skipMx = hasFlag(parsed, 'skip-mx');
	const kvKeyOption = getOption(parsed, 'kv-key');
	const defaultFeatureMode = exportModes[0]?.name ?? 'full';

	const determineKvKey = (config: AttemptConfig): string => {
		if (kvKeyOption) return kvKeyOption;
		const trees = config.nTrees ?? (nTrees ? Number(nTrees) : 10);
		return trees === 1 ? 'decision_tree.json' : 'random_forest.json';
	};

	logger.section('🚀 Automation Pipeline');
	logger.info(`Dataset: ${datasetPath}`);
	logger.info(`Features: ${featuresOutput}`);
	logger.info(`Model output: ${modelOutput}`);

	const exportedModes = new Set<string>(manifest.exportModes.filter((mode) => mode.completed).map((mode) => mode.name));
	const attemptSummaries: AttemptSummary[] = [...manifest.attempts];
	const attemptStartIndex = manifest.attempts.length;
	if (!skipExport) {
		for (const mode of exportModes) {
			await ensureExport(mode, datasetPath, labelColumn, exportedModes);
			markExportComplete(manifestPath, mode.name);
		}
	} else {
		logger.info('Skipping feature export step (assumes existing feature matrices).');
	}

	let finalAttempt: AttemptConfig | null = null;
	let finalRecommendation: GuardrailRecommendation | null = null;

	for (let i = attemptStartIndex; i < attempts.length; i++) {
		const attempt = attempts[i];
		const label = attemptLabel(i, attempts.length, attempt.label);
		const attemptParams: AttemptConfig = {
			nTrees: attempt.nTrees ?? (nTrees ? Number(nTrees) : undefined),
			maxDepth: attempt.maxDepth ?? (maxDepth ? Number(maxDepth) : undefined),
			minSamplesLeaf: attempt.minSamplesLeaf ?? (minSamplesLeaf ? Number(minSamplesLeaf) : undefined),
			conflictWeight: attempt.conflictWeight ?? (conflictWeight ? Number(conflictWeight) : undefined),
			skipMx: attempt.skipMx ?? skipMx,
			noSplit: attempt.noSplit ?? noSplit,
			featureMode: attempt.featureMode ?? defaultFeatureMode,
		};

		const exportMode = exportModes.find((mode) => mode.name === attemptParams.featureMode);
		if (!exportMode) {
			throw new Error(`Attempt "${label}" references unknown featureMode "${attemptParams.featureMode}".`);
		}
		if (!skipExport) {
			await ensureExport(exportMode, datasetPath, labelColumn, exportedModes);
			markExportComplete(manifestPath, exportMode.name);
		} else if (!existsSync(exportMode.output)) {
			throw new Error(`Features file missing for mode "${exportMode.name}": ${exportMode.output}`);
		}

		logger.section(`2️⃣ ${label} – Model Training`);
		const trainArgs = ['--dataset', exportMode.output, '--output', modelOutput, '--features', exportMode.output, '--label-column', labelColumn, '--skip-export'];
		if (attemptParams.nTrees) trainArgs.push('--n-trees', String(attemptParams.nTrees));
		if (attemptParams.maxDepth) trainArgs.push('--max-depth', String(attemptParams.maxDepth));
		if (attemptParams.minSamplesLeaf) trainArgs.push('--min-samples-leaf', String(attemptParams.minSamplesLeaf));
		if (attemptParams.conflictWeight) trainArgs.push('--conflict-weight', String(attemptParams.conflictWeight));
		if (attemptParams.noSplit) trainArgs.push('--no-split');
		if (attemptParams.skipMx) trainArgs.push('--skip-mx');
		await modelTrain(trainArgs);

		if (skipGuardrail) {
			finalAttempt = attemptParams;
			const summary: AttemptSummary = { label, params: attemptParams, status: 'success', message: 'Guardrail skipped' };
			attemptSummaries.push(summary);
			manifest = updateManifest(manifestPath, (m) => {
				m.attempts.push(summary);
				m.finalAttempt = summary;
			});
			break;
		}

		logger.section(`3️⃣ ${label} – Guardrail Verification`);
		const guardrailArgs = [
			'--input', calibrationInput,
			'--output', calibratedOutput,
			'--scan', scanJson,
			'--scan-csv', scanCsv,
			'--recommendation', recommendationPath,
		];
		if (minRecall) guardrailArgs.push('--min-recall', minRecall);
		if (maxFpr) guardrailArgs.push('--max-fpr', maxFpr);
		if (maxFnr) guardrailArgs.push('--max-fnr', maxFnr);
		if (minGap) guardrailArgs.push('--min-gap', minGap);
		if (thresholdMinArg) guardrailArgs.push('--threshold-min', thresholdMinArg);
		if (thresholdMaxArg) guardrailArgs.push('--threshold-max', thresholdMaxArg);
		if (thresholdStepArg) guardrailArgs.push('--threshold-step', thresholdStepArg);

		try {
			finalRecommendation = await runGuardrailWithRetries(guardrailArgs, calibrationRetries, {
				thresholdStep: retryThresholdStep,
				thresholdMin: retryThresholdMin,
				thresholdMax: retryThresholdMax,
			});
			finalAttempt = attemptParams;
			const summary: AttemptSummary = { label, params: attemptParams, status: 'success', message: 'Guardrail passed' };
			attemptSummaries.push(summary);
			manifest = updateManifest(manifestPath, (m) => {
				m.attempts.push(summary);
				m.finalAttempt = summary;
				m.finalRecommendation = finalRecommendation!;
			});
			break;
		} catch (error) {
			if (error instanceof GuardrailError) {
				logger.warn(`${label} failed guardrail: ${error.message}`);
				const summary: AttemptSummary = {
					label,
					params: attemptParams,
					status: 'failed',
					message: error.message,
					details: error.details,
				};
				attemptSummaries.push(summary);
				manifest = updateManifest(manifestPath, (m) => {
					m.attempts.push(summary);
				});
				continue;
			}
			throw error;
		}
	}

	if (!finalAttempt) {
		logger.section('❌ Pipeline Aborted');
		logger.error('All attempts failed guardrail constraints.');
		logger.table(attemptSummaries.map((summary) => ({
			label: summary.label,
			status: summary.status,
			nTrees: summary.params.nTrees ?? 'default',
			maxDepth: summary.params.maxDepth ?? 'default',
			minSamplesLeaf: summary.params.minSamplesLeaf ?? 'default',
			conflictWeight: summary.params.conflictWeight ?? 'default',
			mode: summary.params.featureMode ?? defaultFeatureMode,
			note: summary.message ?? '',
		})));
		manifest = updateManifest(manifestPath, (m) => {
			m.status = 'failed';
			m.failureReason = 'Guardrail failed for all attempts';
		});
		throw new Error('Guardrail failed for every attempted configuration.');
}

	if (uploadModel) {
		await runStep('4️⃣ Model Upload', async () => {
			const kvKey = determineKvKey(finalAttempt!);
			try {
				await uploadModelToKv(modelOutput, binding, kvKey, uploadDryRun);
				manifest = updateManifest(manifestPath, (m) => {
					m.upload = {
						target: kvKey,
						binding,
						dryRun: uploadDryRun,
						success: true,
					};
				});
			} catch (error) {
				updateManifest(manifestPath, (m) => {
					m.upload = {
						target: kvKey,
						binding,
						dryRun: uploadDryRun,
						success: false,
						message: error instanceof Error ? error.message : String(error),
					};
					m.status = 'failed';
					m.failureReason = `KV upload failed: ${m.upload.message}`;
				});
				throw error;
			}
		});
	}

	if (!skipGuardrail) {
		await runStep('5️⃣ Threshold Update', async () => {
			const thresholdArgs: string[] = [];
			if (!applyThresholds) {
				thresholdArgs.push('--dry-run');
			}
			await updateThresholds(thresholdArgs);
			manifest = updateManifest(manifestPath, (m) => {
				m.thresholdsApplied = applyThresholds;
			});
		});
	} else {
		logger.warn('Guardrail skipped – threshold update not run.');
	}

	if (syncConfig) {
		await runStep('6️⃣ Config Sync', async () => {
			try {
				await syncConfigFiles(configPath, heuristicsPath, binding, configDryRun);
				manifest = updateManifest(manifestPath, (m) => {
					m.configSync = {
						configPath,
						heuristicsPath,
						binding,
						dryRun: configDryRun,
						success: true,
					};
				});
			} catch (error) {
				updateManifest(manifestPath, (m) => {
					m.configSync = {
						configPath,
						heuristicsPath,
						binding,
						dryRun: configDryRun,
						success: false,
						message: error instanceof Error ? error.message : String(error),
					};
					m.status = 'failed';
					m.failureReason = `Config sync failed: ${m.configSync.message}`;
				});
				throw error;
			}
		});
	} else {
		logger.info('Config sync skipped (pass --sync-config to upload config + heuristics).');
	}

	if (!skipArtifacts) {
		await runStep('7️⃣ Artifact Snapshot', async () => {
			const artifactDir = resolve(snapshotOutput ?? join(runDir, 'threshold-artifacts'));
			const snapshotArgs: string[] = ['--output', artifactDir, '--scan-json', scanJson, '--scan-csv', scanCsv, '--recommendation', recommendationPath, '--calibrated', calibratedOutput];
			await snapshotArtifacts(snapshotArgs);
			manifest = updateManifest(manifestPath, (m) => {
				m.artifactsDir = artifactDir;
			});
		});
	}

	logger.section('✅ Pipeline Complete');
logger.table(attemptSummaries.map((summary) => ({
	label: summary.label,
	status: summary.status,
	nTrees: summary.params.nTrees ?? 'default',
	maxDepth: summary.params.maxDepth ?? 'default',
	minSamplesLeaf: summary.params.minSamplesLeaf ?? 'default',
	conflictWeight: summary.params.conflictWeight ?? 'default',
	mode: summary.params.featureMode ?? defaultFeatureMode,
	note: summary.message ?? '',
})));
	logger.info(`Model: ${modelOutput}`);
	if (!skipGuardrail && finalRecommendation) {
		logger.info(`Thresholds: warn ${finalRecommendation.warnThreshold.toFixed(3)}, block ${finalRecommendation.blockThreshold.toFixed(3)}`);
	}
	logger.info(`Recommendation file: ${recommendationPath}`);
	if (syncConfig) {
		logger.info(`Config KV Binding: ${binding} (${configDryRun ? 'dry-run' : 'updated'})`);
	}
	updateManifest(manifestPath, (m) => {
		m.status = 'success';
		m.finalAttempt = m.finalAttempt ?? attemptSummaries.find((summary) => summary.status === 'success');
		if (finalRecommendation) {
			m.finalRecommendation = finalRecommendation;
		}
	});
}
