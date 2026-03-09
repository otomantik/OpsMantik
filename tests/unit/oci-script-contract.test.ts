import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CANONICAL_SCRIPT = join(ROOT, 'scripts', 'google-ads-oci', 'GoogleAdsScript.js');
const ESLAMED_SCRIPT = join(ROOT, 'scripts', 'google-ads', 'eslamed-oci-script.js');
const MURATCAN_SCRIPT = join(ROOT, 'scripts', 'google-ads', 'muratcan-aku-oci-script.js');

test('canonical OCI script accepts legacy env keys and refreshes expired session tokens', () => {
  const src = readFileSync(CANONICAL_SCRIPT, 'utf8');
  assert.ok(src.includes("['OPSMANTIK_API_KEY', 'OCI_API_KEY']"), 'canonical script must accept legacy API key env names');
  assert.ok(src.includes("['OPSMANTIK_SITE_ID', 'OCI_SITE_ID']"), 'canonical script must accept legacy site id env names');
  assert.ok(src.includes('_fetchWithSessionRetry'), 'canonical script must retry authenticated calls with renewed session token');
  assert.ok(src.includes('Session token expired, renewing handshake and retrying once'), 'canonical script must log one-shot session renewal');
});

test('OCI scripts accept and normalize compact Google Ads timezone offsets', () => {
  const canonicalSrc = readFileSync(CANONICAL_SCRIPT, 'utf8');
  const eslamedSrc = readFileSync(ESLAMED_SCRIPT, 'utf8');
  const muratcanSrc = readFileSync(MURATCAN_SCRIPT, 'utf8');
  for (const src of [canonicalSrc, eslamedSrc, muratcanSrc]) {
    assert.ok(src.includes('[+-]\\\\d{2}:?\\\\d{2}$') || src.includes('[+-]\\d{2}:?\\d{2}$'), 'script must accept both +0300 and +03:00 offsets');
    assert.ok(src.includes("replace(/([+-]\\d{2}):(\\d{2})$/, '$1$2')"), 'script must normalize legacy colon offsets before CSV upload');
    assert.ok(src.includes("'Conversion time': Validator.normalizeGoogleAdsTime(row.conversionTime)"), 'script must upload normalized conversion time');
  }
});

test('site OCI snapshots stay on the same verify/export/ack auth contract', () => {
  const eslamedSrc = readFileSync(ESLAMED_SCRIPT, 'utf8');
  const muratcanSrc = readFileSync(MURATCAN_SCRIPT, 'utf8');
  for (const src of [eslamedSrc, muratcanSrc]) {
    assert.ok(src.includes("/api/oci/v2/verify"), 'site script must handshake via verify route');
    assert.ok(src.includes("/api/oci/google-ads-export?siteId="), 'site script must export via canonical route');
    assert.ok(src.includes("/api/oci/ack"), 'site script must ACK via canonical route');
    assert.ok(src.includes("/api/oci/ack-failed"), 'site script must NACK via canonical route');
    assert.ok(src.includes('_fetchWithSessionRetry'), 'site script must reuse bearer session refresh path');
    assert.ok(src.includes("'Order ID'"), 'site script must include Order ID for dedupe-safe uploads');
  }
});
