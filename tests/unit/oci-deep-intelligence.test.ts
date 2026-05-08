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
    systemScore: 0,
    qualityFactor: 1.0,
    optimizationValue: 10,
  });
  assert.deepEqual(resolveOptimizationValue({ stage: 'won', systemScore: 100 }), {
    stageBase: 100,
    systemScore: 0,
    qualityFactor: 1.0,
    optimizationValue: 100,
  });
});

test('MODULE 2: pulse-recovery is queue-only retirement shim (no V2 backfill loop)', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'oci', 'pulse-recovery-worker.ts'), 'utf-8');
  assert.ok(src.includes('return {'));
  assert.ok(src.includes('processed: 0'));
  assert.ok(src.includes('recovered: 0'));
  assert.ok(src.includes('attempted: 0'));
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
  assert.ok(src.includes('normalizeClickSegment'), 'normalizes click segments before persist');
  assert.ok(
    src.includes('gclid: normalizeClickSegment(gclid ?? null)'),
    'persists gclid via normalizeClickSegment'
  );
  assert.ok(
    src.includes('wbraid: normalizeClickSegment(wbraid ?? null)'),
    'persists wbraid via normalizeClickSegment'
  );
  assert.ok(
    src.includes('gbraid: normalizeClickSegment(gbraid ?? null)'),
    'persists gbraid via normalizeClickSegment'
  );
  assert.ok(src.includes('clickIds: clickNorm'), 'forwards normalized click ids to upsertMarketingSignal');
});
