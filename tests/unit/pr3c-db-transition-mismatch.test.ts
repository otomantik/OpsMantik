import test from 'node:test';
import assert from 'node:assert';
import { verifyTransitionCount } from '@/lib/oci/oci-ack-route-helpers';

test('PR-3C DB Transition Mismatch: ACK route returns success when expected_count == transitioned_count', () => {
  const result = verifyTransitionCount({
    expectedCount: 5,
    transitionedCount: 5,
    alreadyTerminalCount: 0,
    exportRunId: 'run-123',
    route: 'ack'
  });
  assert.strictEqual(result.ok, true);
});

test('PR-3C DB Transition Mismatch: ACK route emits DB_TRANSITION_MISMATCH when transitioned_count < expected_count', () => {
  const result = verifyTransitionCount({
    expectedCount: 5,
    transitionedCount: 3,
    alreadyTerminalCount: 0,
    exportRunId: 'run-123',
    route: 'ack'
  });
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.strictEqual(result.isReplay, false);
    assert.strictEqual(result.payload.reason, 'DB_TRANSITION_MISMATCH');
    assert.strictEqual(result.payload.mismatch_count, 2);
    assert.strictEqual(result.payload.export_run_id, 'run-123');
  }
});

test('PR-3C DB Transition Mismatch: duplicate ACK replay behavior is deterministic (already terminal matches expected)', () => {
  const result = verifyTransitionCount({
    expectedCount: 5,
    transitionedCount: 0,
    alreadyTerminalCount: 5,
    exportRunId: 'run-123',
    route: 'ack'
  });
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.strictEqual(result.isReplay, true);
    assert.strictEqual(result.payload.reason, 'ACK_REPLAY_ALREADY_TERMINAL');
  }
});

test('PR-3C DB Transition Mismatch: ACK_FAILED duplicate replay behavior is deterministic', () => {
  const result = verifyTransitionCount({
    expectedCount: 2,
    transitionedCount: 0,
    alreadyTerminalCount: 2,
    exportRunId: 'run-123',
    route: 'ack_failed'
  });
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.strictEqual(result.isReplay, true);
    assert.strictEqual(result.payload.reason, 'ACK_FAILED_REPLAY_ALREADY_TERMINAL');
  }
});

test('PR-3C DB Transition Mismatch: missing export_run_id does not hard fail', () => {
  const result = verifyTransitionCount({
    expectedCount: 3,
    transitionedCount: 2,
    alreadyTerminalCount: 0,
    exportRunId: undefined,
    route: 'ack'
  });
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.strictEqual(result.payload.export_run_id, undefined);
    assert.strictEqual(result.payload.reason, 'DB_TRANSITION_MISMATCH');
  }
});
