import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOciStageFromCallStatus } from '@/lib/oci/enqueue-panel-stage-outbox';

test('maps canonical call statuses to OCI pipeline stages', () => {
  assert.equal(resolveOciStageFromCallStatus('junk'), 'junk');
  assert.equal(resolveOciStageFromCallStatus('contacted'), 'contacted');
  assert.equal(resolveOciStageFromCallStatus('offered'), 'offered');
  assert.equal(resolveOciStageFromCallStatus('won'), 'won');
  assert.equal(resolveOciStageFromCallStatus('confirmed'), 'won');
  assert.equal(resolveOciStageFromCallStatus('qualified'), 'won');
  assert.equal(resolveOciStageFromCallStatus('real'), 'won');
});

test('non-export statuses yield null', () => {
  assert.equal(resolveOciStageFromCallStatus('intent'), null);
  assert.equal(resolveOciStageFromCallStatus('cancelled'), null);
  assert.equal(resolveOciStageFromCallStatus(null), null);
});
