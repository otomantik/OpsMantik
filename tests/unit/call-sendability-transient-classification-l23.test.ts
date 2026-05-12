/**
 * L23 — Transient DB/PostgREST errors must NOT collapse into a deterministic
 * `status: null` decision; callers need to branch retry vs. fail-closed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isTransientCallSendabilityError } from '@/lib/oci/call-sendability-fetch';

test('L23: transient Postgres codes are classified retryable', () => {
  for (const code of ['40001', '40P01', '57014', '55P03', '08006'] as const) {
    assert.equal(
      isTransientCallSendabilityError({ code, message: 'simulated' }),
      true,
      `code ${code} must be transient`
    );
  }
});

test('L23: PostgREST 5xx and network-ish messages are transient', () => {
  assert.equal(isTransientCallSendabilityError({ code: 'PGRST503', message: 'unreachable' }), true);
  assert.equal(isTransientCallSendabilityError({ message: 'fetch failed: network unreachable' }), true);
  assert.equal(isTransientCallSendabilityError({ message: 'connection timeout' }), true);
});

test('L23: schema/permission errors are NOT transient (would loop forever)', () => {
  assert.equal(isTransientCallSendabilityError({ code: '42703', message: 'column does not exist' }), false);
  assert.equal(isTransientCallSendabilityError({ code: '42501', message: 'permission denied' }), false);
  assert.equal(isTransientCallSendabilityError(null), false);
  assert.equal(isTransientCallSendabilityError(undefined), false);
});
