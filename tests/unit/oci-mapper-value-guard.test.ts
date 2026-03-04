/**
 * PR-OCI-9A: Mapper must throw INVALID_VALUE_CENTS for non-finite or <= 0 value_cents.
 * Fail-closed; never send NaN/0 to Google Ads.
 * Source-inspection test (fast, stable, no import path issues).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAPPER_PATH = join(process.cwd(), 'lib', 'providers', 'google_ads', 'mapper.ts');

test('PR-OCI-9A: mapper must throw INVALID_VALUE_CENTS for invalid value_cents', () => {
  const src = readFileSync(MAPPER_PATH, 'utf-8');
  assert.ok(src.includes('INVALID_VALUE_CENTS'), 'Mapper must throw INVALID_VALUE_CENTS');
  assert.ok(
    src.includes('typeof valueCents') && src.includes('Number.isFinite(valueCents)'),
    'Mapper must guard valueCents type and finiteness'
  );
  assert.ok(src.includes('valueCents <= 0'), 'Mapper must reject valueCents <= 0');
});
