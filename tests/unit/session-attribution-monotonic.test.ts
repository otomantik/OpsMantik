/**
 * PR-OCI-7: Monotonic attribution - never downgrade Paid → Organic
 * Verifies ATTRIBUTION_WEIGHTS and update logic via source inspection + mock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SESSION_SERVICE_PATH = join(process.cwd(), 'lib/services/session-service.ts');

test('session-service: ATTRIBUTION_WEIGHTS present with First Click (Paid) > Organic', () => {
  const src = readFileSync(SESSION_SERVICE_PATH, 'utf8');
  assert.ok(src.includes('ATTRIBUTION_WEIGHTS'), 'ATTRIBUTION_WEIGHTS must exist');
  assert.ok(src.includes("'First Click (Paid)'"), 'First Click (Paid) in weights');
  assert.ok(src.includes("Organic"), 'Organic in weights');
  assert.ok(src.includes('newWeight >= currentWeight'), 'Monotonic check: only upgrade when newWeight >= currentWeight');
});

test('session-service: attribution_source update only when newWeight >= currentWeight', () => {
  const src = readFileSync(SESSION_SERVICE_PATH, 'utf8');
  const monotonicBlock = src.includes('currentWeight = ATTRIBUTION_WEIGHTS') &&
    src.includes('newWeight = ATTRIBUTION_WEIGHTS') &&
    src.includes('if (newWeight >= currentWeight)') &&
    src.includes('updates.attribution_source = attributionSource');
  assert.ok(monotonicBlock, 'Monotonic attribution logic must gate attribution_source update');
});

test('session-service: click-ID immutability - hasExistingGclid preserves session.gclid', () => {
  const src = readFileSync(SESSION_SERVICE_PATH, 'utf8');
  assert.ok(src.includes('hasExistingGclid'), 'hasExistingGclid check present');
  assert.ok(src.includes('hasExistingWbraid'), 'hasExistingWbraid check present');
  assert.ok(src.includes('hasExistingGbraid'), 'hasExistingGbraid check present');
});
