import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyPanelOciEnqueue,
  isPanelOciFailClosed,
  panelOciProducerHttpStatus,
  panelOciRouteSuccess,
} from '@/lib/oci/panel-oci-response';
import type { PanelStageOciEnqueueResult } from '@/lib/oci/enqueue-panel-stage-outbox';

test('classify: insert ok → processed', () => {
  const oci: PanelStageOciEnqueueResult = {
    ok: true,
    outboxInserted: true,
    oci_reconciliation_reason: null,
  };
  const c = classifyPanelOciEnqueue(oci);
  assert.equal(c.classification, 'processed');
  assert.equal(c.artifact_written, true);
});

test('classify: reconcile-only → reconciled_skip', () => {
  const oci: PanelStageOciEnqueueResult = {
    ok: true,
    outboxInserted: false,
    reconciliationPersisted: true,
    oci_reconciliation_reason: 'TEST_CLICK_ID',
  };
  const c = classifyPanelOciEnqueue(oci);
  assert.equal(c.classification, 'reconciled_skip');
});

test('classify: producer not ok → partial_failure', () => {
  const oci: PanelStageOciEnqueueResult = {
    ok: false,
    outboxInserted: false,
    oci_reconciliation_reason: 'OUTBOX_INSERT_FAILED',
  };
  assert.equal(classifyPanelOciEnqueue(oci).classification, 'partial_failure');
});

test('fail-closed env toggles HTTP + success', async (t) => {
  const prev = process.env.OCI_PANEL_OCI_FAIL_CLOSED;
  t.after(() => {
    if (prev === undefined) delete process.env.OCI_PANEL_OCI_FAIL_CLOSED;
    else process.env.OCI_PANEL_OCI_FAIL_CLOSED = prev;
  });
  const oci: PanelStageOciEnqueueResult = {
    ok: false,
    outboxInserted: false,
    oci_reconciliation_reason: 'X',
  };
  process.env.OCI_PANEL_OCI_FAIL_CLOSED = '0';
  assert.equal(isPanelOciFailClosed(), false);
  assert.equal(panelOciProducerHttpStatus(oci), 200);
  assert.equal(panelOciRouteSuccess(oci), true);
  process.env.OCI_PANEL_OCI_FAIL_CLOSED = 'true';
  assert.equal(isPanelOciFailClosed(), true);
  assert.equal(panelOciProducerHttpStatus(oci), 503);
  assert.equal(panelOciRouteSuccess(oci), false);
});
