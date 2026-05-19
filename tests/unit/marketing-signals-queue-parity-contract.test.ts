import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('ensureOciQueueEnqueue exposes canonical PARITY_* reason codes', () => {
  const src = readFileSync(join(ROOT, 'lib', 'oci', 'ensure-oci-queue-enqueue.ts'), 'utf8');
  assert.ok(src.includes('PARITY_QUEUE_ENQUEUED'), 'must expose PARITY_QUEUE_ENQUEUED');
  assert.ok(src.includes('PARITY_QUEUE_DUPLICATE'), 'must expose PARITY_QUEUE_DUPLICATE');
  assert.ok(src.includes('PARITY_CONSENT_MISSING'), 'must expose PARITY_CONSENT_MISSING');
  assert.ok(src.includes('PARITY_QUEUE_ERROR'), 'must expose PARITY_QUEUE_ERROR');
  assert.ok(!src.includes("from('marketing_signals')"), 'must not write marketing_signals');
});

test('router enforces queue enqueue metadata in queue-only mode', () => {
  const src = readFileSync(join(ROOT, 'lib', 'domain', 'mizan-mantik', 'stages', 'stage-router.ts'), 'utf8');
  assert.ok(!src.includes('signal_write_result'), 'router must not expose legacy signal_write_result');
  assert.ok(src.includes('ensureOciQueueEnqueue'), 'router must call queue enqueue helper');
  assert.ok(src.includes('queue_parity_result'), 'router must expose queue_parity_result');
  assert.ok(src.includes('parity_key'), 'router must expose parity_key');
});

test('backfill paths use ensureOciQueueEnqueue (no marketing_signals writes)', () => {
  const precursor = readFileSync(join(ROOT, 'lib', 'oci', 'backfill-precursor-signals.ts'), 'utf8');
  const intentBackfill = readFileSync(
    join(ROOT, 'scripts', 'db', 'oci-cleanup-junk-and-backfill-intent-contacted.ts'),
    'utf8'
  );
  assert.ok(precursor.includes('ensureOciQueueEnqueue'), 'precursor backfill must enqueue journal rows');
  assert.ok(intentBackfill.includes('ensureOciQueueEnqueue'), 'intent backfill script must enqueue journal rows');
  assert.ok(!precursor.includes('upsertMarketingSignal'), 'precursor must not upsert marketing_signals');
  assert.ok(!intentBackfill.includes('upsertMarketingSignal'), 'intent backfill must not upsert marketing_signals');
});
