/**
 * PR-G1: Vault — sealed-box encryption for provider credentials.
 * Uses OPSMANTIK_VAULT_KEY (base64 32-byte seed) to derive keypair; libsodium crypto_box_seal.
 * Server-only: never expose decrypted payload or private key.
 */

import sodium from 'libsodium-wrappers';

const VAULT_KEY_ENV = 'OPSMANTIK_VAULT_KEY';
const SEED_LENGTH = 32;

let keypair: { publicKey: Uint8Array; privateKey: Uint8Array } | null = null;

/** Test-only: clear keypair cache so env change is respected. */
export function _resetKeypairForTest(): void {
  keypair = null;
}

async function getKeypair(): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  if (keypair) return keypair;
  await sodium.ready;
  const keyB64 = process.env[VAULT_KEY_ENV];
  if (!keyB64 || typeof keyB64 !== 'string') {
    throw new Error('OPSMANTIK_VAULT_KEY is not set or invalid');
  }
  const seed = sodium.from_base64(keyB64, sodium.base64_variants.ORIGINAL);
  if (seed.length !== SEED_LENGTH) {
    throw new Error(`OPSMANTIK_VAULT_KEY must decode to ${SEED_LENGTH} bytes`);
  }
  const kp = sodium.crypto_box_seed_keypair(seed);
  keypair = kp;
  return kp;
}

/**
 * Key fingerprint for storage/audit (first 16 hex chars of public key).
 */
export function keyFingerprintFromPublicKey(publicKey: Uint8Array): string {
  return Buffer.from(publicKey.slice(0, 8)).toString('hex');
}

export interface EncryptResult {
  ciphertext: string;
  key_fingerprint: string;
}

/**
 * Encrypt a JSON-serializable object with sealed box. Returns base64 ciphertext and fingerprint.
 */
export async function encryptJson(obj: unknown): Promise<EncryptResult> {
  const { publicKey } = await getKeypair();
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = sodium.crypto_box_seal(plaintext, publicKey);
  const fingerprint = keyFingerprintFromPublicKey(publicKey);
  return {
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    key_fingerprint: fingerprint,
  };
}

/**
 * Decrypt sealed-box ciphertext (base64) to object. Throws if tampered or wrong key.
 */
export async function decryptJson(ciphertextBase64: string): Promise<unknown> {
  const { publicKey, privateKey } = await getKeypair();
  const ciphertext = sodium.from_base64(ciphertextBase64, sodium.base64_variants.ORIGINAL);
  const plaintext = sodium.crypto_box_seal_open(ciphertext, publicKey, privateKey);
  const json = Buffer.from(plaintext).toString('utf8');
  return JSON.parse(json) as unknown;
}
