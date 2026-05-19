/**
 * Export SSOT: Google Ads script batch is driven only by offline_conversion_queue.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('chaos: export route counts include signals key for script compat (always zero)', () => {
  const routeSrc = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'route.ts'), 'utf8');
  assert.ok(routeSrc.includes('signals:'), 'export response keeps counts.signals for older script parsers');
  assert.ok(routeSrc.includes('signals: 0'), 'signals count is hard-zero in queue-only mode');
});

test('chaos: fetch never loads retired audit table into export batch', () => {
  const fetchSrc = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts'), 'utf8');
  const retiredFrom = ['from(\'', ['marketing', '_signals'].join(''), '\')'].join('');
  assert.ok(!fetchSrc.includes(retiredFrom), 'fetch must be journal-only');
});

test('chaos: preceding gate is strict queue-only', () => {
  const src = readFileSync(join(ROOT, 'lib', 'oci', 'preceding-signals.ts'), 'utf8');
  assert.ok(!src.includes('OCI_PRECEDING_CONSULT_MARKETING_SIGNALS'), 'legacy signal consult flag must be removed');
  assert.ok(src.includes('return hasBlockingPrecedingJournalMicroStages'), 'precedence must be queue-only');
});

test('chaos: backfill writers fail-closed toward queue parity helper', () => {
  const precursor = readFileSync(join(ROOT, 'lib', 'oci', 'backfill-precursor-signals.ts'), 'utf8');
  const backfillScript = readFileSync(
    join(ROOT, 'scripts', 'db', 'oci-cleanup-junk-and-backfill-intent-contacted.ts'),
    'utf8'
  );
  assert.ok(
    precursor.includes('ensureOciQueueEnqueue'),
    'precursor backfill must route through queue parity helper'
  );
  assert.ok(
    backfillScript.includes('parityQueueErrors'),
    'intent backfill must surface queue parity errors explicitly'
  );
});
