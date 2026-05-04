import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planPanelStageOciEnqueue,
  type PanelReturnedCall,
} from '@/lib/oci/enqueue-panel-stage-outbox';
import { OCI_RECONCILIATION_REASONS } from '@/lib/oci/reconciliation-reasons';
import type { PrimarySource } from '@/lib/oci/oci-click-attribution';

const site = '00000000-0000-4000-8000-000000000001';
const callId = '10000000-0000-4000-8000-000000000002';

function baseCall(over: Partial<PanelReturnedCall> = {}): PanelReturnedCall {
  return {
    id: callId,
    site_id: site,
    status: 'contacted',
    matched_session_id: '20000000-0000-4000-8000-000000000003',
    lead_score: 50,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

test('session lacks click but call-level primary has gclid → insert contacted', () => {
  const primary: PrimarySource = { gclid: 'CjwK123', wbraid: null, gbraid: null };
  const plan = planPanelStageOciEnqueue({
    call: baseCall({ status: 'contacted', matched_session_id: 'sess-1' }),
    primary,
    intentPrecursorEnabled: false,
  });
  assert.equal(plan.outcome, 'insert');
  if (plan.outcome === 'insert') assert.equal(plan.stage, 'contacted');
});

test('matched_session_id null but primary has valid gclid → insert', () => {
  const primary: PrimarySource = { gclid: 'EAIaIQobChMIx', wbraid: null, gbraid: null };
  const plan = planPanelStageOciEnqueue({
    call: baseCall({ status: 'contacted', matched_session_id: null }),
    primary,
    intentPrecursorEnabled: false,
  });
  assert.equal(plan.outcome, 'insert');
});

test('merged call → reconcile MERGED_CALL', () => {
  const plan = planPanelStageOciEnqueue({
    call: baseCall({ merged_into_call_id: '99999999-9999-4999-9999-999999999999', status: 'contacted' }),
    primary: { gclid: 'CjwK', wbraid: null, gbraid: null },
    intentPrecursorEnabled: false,
  });
  assert.equal(plan.outcome, 'reconcile');
  if (plan.outcome === 'reconcile') {
    assert.equal(plan.reason, OCI_RECONCILIATION_REASONS.MERGED_CALL);
  }
});

test('test click id → reconcile TEST_CLICK_ID', () => {
  const primary: PrimarySource = { gclid: 'prefix_TEST_GCLID_suffix', wbraid: null, gbraid: null };
  const plan = planPanelStageOciEnqueue({
    call: baseCall({ status: 'contacted' }),
    primary,
    intentPrecursorEnabled: false,
  });
  assert.equal(plan.outcome, 'reconcile');
  if (plan.outcome === 'reconcile') assert.equal(plan.reason, OCI_RECONCILIATION_REASONS.TEST_CLICK_ID);
});

test('no session and no ads click → reconcile NO_MATCHED_SESSION', () => {
  const plan = planPanelStageOciEnqueue({
    call: baseCall({ status: 'contacted', matched_session_id: null }),
    primary: null,
    intentPrecursorEnabled: false,
  });
  assert.equal(plan.outcome, 'reconcile');
  if (plan.outcome === 'reconcile') assert.equal(plan.reason, OCI_RECONCILIATION_REASONS.NO_MATCHED_SESSION);
});

test('has session but no ads click on primary → reconcile NO_ADS_CLICK_ID', () => {
  const plan = planPanelStageOciEnqueue({
    call: baseCall({ status: 'contacted', matched_session_id: 'sess-xyz' }),
    primary: { gclid: '', wbraid: null, gbraid: null },
    intentPrecursorEnabled: false,
  });
  assert.equal(plan.outcome, 'reconcile');
  if (plan.outcome === 'reconcile') assert.equal(plan.reason, OCI_RECONCILIATION_REASONS.NO_ADS_CLICK_ID);
});

test('intent without precursor flag → NO_EXPORTABLE_OCI_STAGE even with click', () => {
  const plan = planPanelStageOciEnqueue({
    call: baseCall({ status: 'intent' }),
    primary: { gclid: 'ValidClick', wbraid: null, gbraid: null },
    intentPrecursorEnabled: false,
  });
  assert.equal(plan.outcome, 'reconcile');
  if (plan.outcome === 'reconcile') assert.equal(plan.reason, OCI_RECONCILIATION_REASONS.NO_EXPORTABLE_OCI_STAGE);
});

test('intent with precursor flag and valid click → insert contacted', () => {
  const plan = planPanelStageOciEnqueue({
    call: baseCall({ status: 'intent' }),
    primary: { gclid: 'ValidClick', wbraid: null, gbraid: null },
    intentPrecursorEnabled: true,
  });
  assert.equal(plan.outcome, 'insert');
  if (plan.outcome === 'insert') assert.equal(plan.stage, 'contacted');
});
