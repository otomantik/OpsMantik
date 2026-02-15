/**
 * PR-G1: Vault — sealed-box encryption for provider credentials.
 * Uses OPSMANTIK_VAULT_KEY (base64 32-byte secret key) with tweetnacl-sealed-box (libsodium-compatible).
 * Server-only: never expose decrypted payload or private key.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nacl = require('tweetnacl-sealed-box');

const VAULT_KEY_ENV = 'OPSMANTIK_VAULT_KEY';
const SEED_LENGTH = 32;
const NONCE_LENGTH = 24;
const PUBLICKEY_LENGTH = 32;

let keypair: { publicKey: Uint8Array; secretKey: Uint8Array } | null = null;

/** Test-only: clear keypair cache so env change is respected. */
export function _resetKeypairForTest(): void {
  keypair = null;
}

function getKeypair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  if (keypair) return keypair;
  const keyB64 = process.env[VAULT_KEY_ENV];
  if (!keyB64 || typeof keyB64 !== 'string') {
    throw new Error('OPSMANTIK_VAULT_KEY is not set or invalid');
  }
  const seed = Buffer.from(keyB64, 'base64');
  if (seed.length !== SEED_LENGTH) {
    throw new Error(`OPSMANTIK_VAULT_KEY must decode to ${SEED_LENGTH} bytes`);
  }
  const kp = nacl.box.keyPair.fromSecretKey(new Uint8Array(seed));
  keypair = kp;
  return kp;
}

/** Libsodium-style nonce for sealed box: first 24 bytes of hash(epk || pk). */
function sealedBoxNonce(ephemeralPk: Uint8Array, recipientPk: Uint8Array): Uint8Array {
  const h = nacl.hash(new Uint8Array([...ephemeralPk, ...recipientPk]));
  return h.slice(0, NONCE_LENGTH);
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
  const { publicKey } = getKeypair();
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ekp = nacl.box.keyPair();
  const nonce = sealedBoxNonce(ekp.publicKey, publicKey);
  const box = nacl.box(
    new Uint8Array(plaintext),
    nonce,
    publicKey,
    ekp.secretKey
  );
  const sealed = new Uint8Array(ekp.publicKey.length + box.length);
  sealed.set(ekp.publicKey, 0);
  sealed.set(box, ekp.publicKey.length);
  const fingerprint = keyFingerprintFromPublicKey(publicKey);
  return {
    ciphertext: Buffer.from(sealed).toString('base64'),
    key_fingerprint: fingerprint,
  };
}

/**
 * Decrypt sealed-box ciphertext (base64) to object. Throws if tampered or wrong key.
 */
export async function decryptJson(ciphertextBase64: string): Promise<unknown> {
  const { publicKey, secretKey } = getKeypair();
  const sealed = new Uint8Array(Buffer.from(ciphertextBase64, 'base64'));
  if (sealed.length <= PUBLICKEY_LENGTH) throw new Error('Invalid sealed ciphertext');
  const epk = sealed.slice(0, PUBLICKEY_LENGTH);
  const box = sealed.slice(PUBLICKEY_LENGTH);
  const nonce = sealedBoxNonce(epk, publicKey);
  const plaintext = nacl.box.open(box, nonce, epk, secretKey);
  if (!plaintext) throw new Error('Decryption failed (wrong key or tampered)');
  const json = Buffer.from(plaintext).toString('utf8');
  return JSON.parse(json) as unknown;
}
