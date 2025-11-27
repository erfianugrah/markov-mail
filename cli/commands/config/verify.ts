/**
 * Configuration Verification Command
 *
 * Validates the deployed config.json in KV to ensure it matches code expectations
 * and has recent calibration data.
 */

import { logger } from '../../utils/logger.ts';
import { parseArgs, getOption, hasFlag } from '../../utils/args.ts';
import { $ } from 'bun';

interface VerificationResult {
  passed: boolean;
  message: string;
  level: 'error' | 'warning' | 'info';
}

export default async function verifyConfig(args: string[]) {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help', 'h')) {
    printHelp();
    return;
  }

  const binding = getOption(parsed, 'binding') || 'CONFIG';
  const remote = hasFlag(parsed, 'remote');
  const maxAgeHours = parseInt(getOption(parsed, 'max-age') || '168', 10); // 7 days default

  logger.section('🔍 Configuration Verification');
  logger.info(`Binding: ${binding}`);
  logger.info(`Mode: ${remote ? 'Remote (production)' : 'Local'}`);
  logger.info(`Max calibration age: ${maxAgeHours} hours`);
  console.log();

  const results: VerificationResult[] = [];

  try {
    // Fetch config.json from KV
    const remoteFlag = remote ? '--remote' : '';
    const configJson = await $`npx wrangler kv key get config.json --binding=${binding} ${remoteFlag}`.text();

    if (!configJson || configJson.trim().length === 0) {
      results.push({
        passed: false,
        message: 'config.json not found in KV',
        level: 'error'
      });
      printResults(results);
      process.exit(1);
    }

    const config = JSON.parse(configJson);

    // Verification 1: config.json exists and is valid JSON
    results.push({
      passed: true,
      message: 'config.json found and valid JSON',
      level: 'info'
    });

    // Verification 2: Calibration block exists
    if (!config.calibration) {
      results.push({
        passed: false,
        message: 'No calibration block found in config.json',
        level: 'error'
      });
    } else {
      results.push({
        passed: true,
        message: 'Calibration block present',
        level: 'info'
      });

      // Verification 3: Calibration has required fields
      const requiredFields = ['version', 'createdAt', 'bias', 'features'];
      const missingFields = requiredFields.filter(field => !(field in config.calibration));

      if (missingFields.length > 0) {
        results.push({
          passed: false,
          message: `Calibration missing required fields: ${missingFields.join(', ')}`,
          level: 'error'
        });
      } else {
        results.push({
          passed: true,
          message: 'Calibration has all required fields',
          level: 'info'
        });
      }

      // Verification 4: Calibration timestamp is recent
      if (config.calibration.createdAt) {
        const createdAt = new Date(config.calibration.createdAt);
        const now = new Date();
        const ageHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

        if (ageHours > maxAgeHours) {
          results.push({
            passed: false,
            message: `Calibration is ${Math.round(ageHours)} hours old (max: ${maxAgeHours})`,
            level: 'warning'
          });
        } else {
          results.push({
            passed: true,
            message: `Calibration is ${Math.round(ageHours)} hours old (fresh)`,
            level: 'info'
          });
        }

        logger.info(`Calibration version: ${config.calibration.version}`);
        logger.info(`Created at: ${config.calibration.createdAt}`);
      }

      // Verification 5: Feature names match code expectations
      const expectedFeatures = [
        'ce_legit2',
        'ce_fraud2',
        'ce_diff2',
        'ce_legit3',
        'ce_fraud3',
        'ce_diff3',
        'min_entropy',
        'sequential_confidence',
        'plus_risk',
        'local_length',
        'digit_ratio',
        'provider_is_free',
        'provider_is_disposable',
        'tld_risk',
        'abnormality_risk'
      ];

      if (config.calibration.features && Array.isArray(config.calibration.features)) {
        const actualFeatures = config.calibration.features.map((f: any) => f.name);
        const missingFeatures = expectedFeatures.filter(f => !actualFeatures.includes(f));
        const extraFeatures = actualFeatures.filter((f: string) => !expectedFeatures.includes(f));

        if (missingFeatures.length > 0) {
          results.push({
            passed: false,
            message: `Missing expected features: ${missingFeatures.join(', ')}`,
            level: 'error'
          });
        }

        if (extraFeatures.length > 0) {
          results.push({
            passed: false,
            message: `Unexpected features: ${extraFeatures.join(', ')}`,
            level: 'warning'
          });
        }

        if (missingFeatures.length === 0 && extraFeatures.length === 0) {
          results.push({
            passed: true,
            message: `All ${expectedFeatures.length} expected features present`,
            level: 'info'
          });
        }

        logger.info(`Feature count: ${actualFeatures.length}`);
      } else {
        results.push({
          passed: false,
          message: 'Calibration features array is missing or invalid',
          level: 'error'
        });
      }

      // Verification 6: Calibration metrics exist (optional but recommended)
      if (config.calibration.metrics) {
        const { accuracy, precision, recall, f1 } = config.calibration.metrics;
        results.push({
          passed: true,
          message: `Calibration metrics: accuracy=${accuracy?.toFixed(3)}, precision=${precision?.toFixed(3)}, recall=${recall?.toFixed(3)}, f1=${f1?.toFixed(3)}`,
          level: 'info'
        });

        // Warn if metrics are concerning
        if (precision && precision < 0.80) {
          results.push({
            passed: false,
            message: `Low precision: ${precision.toFixed(3)} (expected ≥ 0.80)`,
            level: 'warning'
          });
        }

        if (recall && recall < 0.75) {
          results.push({
            passed: false,
            message: `Low recall: ${recall.toFixed(3)} (expected ≥ 0.75)`,
            level: 'warning'
          });
        }
      } else {
        results.push({
          passed: false,
          message: 'No calibration metrics found (training metrics missing)',
          level: 'warning'
        });
      }
    }

    // Verification 7: Core configuration fields exist
    const coreFields = ['riskThresholds', 'riskWeights', 'features'];
    const missingCore = coreFields.filter(field => !(field in config));

    if (missingCore.length > 0) {
      results.push({
        passed: false,
        message: `Missing core config fields: ${missingCore.join(', ')}`,
        level: 'error'
      });
    } else {
      results.push({
        passed: true,
        message: 'All core config fields present',
        level: 'info'
      });
    }

    // Verification 8: Check for OOD configuration
    if (config.ood) {
      results.push({
        passed: true,
        message: 'OOD (Out-of-Distribution) configuration present',
        level: 'info'
      });
    } else {
      results.push({
        passed: false,
        message: 'No OOD configuration found',
        level: 'warning'
      });
    }

    console.log();
    printResults(results);

    // Exit with appropriate code
    const hasErrors = results.some(r => !r.passed && r.level === 'error');
    const hasWarnings = results.some(r => !r.passed && r.level === 'warning');

    if (hasErrors) {
      logger.error('\n❌ Verification FAILED - critical errors found');
      process.exit(1);
    } else if (hasWarnings) {
      logger.warn('\n⚠️  Verification PASSED with warnings');
      process.exit(0);
    } else {
      logger.success('\n✅ Verification PASSED - all checks OK');
      process.exit(0);
    }

  } catch (error) {
    logger.error(`❌ Failed to verify config: ${error}`);
    if (error instanceof Error && error.message.includes('404')) {
      logger.info('Hint: config.json may not exist in KV. Upload one using:');
      logger.info('  npm run cli config:upload <path-to-config.json>');
    }
    process.exit(1);
  }
}

