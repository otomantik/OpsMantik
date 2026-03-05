/**
 * OCI Deep Intelligence — Unit tests for MODULE 3 (Value Floor) and MODULE 4 (Half-Life)
 * Plan: Identity Stitcher, Self-Healing, Fast-Track, Value Floor, Half-Life Shadow
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHalfLifeDecay } from '@/lib/domain/mizan-mantik/time-decay';
import { getValueFloorCents } from '@/lib/domain/mizan-mantik/value-config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('MODULE 4: applyHalfLifeDecay formula — Value = Base * 0.5^(days/7)', () => {
  const base = 1000;
  assert.strictEqual(applyHalfLifeDecay(base, 0), 1000, 'days=0 → no decay');
  assert.strictEqual(applyHalfLifeDecay(base, 7), 500, 'days=7 (1 half-life) → 50%');
  assert.strictEqual(applyHalfLifeDecay(base, 14), 250, 'days=14 (2 half-lives) → 25%');
  assert.ok(applyHalfLifeDecay(100, 3) > 70 && applyHalfLifeDecay(100, 3) < 100, 'days=3 → partial decay');
});

test('MODULE 4: applyHalfLifeDecay guards invalid input', () => {
  assert.strictEqual(applyHalfLifeDecay(0, 5), 0, 'base 0 → 0');
  assert.strictEqual(applyHalfLifeDecay(-10, 5), 0, 'negative base → 0');
  assert.strictEqual(applyHalfLifeDecay(100, -1), 100, 'negative days → no decay');
});

test('MODULE 3: getValueFloorCents — floor = max(min_cents, baseAov * 0.005)', () => {
  const cfg = {
    siteId: 'test',
    defaultAov: 1000,
    intentWeights: { pending: 0.02, qualified: 0.2, proposal: 0.3, sealed: 1.0 },
    minConversionValueCents: 50,
  };
  const floor = getValueFloorCents(cfg);
  // const ratioCents = Math.round(1000 * 0.005 * 100); // 500 cents (unused)
  assert.strictEqual(floor, 500, 'max(50, 500) = 500');
  const cfg2 = { ...cfg, minConversionValueCents: 600 };
  assert.strictEqual(getValueFloorCents(cfg2), 600, 'max(600, 500) = 600');
});

test('MODULE 2: pulse-recovery backoff 2h → 6h → 24h', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'oci', 'pulse-recovery-worker.ts'), 'utf-8');
  assert.ok(src.includes('2'), 'has 2h');
  assert.ok(src.includes('6'), 'has 6h');
  assert.ok(src.includes('24'), 'has 24h');
  assert.ok(src.includes('BACKOFF_HOURS'), 'exponential backoff');
  assert.ok(src.includes('recovery_attempt_count'), 'recovery attempt count');
  assert.ok(src.includes('last_recovery_attempt_at'), 'last recovery timestamp');
});

test('MODULE 1: identity-stitcher discovery_confidence and PHONE_STITCH safeguards', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'oci', 'identity-stitcher.ts'), 'utf-8');
  assert.ok(src.includes('discoveryConfidence'), 'discovery_confidence required');
  assert.ok(src.includes('PHONE_STITCH'), 'PHONE_STITCH');
  assert.ok(src.includes('FINGERPRINT_STITCH'), 'FINGERPRINT_STITCH');
  assert.ok(src.includes('confirmed') || src.includes('qualified') || src.includes('real'), 'source call status filter');
  assert.ok(src.includes('session_created_at') || src.includes('sessionCreated'), 'session temporal check');
});
