import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import { evaluateOciAckSignaturePolicy } from '@/lib/security/oci-ack-signature-policy';

/**
 * Helper to generate a valid HMAC signature for testing.
 */
function makeValidHmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

test('required mode rejects unsigned requests', async () => {
  const decision = await evaluateOciAckSignaturePolicy({
    signatureHeader: null,
    payload: '{}',
    secret: 'test-secret',
    requireSignatureEnv: 'true',
  });
  assert.strictEqual(decision.ok, false);
  assert.strictEqual(decision.status, 401);
  assert.strictEqual(decision.signature_required, true);
});

test('required mode rejects bad signature', async () => {
  const decision = await evaluateOciAckSignaturePolicy({
    signatureHeader: 'bad-signature',
    payload: '{"test":true}',
    secret: 'test-secret',
    requireSignatureEnv: 'true',
  });
  assert.strictEqual(decision.ok, false);
  assert.strictEqual(decision.status, 401);
  assert.strictEqual(decision.code, 'AUTH_FAILED');
});

test('required mode accepts valid HMAC signatures', async () => {
  const payload = JSON.stringify({ ok: true });
  const secret = 'super-secret-key';
  const signature = makeValidHmac(payload, secret);

  const decision = await evaluateOciAckSignaturePolicy({
    signatureHeader: signature,
    payload,
    secret,
    requireSignatureEnv: 'true',
  });
  assert.strictEqual(decision.ok, true);
  assert.strictEqual(decision.status, 200);
  assert.strictEqual(decision.signature_required, true);
});

test('compat mode preserves unsigned API-key path', async () => {
  const decision = await evaluateOciAckSignaturePolicy({
    signatureHeader: null,
    payload: '{}',
    secret: 'test-secret',
    requireSignatureEnv: 'false',
  });
  assert.strictEqual(decision.ok, true);
  assert.strictEqual(decision.status, 200);
  assert.strictEqual(decision.signature_required, false);
});

test('compat mode still rejects bad signature when provided', async () => {
  const decision = await evaluateOciAckSignaturePolicy({
    signatureHeader: 'bad-signature',
    payload: '{}',
    secret: 'test-secret',
    requireSignatureEnv: 'false',
  });
  assert.strictEqual(decision.ok, false);
  assert.strictEqual(decision.status, 401);
  assert.strictEqual(decision.signature_required, false);
});
