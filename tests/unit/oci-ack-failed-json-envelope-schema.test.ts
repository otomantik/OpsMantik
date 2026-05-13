import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAckFailedJsonEnvelope } from '@/lib/oci/oci-ack-route-helpers';

test('parseAckFailedJsonEnvelope: fleet-shaped payload passes', () => {
  const r = parseAckFailedJsonEnvelope({
    siteId: 'Eslamed',
    queueIds: ['seal_a'],
    errorCode: 'X',
    errorMessage: 'm',
    errorCategory: 'TRANSIENT',
    exportRunId: 'r1',
    export_run_id: 'r1',
  });
  assert.equal(r.ok, true);
});

test('parseAckFailedJsonEnvelope: unknown key fails strict', () => {
  const r = parseAckFailedJsonEnvelope({
    siteId: 'x',
    queueIds: ['seal_a'],
    extra: 1,
  });
  assert.equal(r.ok, false);
  if (r.ok || r.reason !== 'schema_violation') return;
  assert.ok(r.issues.length > 0);
});

test('parseAckFailedJsonEnvelope: invalid errorCategory fails', () => {
  const r = parseAckFailedJsonEnvelope({
    siteId: 'x',
    queueIds: ['a'],
    errorCategory: 'NOT_A_CATEGORY',
  });
  assert.equal(r.ok, false);
});
