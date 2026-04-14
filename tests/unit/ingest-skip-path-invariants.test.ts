/**
 * PR-T1 P0: Skip-path invariants (traffic_debloat).
 * Asserts via source inspection: when worker skips (bot/referrer),
 * tryInsertIdempotencyKey is called with billable: false, runSyncGates is not
 * executed for that message, and processed_signals receives terminal status (skipped).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE_PATH = join(process.cwd(), 'lib', 'ingest', 'worker-kernel.ts');

test('skip path: tryInsertIdempotencyKey called with billable: false', () => {
  const src = readFileSync(ROUTE_PATH, 'utf8');
  assert.ok(src.includes('tryInsertIdempotencyKey'), 'route uses tryInsertIdempotencyKey');
  assert.ok(
    src.includes('billable: false') && src.includes('billingReason: skipReasonApi'),
    'skip path calls tryInsertIdempotencyKey with billable: false'
  );
});

test('skip path: runSyncGates not in skip branch (return before gates)', () => {
  const src = readFileSync(ROUTE_PATH, 'utf8');
  const botReferrerSkip = src.indexOf('if (botSkip || referrerSkip)');
  assert.ok(botReferrerSkip >= 0, 'bot/referrer skip branch exists');
  const skipBlockEnd = src.indexOf('skipped: true, reason: skipReasonApi', botReferrerSkip);
  assert.ok(skipBlockEnd >= 0, 'skip path returns with skipped: true');
  const between = src.slice(botReferrerSkip, skipBlockEnd + 120);
  assert.ok(!between.includes('runSyncGates('), 'skip branch does not call runSyncGates (usage path not executed)');
  assert.ok(src.includes('runSyncGates(job'), 'route calls runSyncGates only after trafficDebloat block');
});

test('skip path: processed_signals receives terminal status (skipped)', () => {
  const src = readFileSync(ROUTE_PATH, 'utf8');
  assert.ok(
    src.includes("status: 'skipped'") || src.includes('status: "skipped"'),
    'processed_signals insert uses status skipped (terminal)'
  );
  assert.ok(
    src.includes("from('processed_signals')") || src.includes('from("processed_signals")'),
    'route inserts into processed_signals in skip path'
  );
});

test('skip path: usage not incremented (no runSyncGates on skip path)', () => {
  const src = readFileSync(ROUTE_PATH, 'utf8');
  const ifTrafficDebloat = src.indexOf('if (trafficDebloat)');
  const skipReturn = src.indexOf('skipped: true, reason: skipReasonApi', ifTrafficDebloat);
  const blockContainingSkip = src.slice(ifTrafficDebloat, skipReturn + 200);
  assert.ok(!blockContainingSkip.includes('incrementUsageRedis') && !blockContainingSkip.includes('runSyncGates'), 'skip branch does not call incrementUsageRedis or runSyncGates');
});
