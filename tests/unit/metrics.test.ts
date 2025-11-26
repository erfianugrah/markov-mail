import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  writeValidationMetric,
  writeTrainingMetric,
  writeABTestMetric,
  writeAdminMetric,
  type ValidationMetric,
  type TrainingMetric,
  type ABTestMetric,
  type AdminMetric,
} from '../../src/utils/metrics';
import {
  writeValidationMetricToD1,
  writeTrainingMetricToD1,
  writeABTestMetricToD1,
  writeAdminMetricToD1,
} from '../../src/database/metrics';

vi.mock('../../src/database/metrics', () => ({
  writeValidationMetricToD1: vi.fn(),
  writeTrainingMetricToD1: vi.fn(),
  writeABTestMetricToD1: vi.fn(),
  writeAdminMetricToD1: vi.fn(),
}));

describe('D1 Metrics Writers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes validation metrics to D1', () => {
    const metric: ValidationMetric = {
      decision: 'allow',
      riskScore: 0.42,
      fingerprintHash: 'abc123',
      latency: 10,
    };

    writeValidationMetric(undefined, metric);
    expect(writeValidationMetricToD1).toHaveBeenCalledWith(undefined, metric);
  });

  it('writes training metrics to D1', () => {
    const metric: TrainingMetric = {
      event: 'training_started',
      modelVersion: 'v1',
    };

    writeTrainingMetric(undefined, metric);
    expect(writeTrainingMetricToD1).toHaveBeenCalledWith(undefined, metric);
  });

  it('writes A/B metrics to D1', () => {
    const metric: ABTestMetric = {
      event: 'experiment_created',
      experimentId: 'exp_123',
    };

    writeABTestMetric(undefined, metric);
    expect(writeABTestMetricToD1).toHaveBeenCalledWith(undefined, metric);
  });

  it('writes admin metrics to D1', () => {
    const metric: AdminMetric = {
      event: 'config_updated',
      admin: 'admin_hash',
    };

    writeAdminMetric(undefined, metric);
    expect(writeAdminMetricToD1).toHaveBeenCalledWith(undefined, metric);
  });
});
