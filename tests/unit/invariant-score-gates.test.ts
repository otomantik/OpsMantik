import assert from 'node:assert/strict';
import test from 'node:test';
import { assertWorkConservation, isWorkConserved } from '@/lib/oci/conservation';
import { isNoWorkProof } from '@/lib/oci/deterministic-scheduler';
import { assertLaneActive } from '@/lib/oci/kill-switch';

test('score gate: conservation equation holds', () => {
  const counters = {
    accepted: 10,
    progressed: 4,
    quarantined: 1,
    terminal: 4,
    rejected: 1,
  };
  assert.equal(isWorkConserved(counters), true);
  assert.doesNotThrow(() => assertWorkConservation(counters));
});

test('score gate: no-idle proof emits deterministic no-work marker', () => {
  assert.equal(isNoWorkProof(0, 20), true);
  assert.equal(isNoWorkProof(1, 20), false);
});

test('score gate: kill-switch defaults to active lanes', () => {
  const result = assertLaneActive('OCI_ACK');
  assert.equal(result.ok, true);
});
