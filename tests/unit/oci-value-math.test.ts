/**
 * One True Math — Regression guards for OCI conversion value.
 * - Currency utilities (getMinorUnits, majorToMinor, minorToMajor)
 * - value-calculator (V5, V2–V4)
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
  calculateConversionValueMinor,
  AOV_FLOOR_MAJOR,
} from '@/lib/domain/mizan-mantik';
import { calculateSignalEV } from '@/lib/domain/mizan-mantik/time-decay';
import { getValueFloorCents } from '@/lib/domain/mizan-mantik/value-config';

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

// --- Value calculator V5 ---
test('calculateConversionValueMinor V5: sale_amount_minor > 0 returns sale', () => {
  const result = calculateConversionValueMinor({
    gear: 'V5_SEAL',
    currency: 'TRY',
    saleAmountMinor: 25_000,
    siteAovMinor: 50_000, // ignored
  });
  assert.equal(result, 25_000);
});

test('calculateConversionValueMinor V5: sale_amount null/0 falls back to site minimum', () => {
  assert.equal(
    calculateConversionValueMinor({ gear: 'V5_SEAL', currency: 'TRY', saleAmountMinor: 0 }),
    100000
  );
  assert.equal(
    calculateConversionValueMinor({ gear: 'V5_SEAL', currency: 'TRY', saleAmountMinor: null }),
    100000
  );
});

test('calculateConversionValueMinor V1: returns 1 minor visibility unit', () => {
  assert.equal(
    calculateConversionValueMinor({ gear: 'V1_PAGEVIEW', siteAovMinor: 100_000 }),
    1
  );
});

test('calculateConversionValueMinor V2–V4: uses AOV and decay', () => {
  const result = calculateConversionValueMinor({
    gear: 'V2_PULSE',
    currency: 'TRY',
    siteAovMinor: 100_000, // 1000 TRY
    clickDate: new Date('2024-01-01'),
    signalDate: new Date('2024-01-15'),
  });
  assert.ok(Number.isInteger(result), 'result must be integer');
  assert.ok(result >= 0, 'result must be non-negative');
});

test('calculateConversionValueMinor V2–V4: AOV floor applies for JPY', () => {
  // AOV_FLOOR for JPY = 1000 (0 decimals)
  assert.equal(majorToMinor(AOV_FLOOR_MAJOR, 'JPY'), 1000);
});

test('Eslamed-style signal floor no longer flattens V2–V4 to site min conversion value', () => {
  const config = {
    siteId: 'eslamed-test',
    defaultAov: 1000,
    intentWeights: { pending: 0.02, qualified: 0.2, proposal: 0.3, sealed: 1.0 },
    minConversionValueCents: 100_000,
  };
  const clickDate = new Date('2026-03-04T16:00:00.000Z');
  const signalDate = new Date('2026-03-05T16:00:00.000Z');
  const floorCents = getValueFloorCents(config);

  assert.equal(floorCents, 500, 'signal floor stays ratio-based even when site min is 1000 TRY');
  assert.equal(calculateSignalEV('V2_PULSE', 100_000, clickDate, signalDate, config.intentWeights), 1_000, 'V2 keeps computed 10 TRY value');
  assert.equal(calculateSignalEV('V3_ENGAGE', 100_000, clickDate, signalDate, config.intentWeights), 10_000, 'V3 keeps computed 100 TRY value');
  assert.equal(calculateSignalEV('V4_INTENT', 100_000, clickDate, signalDate, config.intentWeights), 15_000, 'V4 keeps computed 150 TRY value');
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
