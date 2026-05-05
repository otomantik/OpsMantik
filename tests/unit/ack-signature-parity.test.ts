import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as jose from 'jose';
import { evaluateOciAckSignaturePolicy } from '@/lib/security/oci-ack-signature-policy';

const ROOT = process.cwd();

async function makeValidSignature(): Promise<{ token: string; publicKeyB64: string }> {
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const spki = await jose.exportSPKI(publicKey);
  const token = await new jose.SignJWT({ sub: 'oci-script' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('opsmantik-oci-script')
    .setAudience('opsmantik-api')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  return {
    token,
    publicKeyB64: Buffer.from(spki, 'utf8').toString('base64'),
  };
}

test('ack and ack-failed routes both use shared signature policy helper', () => {
  const ackSrc = readFileSync(join(ROOT, 'app', 'api', 'oci', 'ack', 'route.ts'), 'utf8');
  const ackFailedSrc = readFileSync(join(ROOT, 'app', 'api', 'oci', 'ack-failed', 'route.ts'), 'utf8');
  assert.ok(ackSrc.includes('evaluateOciAckSignaturePolicy'), 'ack route must use shared signature policy');
  assert.ok(ackFailedSrc.includes('evaluateOciAckSignaturePolicy'), 'ack-failed route must use shared signature policy');
});

test('required mode rejects unsigned requests for both ACK and ACK_FAILED', async () => {
  const decision = await evaluateOciAckSignaturePolicy({
    signatureHeader: null,
    voidPublicKeyB64: 'ZHVtbXk=',
    requireSignatureEnv: 'true',
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.signature_required, true);
});

test('required mode rejects bad signature for both ACK and ACK_FAILED', async () => {
  const decision = await evaluateOciAckSignaturePolicy({
    signatureHeader: 'bad.signature.token',
    voidPublicKeyB64: 'ZHVtbXk=',
    requireSignatureEnv: 'true',
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.code, 'AUTH_FAILED');
});

test('required mode accepts valid signed requests for both ACK and ACK_FAILED', async () => {
  const { token, publicKeyB64 } = await makeValidSignature();
  const decision = await evaluateOciAckSignaturePolicy({
    signatureHeader: token,
    voidPublicKeyB64: publicKeyB64,
    requireSignatureEnv: 'true',
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.status, 200);
  assert.equal(decision.signature_required, true);
});

test('compat mode preserves unsigned API-key path', async () => {
  const decision = await evaluateOciAckSignaturePolicy({
    signatureHeader: null,
    voidPublicKeyB64: 'ZHVtbXk=',
    requireSignatureEnv: 'false',
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.status, 200);
  assert.equal(decision.signature_required, false);
});

test('compat mode still rejects bad signature when provided', async () => {
  const decision = await evaluateOciAckSignaturePolicy({
    signatureHeader: 'bad.signature.token',
    voidPublicKeyB64: 'ZHVtbXk=',
    requireSignatureEnv: 'false',
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.signature_required, false);
});
