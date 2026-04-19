/**
 * One True Math — Regression guards for OCI conversion value.
 * - Currency utilities (getMinorUnits, majorToMinor, minorToMajor)
 * - optimization-contract (stage base x quality factor)
 * - Source guard: runner must not use calculateExpectedValue; job.amount_cents = row.value_cents
 * - Import ban: OCI folders must not import predictive-engine / calculateLeadValue for value
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getMinorUnits,
  majorToMinor,
  minorToMajor,
} from '@/lib/i18n/currency';
import {
  clampSystemScore,
  OPTIMIZATION_STAGE_BASES,
  resolveOptimizationValue,
  resolveQualityFactor,
} from '@/lib/oci/optimization-contract';

// --- Currency utilities ---
test('getMinorUnits: TRY/EUR/USD = 2', () => {
  assert.equal(getMinorUnits('TRY'), 2);
  assert.equal(getMinorUnits('EUR'), 2);
  assert.equal(getMinorUnits('USD'), 2);
});

test('getMinorUnits: JPY/KRW = 0', () => {
  assert.equal(getMinorUnits('JPY'), 0);
  assert.equal(getMinorUnits('KRW'), 0);
});

test('getMinorUnits: KWD/BHD = 3', () => {
  assert.equal(getMinorUnits('KWD'), 3);
  assert.equal(getMinorUnits('BHD'), 3);
});

test('majorToMinor: converts correctly', () => {
  assert.equal(majorToMinor(1000, 'TRY'), 100_000);
  assert.equal(majorToMinor(1000, 'JPY'), 1000);
  assert.equal(majorToMinor(1000, 'KWD'), 1_000_000);
});

test('minorToMajor: converts correctly', () => {
  assert.equal(minorToMajor(100_000, 'TRY'), 1000);
  assert.equal(minorToMajor(1000, 'JPY'), 1000);
  assert.equal(minorToMajor(1_000_000, 'KWD'), 1000);
});

test('optimization stage bases stay globally fixed (English-only canonical)', () => {
  assert.deepEqual(OPTIMIZATION_STAGE_BASES, {
    junk: 0.1,
    contacted: 10,
    offered: 50,
    won: 100,
  });
});

test('clampSystemScore bounds scores to 0..100', () => {
  assert.equal(clampSystemScore(-5), 0);
  assert.equal(clampSystemScore(42.4), 42);
  assert.equal(clampSystemScore(142), 100);
});

test('resolveQualityFactor follows the universal formula', () => {
  assert.equal(resolveQualityFactor(0), 0.6);
  assert.equal(resolveQualityFactor(50), 0.9);
  assert.equal(resolveQualityFactor(100), 1.2);
});

test('resolveOptimizationValue computes canonical values deterministically', () => {
  assert.deepEqual(resolveOptimizationValue({ stage: 'contacted', systemScore: 0 }), {
    stageBase: 10,
    systemScore: 0,
    qualityFactor: 0.6,
    optimizationValue: 6,
  });
  assert.deepEqual(resolveOptimizationValue({ stage: 'offered', systemScore: 50 }), {
    stageBase: 50,
    systemScore: 50,
    qualityFactor: 0.9,
    optimizationValue: 45,
  });
  assert.deepEqual(resolveOptimizationValue({ stage: 'won', systemScore: 100 }), {
    stageBase: 100,
    systemScore: 100,
    qualityFactor: 1.2,
    optimizationValue: 120,
  });
});

test('optimization values map cleanly to expected cents', () => {
  assert.equal(Math.round(resolveOptimizationValue({ stage: 'junk', systemScore: 0 }).optimizationValue * 100), 6);
  assert.equal(Math.round(resolveOptimizationValue({ stage: 'contacted', systemScore: 100 }).optimizationValue * 100), 1200);
  assert.equal(Math.round(resolveOptimizationValue({ stage: 'won', systemScore: 100 }).optimizationValue * 100), 12000);
});

// --- Source guard: runner must not use calculateExpectedValue ---
test('runner: must not import calculateExpectedValue', () => {
  const runnerPath = join(process.cwd(), 'lib', 'oci', 'runner.ts');
  const src = readFileSync(runnerPath, 'utf8');
  assert.ok(!src.includes('calculateExpectedValue'), 'runner must not use calculateExpectedValue');
});

test('runner: job.amount_cents must come from row.value_cents (queueRowToConversionJob)', () => {
  const processPath = join(process.cwd(), 'lib', 'cron', 'process-offline-conversions.ts');
  const src = readFileSync(processPath, 'utf8');
  assert.ok(src.includes('amount_cents: Number(row.value_cents)'), 'queueRowToConversionJob sets amount_cents from row.value_cents');
});

// --- Import ban: OCI must not import predictive-engine / calculateLeadValue for value ---
test('OCI runner: must not import predictive-engine', () => {
  const runnerPath = join(process.cwd(), 'lib', 'oci', 'runner.ts');
  const src = readFileSync(runnerPath, 'utf8');
  assert.ok(!src.includes('predictive-engine'), 'runner must not import predictive-engine');
});

test('OCI google-ads-export: must not import calculateLeadValue', () => {
  // Legacy /api/oci/export-batch was removed; script contract is google-ads-export → ack/verify.
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(!src.includes('calculateLeadValue'), 'google-ads-export must not use calculateLeadValue');
});
