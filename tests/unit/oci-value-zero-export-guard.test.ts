import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateOciQueueValueCents, validateOciSignalConversionValue } from '@/lib/oci/export-value-guard';

const EXPORT_ROUTE = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');

test('PR-OCI-4: queue export rejects null, non-finite, and non-positive values', () => {
  assert.deepEqual(validateOciQueueValueCents(null), { ok: false, reason: 'NULL_VALUE' });
  assert.deepEqual(validateOciQueueValueCents('not-a-number'), { ok: false, reason: 'NON_FINITE_VALUE' });
  assert.deepEqual(validateOciQueueValueCents(0), { ok: false, reason: 'NON_POSITIVE_VALUE' });
  assert.deepEqual(validateOciQueueValueCents(-1), { ok: false, reason: 'NON_POSITIVE_VALUE' });
});

test('PR-OCI-4: queue export preserves valid positive value_cents', () => {
  const result = validateOciQueueValueCents(12345);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.normalized, 12345);
  }
});

test('PR-OCI-9A: signal export rejects null, non-finite, and non-positive conversion values', () => {
  assert.deepEqual(validateOciSignalConversionValue(null), { ok: false, reason: 'NULL_VALUE' });
  assert.deepEqual(validateOciSignalConversionValue(Number.NaN), { ok: false, reason: 'NON_FINITE_VALUE' });
  assert.deepEqual(validateOciSignalConversionValue(0), { ok: false, reason: 'NON_POSITIVE_VALUE' });
  assert.deepEqual(validateOciSignalConversionValue(-0.01), { ok: false, reason: 'NON_POSITIVE_VALUE' });
});

test('PR-OCI-9A: signal export preserves valid positive conversion value', () => {
  const result = validateOciSignalConversionValue(19.99);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.normalized, 19.99);
  }
});

test('PR-OCI-4: export route uses shared fail-closed value guards and terminalizes blocked rows', () => {
  const src = readFileSync(EXPORT_ROUTE, 'utf8');
  assert.ok(src.includes('validateOciQueueValueCents'), 'queue export must use shared value guard');
  assert.ok(src.includes('validateOciSignalConversionValue'), 'signal export must use shared value guard');
  assert.ok(src.includes('blockedSignalValueIds'), 'signal zero-value rows must be tracked for terminalization');
  assert.ok(src.includes("dispatch_status: 'FAILED'") || src.includes('dispatch_status: "FAILED"'), 'blocked signals must be terminalized');
  assert.ok(src.includes("code: 'VALUE_ZERO'") || src.includes('code: "VALUE_ZERO"'), 'blocked queue rows must keep VALUE_ZERO provenance');
  assert.ok(src.includes("code: 'INVALID_CONVERSION_TIME'") || src.includes('code: "INVALID_CONVERSION_TIME"'), 'blocked queue time rows must keep INVALID_CONVERSION_TIME provenance');
});