function printResults(results: VerificationResult[]) {
  logger.subsection('Verification Results');

  for (const result of results) {
    const icon = result.passed ? '✓' : '✗';
    const color = result.level === 'error' ? 'error' : result.level === 'warning' ? 'warn' : 'info';

    if (color === 'error') {
      logger.error(`  ${icon} ${result.message}`);
    } else if (color === 'warn') {
      logger.warn(`  ${icon} ${result.message}`);
    } else {
      logger.info(`  ${icon} ${result.message}`);
    }
  }
}

function printHelp() {
  console.log(`
╔════════════════════════════════════════════════════════╗
║          Configuration Verification                   ║
╚════════════════════════════════════════════════════════╝

Validates the deployed config.json in KV to ensure:
  - config.json exists and is valid JSON
  - Calibration block is present with all required fields
  - Feature names match code expectations
  - Calibration is recent (not stale)
  - Core configuration fields are present

USAGE
  npm run cli config:verify [options]

OPTIONS
  --binding <name>    KV binding name (default: CONFIG)
  --remote            Use remote KV (production)
  --max-age <hours>   Maximum calibration age in hours (default: 168 = 7 days)
  --help, -h          Show this help message

EXAMPLES
  # Verify local config
  npm run cli config:verify

  # Verify production config
  npm run cli config:verify --remote

  # Verify with custom max age (3 days)
  npm run cli config:verify --remote --max-age 72

EXIT CODES
  0  Verification passed (possibly with warnings)
  1  Verification failed (critical errors found)
`);
}
