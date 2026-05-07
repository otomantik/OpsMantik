/**
 * Retry backoff + jitter (OCI_RETRY_JITTER_MAX_SECONDS).
 */
import assert from 'node:assert/strict';
import { describe, it, after } from 'node:test';
import {
  getRetryJitterMaxSeconds,
  nextRetryDelaySeconds,
  nextRetryDelaySecondsWithJitter,
} from '../../lib/cron/process-offline-conversions';

describe('retry jitter', () => {
  const prev = process.env.OCI_RETRY_JITTER_MAX_SECONDS;

  after(() => {
    if (prev === undefined) delete process.env.OCI_RETRY_JITTER_MAX_SECONDS;
    else process.env.OCI_RETRY_JITTER_MAX_SECONDS = prev;
  });

  it('base delay unchanged when jitter max is 0', () => {
    process.env.OCI_RETRY_JITTER_MAX_SECONDS = '0';
    assert.equal(getRetryJitterMaxSeconds(), 0);
    assert.equal(nextRetryDelaySecondsWithJitter(0), 5 * 60);
    assert.equal(nextRetryDelaySecondsWithJitter(1), 10 * 60);
  });

  it('with jitter 0, matches nextRetryDelaySeconds', () => {
    process.env.OCI_RETRY_JITTER_MAX_SECONDS = '0';
    for (const n of [0, 1, 5, 10]) {
      assert.equal(nextRetryDelaySecondsWithJitter(n), nextRetryDelaySeconds(n));
    }
  });
});
