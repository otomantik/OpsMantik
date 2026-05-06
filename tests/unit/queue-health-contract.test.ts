import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  QUEUE_HEALTH_POLICY_VERSION,
  STUCK_PROCESSING_MAX_AGE_MINUTES,
  evaluateQueueHealth,
  evaluateRolloutGate,
  computeRetryFailedRates,
} from '../../lib/oci/queue-health-contract';

const baseOperational = {
  evaluationMode: 'operational' as const,
  siteId: '00000000-0000-0000-0000-000000000001',
  targetDbEvidenceAvailable: true,
  stuckProcessingCount: 0,
  wonMissingPipelineCount: 0,
  oldestQueuedAgeMinutes: null,
  oldestRetryAgeMinutes: null,
  oldestProcessingAgeMinutes: null,
  totalQueue: 10,
  retryCount: 1,
  failedCount: 0,
  deadLetterQuarantineCount: 0,
  timeSsotRed: false,
  valueIntegrityRed: false,
  identityIntegrityRed: false,
};

describe('queue-health-contract', () => {
  it('exports kemik policy version', () => {
    assert.equal(QUEUE_HEALTH_POLICY_VERSION, 'queue_health_contract_v1');
  });

  it('STUCK age matches rollout script semantics (minutes)', () => {
    assert.equal(STUCK_PROCESSING_MAX_AGE_MINUTES, 15);
  });

  it('computeRetryFailedRates matches rollout definition', () => {
    const r = computeRetryFailedRates({
      totalQueue: 100,
      retryCount: 30,
      failedCount: 5,
      deadLetterQuarantineCount: 5,
    });
    assert.equal(r.retry_rate, 0.3);
    assert.equal(r.failed_rate, 0.1);
  });

  it('operational GREEN when all invariants pass', () => {
    const e = evaluateQueueHealth(baseOperational);
    assert.equal(e.queue_health_score, 100);
    assert.equal(e.queue_health_status, 'GREEN');
    assert.deepEqual(e.blocking_reasons, []);
  });

  it('operational RED on stuck', () => {
    const e = evaluateQueueHealth({ ...baseOperational, stuckProcessingCount: 1 });
    assert.equal(e.queue_health_score, 0);
    assert.ok(e.blocking_reasons.includes('STUCK_PROCESSING'));
  });

  it('kemik requires TARGET_DB flag', () => {
    const e = evaluateQueueHealth({
      ...baseOperational,
      evaluationMode: 'kemik',
      targetDbEvidenceAvailable: false,
      ssotEvaluated: true,
    });
    assert.ok(e.blocking_reasons.includes('DB_NOT_CHECKED'));
  });

  it('kemik requires ssotEvaluated', () => {
    const e = evaluateQueueHealth({
      ...baseOperational,
      evaluationMode: 'kemik',
      targetDbEvidenceAvailable: true,
      ssotEvaluated: false,
    });
    assert.ok(e.blocking_reasons.includes('UNKNOWN'));
  });

  it('rollout gate tolerates stuck below profile max', () => {
    const g = evaluateRolloutGate({
      stuckProcessing: 5,
      retryRate: 0.1,
      failedRate: 0.1,
      profile: 'prod',
    });
    assert.equal(g.pass, true);
  });

  it('rollout gate fails when stuck above max', () => {
    const g = evaluateRolloutGate({
      stuckProcessing: 25,
      retryRate: 0.1,
      failedRate: 0.1,
      profile: 'prod',
    });
    assert.equal(g.pass, false);
    assert.ok(g.failures.some((f) => f.startsWith('stuckProcessing')));
  });
});
