import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CANONICAL_SCRIPT = join(ROOT, 'scripts', 'google-ads-oci', 'GoogleAdsScript.js');
const LEGACY_PER_SITE_SCRIPTS = [
  join(ROOT, 'scripts', 'google-ads', 'eslamed-oci-script.js'),
  join(ROOT, 'scripts', 'google-ads', 'muratcan-aku-oci-script.js'),
  join(ROOT, 'scripts', 'google-ads', 'gecgenotokurtarici-oci-script.js'),
];

test('canonical OCI script accepts legacy env keys and refreshes expired session tokens', () => {
  const src = readFileSync(CANONICAL_SCRIPT, 'utf8');
  assert.ok(src.includes("['OPSMANTIK_API_KEY', 'OCI_API_KEY']"), 'canonical script must accept legacy API key env names');
  assert.ok(src.includes("['OPSMANTIK_SITE_ID', 'OCI_SITE_ID']"), 'canonical script must accept legacy site id env names');
  assert.ok(src.includes('_fetchWithSessionRetry'), 'canonical script must retry authenticated calls with renewed session token');
  assert.ok(src.includes('Session token expired, renewing handshake and retrying once'), 'canonical script must log one-shot session renewal');
});

test('canonical OCI script accepts and normalizes compact Google Ads timezone offsets', () => {
  const src = readFileSync(CANONICAL_SCRIPT, 'utf8');
  assert.ok(src.includes('[+-]\\\\d{2}:?\\\\d{2}$') || src.includes('[+-]\\d{2}:?\\d{2}$'), 'script must accept both +0300 and +03:00 offsets');
  assert.ok(src.includes("replace(/([+-]\\d{2}):(\\d{2})$/, '$1$2')"), 'script must normalize legacy colon offsets before CSV upload');
  assert.ok(src.includes("'Conversion time': Validator.normalizeGoogleAdsTime(row.conversionTime)"), 'script must upload normalized conversion time');
});

test('canonical OCI script uses the universal English action names only', () => {
  const src = readFileSync(CANONICAL_SCRIPT, 'utf8');
  assert.ok(src.includes("OpsMantik_Contacted"), 'script must include contacted action');
  assert.ok(src.includes("OpsMantik_Offered"), 'script must include offered action');
  assert.ok(src.includes("OpsMantik_Won"), 'script must include won action');
  assert.ok(src.includes("OpsMantik_Junk_Exclusion"), 'script must include junk exclusion action');
  assert.ok(!src.includes('OpsMantik_Gorusuldu'), 'legacy Turkish Gorusuldu action must be removed');
  assert.ok(!src.includes('OpsMantik_Teklif'), 'legacy Turkish Teklif action must be removed');
  assert.ok(!src.includes('OpsMantik_Satis'), 'legacy Turkish Satis action must be removed');
  assert.ok(!src.includes('OpsMantik_Cop_Exclusion'), 'legacy Turkish Cop_Exclusion action must be removed');
  assert.ok(!src.includes('OpsMantik_V1_'), 'legacy V1 action names must be removed');
  assert.ok(!src.includes('OpsMantik_V2_'), 'legacy V2 action names must be removed');
  assert.ok(!src.includes('OpsMantik_V3_'), 'legacy V3 action names must be removed');
  assert.ok(!src.includes('OpsMantik_V4_'), 'legacy V4 action names must be removed');
  assert.ok(!src.includes('OpsMantik_V5_'), 'legacy V5 action names must be removed');
});

test('legacy per-site OCI script snapshots stay deleted post-cutover', () => {
  for (const legacyPath of LEGACY_PER_SITE_SCRIPTS) {
    assert.ok(
      !existsSync(legacyPath),
      `legacy per-site script must stay deleted (leaked secrets risk): ${legacyPath}`
    );
  }
});
