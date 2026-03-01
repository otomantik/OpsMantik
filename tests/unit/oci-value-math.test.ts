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

test('calculateConversionValueMinor V5: sale_amount null/0 returns 0', () => {
  assert.equal(
    calculateConversionValueMinor({ gear: 'V5_SEAL', currency: 'TRY', saleAmountMinor: 0 }),
    0
  );
  assert.equal(
    calculateConversionValueMinor({ gear: 'V5_SEAL', currency: 'TRY', saleAmountMinor: null }),
    0
  );
});

test('calculateConversionValueMinor V1: always 0', () => {
  assert.equal(
    calculateConversionValueMinor({ gear: 'V1_PAGEVIEW', siteAovMinor: 100_000 }),
    0
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

test('OCI export-batch: must not import calculateLeadValue', () => {
  const batchPath = join(process.cwd(), 'app', 'api', 'oci', 'export-batch', 'route.ts');
  const src = readFileSync(batchPath, 'utf8');
  assert.ok(!src.includes('calculateLeadValue'), 'export-batch must not use calculateLeadValue');
});
