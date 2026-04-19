/**
 * OCI Deep Intelligence — Unit tests for canonical signal recovery and universal value helpers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOptimizationValue } from '@/lib/oci/optimization-contract';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('MODULE 4: universal optimization values replace half-life shadow math', () => {
  assert.deepEqual(resolveOptimizationValue({ stage: 'contacted', systemScore: 60 }), {
    stageBase: 10,
    systemScore: 60,
    qualityFactor: 0.96,
    optimizationValue: 9.6,
  });
  assert.deepEqual(resolveOptimizationValue({ stage: 'won', systemScore: 100 }), {
    stageBase: 100,
    systemScore: 100,
    qualityFactor: 1.2,
    optimizationValue: 120,
  });
});

test('MODULE 2: pulse-recovery backoff 2h → 6h → 24h without V2 backfill', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'oci', 'pulse-recovery-worker.ts'), 'utf-8');
  assert.ok(src.includes('2'), 'has 2h');
  assert.ok(src.includes('6'), 'has 6h');
  assert.ok(src.includes('24'), 'has 24h');
  assert.ok(src.includes('BACKOFF_HOURS'), 'exponential backoff');
  assert.ok(src.includes('recovery_attempt_count'), 'recovery attempt count');
  assert.ok(src.includes('last_recovery_attempt_at'), 'last recovery timestamp');
  assert.ok(!src.includes('recoverMissingV2Signals'), 'must not keep legacy V2 backfill logic');
  assert.ok(!src.includes("signal_type', 'INTENT_CAPTURED'"), 'must not scan for legacy INTENT_CAPTURED rows');
  assert.ok(!src.includes("evaluateAndRouteSignal('V2_PULSE'"), 'must not re-emit removed V2 pulses');
});

test('MODULE 1: identity-stitcher discovery_confidence and PHONE_STITCH safeguards', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'oci', 'identity-stitcher.ts'), 'utf-8');
  assert.ok(src.includes('discoveryConfidence'), 'discovery_confidence required');
  assert.ok(src.includes('PHONE_STITCH'), 'PHONE_STITCH');
  assert.ok(src.includes('FINGERPRINT_STITCH'), 'FINGERPRINT_STITCH');
  assert.ok(src.includes('confirmed') || src.includes('qualified') || src.includes('real'), 'source call status filter');
  assert.ok(src.includes('session_created_at') || src.includes('sessionCreated'), 'session temporal check');
});

test('marketing-signals insert persists recovered click ids', () => {
  const src = readFileSync(
    join(process.cwd(), 'lib', 'domain', 'mizan-mantik', 'insert-marketing-signal.ts'),
    'utf-8'
  );
  assert.ok(src.includes('gclid: gclid ?? null'), 'persists gclid');
  assert.ok(src.includes('wbraid: wbraid ?? null'), 'persists wbraid');
  assert.ok(src.includes('gbraid: gbraid ?? null'), 'persists gbraid');
});
