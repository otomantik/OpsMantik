import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planPrecursorBackfillStages,
  stagesImpliedByCallStatus,
} from '@/lib/oci/precursor-backfill-plan';

test('stagesImpliedByCallStatus: qualified → contacted only', () => {
  assert.deepEqual(stagesImpliedByCallStatus('qualified'), ['contacted']);
});

test('stagesImpliedByCallStatus: confirmed/real → contacted + offered', () => {
  assert.deepEqual(stagesImpliedByCallStatus('confirmed'), ['contacted', 'offered']);
  assert.deepEqual(stagesImpliedByCallStatus('real'), ['contacted', 'offered']);
});

test('plan: no ledger → full fallback from snapshot time', () => {
  const created = '2026-01-10T12:00:00.000Z';
  const plan = planPrecursorBackfillStages({
    ledgerContacted: null,
    ledgerOffered: null,
    callStatus: 'qualified',
    confirmedAt: null,
    createdAt: created,
  });
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0], {
    stage: 'contacted',
    occurredIso: created,
    source: 'call_snapshot_fallback',
  });
});

test('plan: ledger contacted only + confirmed → offered uses hybrid time', () => {
  const created = '2026-01-15T08:00:00.000Z';
  const ledgerContacted = '2026-01-14T10:00:00.000Z';
  const plan = planPrecursorBackfillStages({
    ledgerContacted,
    ledgerOffered: null,
    callStatus: 'confirmed',
    confirmedAt: null,
    createdAt: created,
  });
  assert.equal(plan.length, 2);
  assert.deepEqual(plan[0], {
    stage: 'contacted',
    occurredIso: ledgerContacted,
    source: 'ledger',
  });
  assert.deepEqual(plan[1], {
    stage: 'offered',
    occurredIso: created,
    source: 'call_snapshot_hybrid',
  });
});

test('plan: full ledger → no hybrid', () => {
  const lc = '2026-01-01T01:00:00.000Z';
  const lo = '2026-01-02T02:00:00.000Z';
  const plan = planPrecursorBackfillStages({
    ledgerContacted: lc,
    ledgerOffered: lo,
    callStatus: 'confirmed',
    confirmedAt: null,
    createdAt: '2026-01-03T03:00:00.000Z',
  });
  assert.equal(plan.length, 2);
  assert.equal(plan[0].source, 'ledger');
  assert.equal(plan[1].source, 'ledger');
});

test('plan: empty fallback ISO → no stages', () => {
  const plan = planPrecursorBackfillStages({
    ledgerContacted: null,
    ledgerOffered: null,
    callStatus: 'qualified',
    confirmedAt: null,
    createdAt: '',
  });
  assert.equal(plan.length, 0);
});
