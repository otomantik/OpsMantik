/**
 * PR-9J.CI-AUDIT-P1 — ACK SUCCESS proj_/adj_ must fail closed on missing or wrong-status targets.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAckProjectionReadyRows,
  classifyAckAdjustmentProcessingRows,
} from '@/lib/oci/ack-proj-adj-guard';

test('classifyAckProjectionReadyRows: exact READY coverage per call_id', () => {
  const cid = '11111111-1111-1111-1111-111111111111';
  const ok = classifyAckProjectionReadyRows([cid], [{ id: 'p1', call_id: cid }]);
  assert.equal(ok.kind, 'ok');
  if (ok.kind === 'ok') assert.deepEqual(ok.projectionRowIds, ['p1']);
});

test('classifyAckProjectionReadyRows: missing READY row', () => {
  const r = classifyAckProjectionReadyRows(
    ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
    [{ id: 'p1', call_id: '11111111-1111-1111-1111-111111111111' }]
  );
  assert.equal(r.kind, 'missing_or_not_ready');
});

test('classifyAckProjectionReadyRows: duplicate call_id is ambiguous', () => {
  const cid = '11111111-1111-1111-1111-111111111111';
  const r = classifyAckProjectionReadyRows(
    [cid],
    [
      { id: 'a', call_id: cid },
      { id: 'b', call_id: cid },
    ]
  );
  assert.equal(r.kind, 'ambiguous_duplicate_call_id');
});

test('classifyAckAdjustmentProcessingRows: set must match unique ids', () => {
  assert.equal(classifyAckAdjustmentProcessingRows(['a', 'b'], new Set(['a', 'b'])), 'ok');
  assert.equal(classifyAckAdjustmentProcessingRows(['a', 'b'], new Set(['a'])), 'missing_or_not_processing');
});

test('ACK route pins strict proj/adj guard + replay HTTP status for mismatch snapshots', () => {
  const ack = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'ack', 'route.ts'), 'utf8');
  assert.ok(ack.includes('resolveAckProjAdjTargetsForSuccess'), 'must validate proj/adj before update');
  assert.ok(ack.includes('ACK_PROJECTION_TARGET_MISMATCH'), 'projection mismatch code');
  assert.ok(ack.includes('ACK_ADJUSTMENT_TARGET_MISMATCH'), 'adjustment mismatch code');
  assert.ok(ack.includes('_ack_http_status'), 'mismatch snapshots must carry HTTP status for idempotent replay');
  assert.ok(ack.includes('oci_ack_projection_target_mismatch_total'));
  assert.ok(ack.includes('oci_ack_adjustment_target_mismatch_total'));
});

test('ACK_FAILED route rejects proj_/adj_ (explicit unsupported contract)', () => {
  const failed = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'ack-failed', 'route.ts'), 'utf8');
  assert.ok(failed.includes('ACK_FAILED_PROJ_ADJ_UNSUPPORTED'));
  assert.ok(failed.includes('projFailedIds'));
  assert.ok(failed.includes('adjFatalIds'));
});
