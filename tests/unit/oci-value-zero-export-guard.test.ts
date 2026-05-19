import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateOciQueueValueCents } from '@/lib/oci/export-value-guard';

const EXPORT_BUILD_QUEUE = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-queue.ts');
const EXPORT_BUILD_ITEMS = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-items.ts');
const EXPORT_MARK = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts');
const LEGACY_SIGNAL_GUARD = ['validateOci', 'Signal', 'ConversionValue'].join('');

test('PR-OCI-4: queue export rejects null, non-finite, and non-positive values', () => {
  assert.deepEqual(validateOciQueueValueCents(null), { ok: false, reason: 'NULL_VALUE' });
  assert.deepEqual(validateOciQueueValueCents('not-a-number'), { ok: false, reason: 'NON_FINITE_VALUE' });
  assert.deepEqual(validateOciQueueValueCents(0), { ok: false, reason: 'NON_POSITIVE_VALUE' });
  assert.deepEqual(validateOciQueueValueCents(-1), { ok: false, reason: 'NON_POSITIVE_VALUE' });
});

test('PR-OCI-4: queue export preserves valid positive value_cents', () => {
  const result = validateOciQueueValueCents(12345);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.normalized, 12345);
});

test('PR-OCI-4: export route uses shared fail-closed value guards and terminalizes blocked rows', () => {
  const queueSrc = readFileSync(EXPORT_BUILD_QUEUE, 'utf8');
  assert.ok(queueSrc.includes('validateOciQueueValueCents'), 'queue export must use shared value guard');
  assert.ok(!queueSrc.includes(LEGACY_SIGNAL_GUARD), 'journal export must not use legacy signal value guard alias');
  const itemsSrc = readFileSync(EXPORT_BUILD_ITEMS, 'utf8');
  assert.ok(itemsSrc.includes('blockedValueZeroIds: queueBuild.blockedValueZeroIds'));
  assert.ok(itemsSrc.includes('blockedQueueTimeIds: queueBuild.blockedQueueTimeIds'));
  const markSrc = readFileSync(EXPORT_MARK, 'utf8');
  assert.ok(markSrc.includes('blockedValueZeroIds'));
  assert.ok(markSrc.includes("'VALUE_ZERO'"));
});
