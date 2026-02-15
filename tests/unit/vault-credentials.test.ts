/**
 * PR-G1: Vault and credentials API tests.
 * - Vault roundtrip (encryptJson/decryptJson) when OPSMANTIK_VAULT_KEY is set.
 * - Credentials route: auth and validateSiteAccess (403 for non-member by contract).
 * - encrypted_payload never returned in API response.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 32-byte seed for sealed box keypair (must be set before first vault use)
const TEST_SEED_B64 = Buffer.alloc(32, 0x01).toString('base64');

test('vault roundtrip: encryptJson then decryptJson returns same object', async () => {
  const vault = await import('@/lib/security/vault');
  vault._resetKeypairForTest();
  const orig = process.env.OPSMANTIK_VAULT_KEY;
  process.env.OPSMANTIK_VAULT_KEY = TEST_SEED_B64;
  const { encryptJson, decryptJson } = vault;
  try {
    const obj = { customer_id: '123', refresh_token: 'secret' };
    const { ciphertext, key_fingerprint } = await encryptJson(obj);
    assert.ok(typeof ciphertext === 'string' && ciphertext.length > 0);
    assert.ok(typeof key_fingerprint === 'string' && key_fingerprint.length > 0);
    const decrypted = await decryptJson(ciphertext);
    assert.deepEqual(decrypted, obj);
  } finally {
    if (orig !== undefined) process.env.OPSMANTIK_VAULT_KEY = orig;
    else delete process.env.OPSMANTIK_VAULT_KEY;
  }
});

test('vault: encryptJson throws when OPSMANTIK_VAULT_KEY is missing', async () => {
  const vault = await import('@/lib/security/vault');
  vault._resetKeypairForTest();
  const orig = process.env.OPSMANTIK_VAULT_KEY;
  delete process.env.OPSMANTIK_VAULT_KEY;
  try {
    await assert.rejects(
      () => vault.encryptJson({ a: 1 }),
      { message: /OPSMANTIK_VAULT_KEY/ }
    );
  } finally {
    if (orig !== undefined) process.env.OPSMANTIK_VAULT_KEY = orig;
  }
});

test('credentials route: uses validateSiteAccess and returns 403 when denied', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'providers', 'credentials', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('validateSiteAccess'), 'route validates site access');
  assert.ok(src.includes('!access.allowed') && src.includes('403'), 'route returns 403 when access denied');
});

test('credentials route: success response is { ok: true } only; no response body includes encrypted_payload', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'providers', 'credentials', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('{ ok: true }'), 'success response is only { ok: true }');
  assert.ok(!/NextResponse\.json\s*\([^)]*encrypted_payload/.test(src), 'no response body must include encrypted_payload');
});

test('credentials test route: uses validateSiteAccess', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'providers', 'credentials', 'test', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('validateSiteAccess'), 'test route validates site access');
  assert.ok(src.includes('adminClient') && src.includes('encrypted_payload'), 'test route fetches encrypted_payload server-side only');
});
