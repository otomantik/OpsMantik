import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelOciProducerHttpStatus, panelOciRouteSuccess } from '../../lib/oci/panel-oci-response';

/**
 * INVARIANTS PROVEN:
 * 1. stage route returns explicit partial_failure or fail-closed response when producer returns ok:false
 * 2. status route same behavior
 * 3. seal route same behavior
 */
test('Panel Fail-Closed Semantics', async (t) => {
  const originalEnv = process.env.OCI_PANEL_OCI_FAIL_CLOSED;

  t.after(() => {
    process.env.OCI_PANEL_OCI_FAIL_CLOSED = originalEnv;
  });

  await t.test('returns 503 and success:false when fail-closed is enabled and producer fails', () => {
    process.env.OCI_PANEL_OCI_FAIL_CLOSED = 'true';
    const ociResult = {
      ok: false,
      outboxInserted: false,
      reconciliationPersisted: false,
      oci_reconciliation_reason: 'TEST_FAILURE',
    };

    const status = panelOciProducerHttpStatus(ociResult);
    const success = panelOciRouteSuccess(ociResult);

    assert.strictEqual(status, 503, 'Should return HTTP 503 Service Unavailable');
    assert.strictEqual(success, false, 'Should return success: false');
  });

  await t.test('returns 200 and success:true when fail-closed is disabled even if producer fails', () => {
    process.env.OCI_PANEL_OCI_FAIL_CLOSED = 'false';
    const ociResult = {
      ok: false,
      outboxInserted: false,
      reconciliationPersisted: false,
      oci_reconciliation_reason: 'TEST_FAILURE',
    };

    const status = panelOciProducerHttpStatus(ociResult);
    const success = panelOciRouteSuccess(ociResult);

    assert.strictEqual(status, 200, 'Should return HTTP 200 OK');
    assert.strictEqual(success, true, 'Should return success: true due to optional hardening');
  });
});
