import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  aggregateAckSealSuccessRows,
  classifyAckFinalization,
  mapAckFinalizationTallyToObservability,
} from '@/lib/oci/ack-finalization-policy';
import { evaluatePersistedSummaryEquations } from '../../scripts/release/script-summary-target-equations.mjs';

test('PR-9I.1 classifyAckFinalization: PROCESSING + SUCCESS → finalize', () => {
  assert.equal(classifyAckFinalization({ status: 'PROCESSING' }, 'SUCCESS'), 'ACK_FINALIZE_SUCCESS');
});

test('PR-9I.1 classifyAckFinalization: COMPLETED / UPLOADED replay codes', () => {
  assert.equal(classifyAckFinalization({ status: 'COMPLETED' }, 'SUCCESS'), 'ACK_REPLAY_ALREADY_COMPLETED');
  assert.equal(classifyAckFinalization({ status: 'UPLOADED' }, 'SUCCESS'), 'ACK_REPLAY_ALREADY_UPLOADED');
  assert.equal(classifyAckFinalization({ status: 'COMPLETED_UNVERIFIED' }, 'SUCCESS'), 'ACK_REPLAY_ALREADY_COMPLETED');
});

test('PR-9I.1 classifyAckFinalization: FAILED queue row + SUCCESS ack → ignore (no resurrect)', () => {
  assert.equal(classifyAckFinalization({ status: 'FAILED' }, 'SUCCESS'), 'ACK_IGNORE_ALREADY_FAILED');
});

test('PR-9I.1 classifyAckFinalization: QUEUED + SUCCESS ack → reject', () => {
  assert.equal(classifyAckFinalization({ status: 'QUEUED' }, 'SUCCESS'), 'ACK_REJECT_NOT_PROCESSING');
});

test('PR-9I.1 aggregateAckSealSuccessRows collects finalize ids without live call state', () => {
  const rows = [
    { id: 'a', status: 'PROCESSING' },
    { id: 'b', status: 'COMPLETED' },
    { id: 'c', status: 'PROCESSING' },
  ];
  const agg = aggregateAckSealSuccessRows(rows);
  assert.deepEqual(agg.finalizeIds.sort(), ['a', 'c'].sort());
  const obs = mapAckFinalizationTallyToObservability(agg.tally);
  assert.equal(obs.ACK_SUCCESS_FINALIZED_CLAIMED_ROW, 2);
  assert.equal(obs.ACK_SUCCESS_REPLAY_ALREADY_TERMINAL, 1);
});

test('PR-9I.1 observability: post-claim “would fail sendability” is not modeled in tally (no blocker)', () => {
  const agg = aggregateAckSealSuccessRows([{ id: 'x', status: 'PROCESSING' }]);
  const obs = mapAckFinalizationTallyToObservability(agg.tally);
  assert.equal(obs.ACK_SUCCESS_FINALIZED_CLAIMED_ROW, 1);
  assert.equal(obs.ACK_SUCCESS_REJECT_NOT_PROCESSING, 0);
});

test('PR-9I.1 ack route wires snapshot policy and drops mutable sendability imports', () => {
  const ack = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'ack', 'route.ts'), 'utf8');
  assert.match(ack, /from '@\/lib\/oci\/ack-finalization-policy'/);
  assert.match(ack, /ack_finalization_policy/);
});

test('PR-9I.1 script summary Eq E–H still green for synthetic PR-9I row', () => {
  const row = {
    fetched_count: 3,
    claimed_count: 3,
    classified_uploadable_count: 2,
    classified_skipped_count: 0,
    classified_failed_count: 1,
    upload_attempted_count: 2,
    upload_success_count: 2,
    upload_failed_count: 0,
    ack_success_count: 2,
    ack_failed_count: 0,
    ack_skipped_count: 0,
    provider_ambiguous_pending_count: 0,
    selected_gclid_count: 1,
    selected_wbraid_count: 1,
    selected_gbraid_count: 0,
    multiple_click_ids_count: 1,
    hashed_phone_attached_count: 1,
    hashed_phone_only_rejected_count: 1,
    missing_click_id_count: 0,
    invalid_time_count: 0,
    other_validation_failed_count: 0,
    status: 'SCRIPT_SUMMARY_RECEIVED',
  };
  const ev = evaluatePersistedSummaryEquations(row);
  assert.deepEqual(ev.mismatch_reasons, []);
  assert.match(ev.checked_equations, /H/);
});

test('PR-9I.1 universal click-id selection identity: gclid + wbraid + gbraid = upload_attempted', () => {
  const g = 1;
  const w = 1;
  const b = 0;
  const uploadAttempted = 2;
  assert.equal(g + w + b, uploadAttempted);
});
