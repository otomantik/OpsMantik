/**
 * Regression: ACK SUCCESS must finalize claimed PROCESSING rows even if live call
 * would no longer pass export sendability (PR-9I.1 snapshot trust).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aggregateAckSealSuccessRows } from '@/lib/oci/ack-finalization-policy';

test('ack route: no live sendability fetch and no post-claim sendability hard block', () => {
  const ack = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'ack', 'route.ts'), 'utf8');
  assert.equal(ack.includes('fetchCallSendabilityRowsForSite'), false);
  assert.equal(ack.includes('isQueueRowSendableForGoogleAdsExport'), false);
});

test('export-build-items: export-time sendability remains (authoritative at claim)', () => {
  const build = readFileSync(
    join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-items.ts'),
    'utf8'
  );
  assert.match(build, /isQueueRowSendableForGoogleAdsExport/);
});

test('aggregateAckSealSuccessRows finalizes every PROCESSING id regardless of hypothetical drift', () => {
  const ids = aggregateAckSealSuccessRows([
    { id: 'q1', status: 'PROCESSING' },
    { id: 'q2', status: 'PROCESSING' },
  ]).finalizeIds;
  assert.equal(ids.length, 2);
});

test('ack-failed accepts RATE_LIMIT and UNKNOWN categories (explicit taxonomy)', () => {
  const failed = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'ack-failed', 'route.ts'), 'utf8');
  assert.match(failed, /'RATE_LIMIT'/);
  assert.match(failed, /'UNKNOWN'/);
  assert.match(failed, /isTerminalSuccessStatus/);
});
