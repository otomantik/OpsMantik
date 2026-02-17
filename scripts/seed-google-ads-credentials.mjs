/**
 * Google Ads credential'larini provider_credentials tablosuna yazar (vault ile sifreli).
 * Dev server gerekmez; .env.local yuklenir.
 * Kullanim: node scripts/seed-google-ads-credentials.mjs
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

// .env.local yukle (proje kokunden)
config({ path: resolve(process.cwd(), '.env.local') });

const SITE_ID = 'e47f36f6-c277-4879-b2dc-07914a0632c2';
const PROVIDER_KEY = 'google_ads';

const credentials = {
  customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID || '525-429-9323',
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || 'hlw_ulOQ8RpqwulGcm_Snw',
  client_id: process.env.GOOGLE_ADS_CLIENT_ID,
  client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
  refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
  login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '854-075-5158',
  conversion_action_resource_name: 'customers/5254299323/conversionActions/123456789',
};

if (!credentials.client_id || !credentials.client_secret || !credentials.refresh_token) {
  console.error('Hata: .env.local icinde GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN gerekli.');
  process.exit(1);
}

const vaultKey = process.env.OPSMANTIK_VAULT_KEY;
if (!vaultKey) {
  console.error('Hata: .env.local icinde OPSMANTIK_VAULT_KEY gerekli (32 byte base64).');
  process.exit(1);
}

// Vault sifreleme (vault.ts ile ayni mantik - tweetnacl-sealed-box)
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const nacl = require(join(__dirname, '..', 'node_modules', 'tweetnacl-sealed-box', 'nacl-fast.js'));
const SEED_LENGTH = 32;
const NONCE_LENGTH = 24;
const PUBLICKEY_LENGTH = 32;

function getKeypair() {
  const seed = Buffer.from(vaultKey, 'base64');
  if (seed.length !== SEED_LENGTH) {
    throw new Error(`OPSMANTIK_VAULT_KEY ${SEED_LENGTH} byte base64 olmali.`);
  }
  return nacl.default.box.keyPair.fromSecretKey(new Uint8Array(seed));
}

function sealedBoxNonce(ephemeralPk, recipientPk) {
  const h = nacl.default.hash(new Uint8Array([...ephemeralPk, ...recipientPk]));
  return h.slice(0, NONCE_LENGTH);
}

async function encryptJson(obj) {
  const { publicKey } = getKeypair();
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ekp = nacl.default.box.keyPair();
  const nonce = sealedBoxNonce(ekp.publicKey, publicKey);
  const box = nacl.default.box(
    new Uint8Array(plaintext),
    nonce,
    publicKey,
    ekp.secretKey
  );
  const sealed = new Uint8Array(ekp.publicKey.length + box.length);
  sealed.set(ekp.publicKey, 0);
  sealed.set(box, ekp.publicKey.length);
  const key_fingerprint = Buffer.from(publicKey.slice(0, 8)).toString('hex');
  return {
    ciphertext: Buffer.from(sealed).toString('base64'),
    key_fingerprint,
  };
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error('Hata: NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY .env.local icinde gerekli.');
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

try {
  const { ciphertext, key_fingerprint } = await encryptJson(credentials);
  const { error } = await supabase
    .from('provider_credentials')
    .upsert(
      {
        site_id: SITE_ID,
        provider_key: PROVIDER_KEY,
        encrypted_payload: ciphertext,
        key_fingerprint,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'site_id,provider_key' }
    );

  if (error) {
    console.error('Supabase hata:', error.message);
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, site_id: SITE_ID, provider_key: PROVIDER_KEY }));
} catch (err) {
  console.error('Hata:', err.message || err);
  process.exit(1);
}
