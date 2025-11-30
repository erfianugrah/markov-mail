import { promises as fs } from 'fs';
import { resolve } from 'path';
import { logger } from '../../utils/logger';
import { parseArgs } from '../../utils/args';

interface ModelMeta {
	feature_importance: Record<string, number>;
	[key: string]: any;
}

interface Model {
	meta: ModelMeta;
	[key: string]: any;
}

async function analyzeModel(modelPath: string) {
	try {
		const fullPath = resolve(process.cwd(), modelPath);
		const fileContent = await fs.readFile(fullPath, 'utf-8');
		const model = JSON.parse(fileContent) as Model;

		if (!model.meta || !model.meta.feature_importance) {
			logger.error('❌ Feature importance data not found in the model file.');
			return;
		}

		const importances = model.meta.feature_importance;
		const sortedFeatures = Object.entries(importances).sort(([, a], [, b]) => b - a);

		logger.info('📊 Feature Importance Analysis');
		logger.info('================================');
		sortedFeatures.forEach(([feature, importance]) => {
			logger.info(`- ${feature}: ${importance.toFixed(4)}`);
		});
	} catch (error: any) {
		logger.error(`❌ Error analyzing model: ${error.message}`);
	}
}

export default async function (args: string[]) {
	const parsedArgs = parseArgs(args);
	const modelPath = parsedArgs.positional[0];

	if (!modelPath) {
		logger.error('❌ Model file path is required.');
		logger.info('Usage: npm run cli model:analyze <path-to-model.json>');
		return;
	}

	await analyzeModel(modelPath);
}
