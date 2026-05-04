/**
 * L9 formal invariants — producer side (unit-level; no live DB).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  planPanelStageOciEnqueue,
  panelStageOciProducerOk,
  type PanelReturnedCall,
} from '@/lib/oci/enqueue-panel-stage-outbox';
import { hasAnyAdsClickId } from '@/lib/oci/session-click-id';
import { OCI_RECONCILIATION_REASONS } from '@/lib/oci/reconciliation-reasons';
import type { PrimarySource } from '@/lib/oci/oci-click-attribution';

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

test('INV-NoSilentSuccess: ok iff outbox or reconciliation audit', () => {
  assert.equal(panelStageOciProducerOk({ outboxInserted: true, reconciliationPersisted: undefined }), true);
  assert.equal(panelStageOciProducerOk({ outboxInserted: false, reconciliationPersisted: true }), true);
  assert.equal(panelStageOciProducerOk({ outboxInserted: false, reconciliationPersisted: false }), false);
});

test('INV-MergedNoOutbox: merged_into forces reconcile, not insert', () => {
  const plan = planPanelStageOciEnqueue({
    call: baseCall({ merged_into_call_id: '99999999-9999-4999-9999-999999999999' }),
    primary: { gclid: 'CjwKCAjwValidClickIdExmpl12345', wbraid: null, gbraid: null },
    intentPrecursorEnabled: false,
  });
  assert.equal(plan.outcome, 'reconcile');
  if (plan.outcome === 'reconcile') {
    assert.equal(plan.reason, OCI_RECONCILIATION_REASONS.MERGED_CALL);
  }
});

test('INV-ProducerClick: plan insert iff hasAnyAdsClickId(primary) (non-test)', () => {
  const primary: PrimarySource = { gclid: 'CjwKCAjwValidClickIdExmpl12345', wbraid: null, gbraid: null };
  const plan = planPanelStageOciEnqueue({
    call: baseCall(),
    primary,
    intentPrecursorEnabled: false,
  });
  assert.equal(plan.outcome === 'insert', hasAnyAdsClickId(primary));
});

test('INV-SiteScope: merge overlay query scopes by site_id + id', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'lib/oci/panel-call-merge-context.ts'), 'utf8');
  assert.ok(
    src.includes(".eq('id', call.id)") && src.includes(".eq('site_id', call.site_id)"),
    'merge overlay must filter both id and site_id'
  );
});
