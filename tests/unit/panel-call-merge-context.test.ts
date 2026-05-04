import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePanelReturnedCallDbSnapshot } from '@/lib/oci/panel-call-merge-context';
import type { PanelReturnedCall } from '@/lib/oci/enqueue-panel-stage-outbox';
import { panelStageOciProducerOk } from '@/lib/oci/enqueue-panel-stage-outbox';

const site = '00000000-0000-4000-8000-000000000001';
const callId = '10000000-0000-4000-8000-000000000002';

function baseCall(over: Partial<PanelReturnedCall> = {}): PanelReturnedCall {
  return {
    id: callId,
    site_id: site,
    status: 'contacted',
    matched_session_id: 'sess-1',
    ...over,
  };
}

test('mergePanelReturnedCallDbSnapshot: DB merged_into wins over empty RPC', () => {
  const survivor = '99999999-9999-4999-9999-999999999999';
  const merged = mergePanelReturnedCallDbSnapshot(baseCall({ merged_into_call_id: null }), {
    merged_into_call_id: survivor,
    matched_session_id: 'sess-db',
  });
  assert.equal(merged.merged_into_call_id, survivor);
});

test('mergePanelReturnedCallDbSnapshot: keeps RPC session when present', () => {
  const merged = mergePanelReturnedCallDbSnapshot(
    baseCall({ matched_session_id: 'sess-rpc' }),
    { matched_session_id: 'sess-db', merged_into_call_id: null }
  );
  assert.equal(merged.matched_session_id, 'sess-rpc');
});

test('mergePanelReturnedCallDbSnapshot: fills session from DB when RPC empty', () => {
  const merged = mergePanelReturnedCallDbSnapshot(
    baseCall({ matched_session_id: null }),
    { matched_session_id: 'sess-db', merged_into_call_id: null }
  );
  assert.equal(merged.matched_session_id, 'sess-db');
});

test('panelStageOciProducerOk matches INV', () => {
  assert.equal(panelStageOciProducerOk({ outboxInserted: true, reconciliationPersisted: undefined }), true);
  assert.equal(panelStageOciProducerOk({ outboxInserted: false, reconciliationPersisted: true }), true);
  assert.equal(panelStageOciProducerOk({ outboxInserted: false, reconciliationPersisted: false }), false);
  assert.equal(panelStageOciProducerOk({ outboxInserted: false, reconciliationPersisted: undefined }), false);
});
