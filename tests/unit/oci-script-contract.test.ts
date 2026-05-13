import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CANONICAL_SCRIPT = join(ROOT, 'scripts', 'google-ads-oci', 'GoogleAdsScriptUniversal.js');
const LEGACY_PER_SITE_SCRIPTS = [
  join(ROOT, 'scripts', 'google-ads', 'eslamed-oci-script.js'),
  join(ROOT, 'scripts', 'google-ads', 'muratcan-aku-oci-script.js'),
  join(ROOT, 'scripts', 'google-ads', 'gecgenotokurtarici-oci-script.js'),
];

test('Universal OCI script renews session on 401 via handshake retry', () => {
  const src = readFileSync(CANONICAL_SCRIPT, 'utf8');
  assert.ok(src.includes('HTTP 401'), 'must detect 401 for session renewal');
  assert.ok(src.includes('this.handshake(this.siteId)'), 'must renew via handshake');
  assert.ok(src.includes('Token expired, renewing'), 'must log renewal');
});

test('Universal OCI script normalizes compact Google Ads timezone offsets before CSV upload', () => {
  const src = readFileSync(CANONICAL_SCRIPT, 'utf8');
  assert.ok(src.includes('[+-]\\d{2}:?\\d{2}$') || src.includes('[+-]\\\\d{2}:?\\\\d{2}$'), 'must accept +0300 / +03:00 style offsets');
  assert.ok(src.includes("replace(/([+-]\\d{2}):(\\d{2})$/, '$1$2')"), 'must normalize colon offsets');
  assert.ok(src.includes("normalizeTime(row.conversionTime)"), 'must normalize conversion time for CSV');
});

test('Universal OCI script pages export via fetchPage + nextCursor / hasNextPage', () => {
  const src = readFileSync(CANONICAL_SCRIPT, 'utf8');
  assert.ok(src.includes('&limit='), 'export fetch must pass limit query param');
  assert.ok(src.includes('nextCursor') && src.includes('hasNextPage'), 'must surface pagination meta');
  assert.ok(src.includes('while (pageNo < cfg.MAX_PAGES)'), 'must iterate pages with bounded loop');
});

test('Universal OCI script success ACK is dispatch-pending only (no payload.results)', () => {
  const src = readFileSync(CANONICAL_SCRIPT, 'utf8');
  assert.ok(!src.includes('payload.results'), 'success ACK must not embed granular results (use /ack-failed for failures)');
  assert.ok(src.includes('pendingConfirmation: true'), 'dispatch-pending flag required');
  assert.ok(src.includes("'bulk_upload_async_unconfirmed'"), 'providerConfirmationMode required');
});

test('Universal OCI script uses the four canonical English conversion names', () => {
  const src = readFileSync(CANONICAL_SCRIPT, 'utf8');
  assert.ok(src.includes('OpsMantik_Contacted'), 'contacted');
  assert.ok(src.includes('OpsMantik_Offered'), 'offered');
  assert.ok(src.includes('OpsMantik_Won'), 'won');
  assert.ok(src.includes('OpsMantik_Junk_Exclusion'), 'junk exclusion');
  assert.ok(!src.includes('OpsMantik_Gorusuldu'), 'legacy Turkish Gorusuldu removed');
  assert.ok(!src.includes('OpsMantik_Teklif'), 'legacy Turkish Teklif removed');
  assert.ok(!src.includes('OpsMantik_Satis'), 'legacy Turkish Satis removed');
  assert.ok(!src.includes('OpsMantik_Cop_Exclusion'), 'legacy Turkish Cop_Exclusion removed');
  assert.ok(!src.includes('OpsMantik_V1_'), 'legacy V1 action names removed');
  assert.ok(!src.includes('OpsMantik_V2_'), 'legacy V2 action names removed');
  assert.ok(!src.includes('OpsMantik_V3_'), 'legacy V3 action names removed');
  assert.ok(!src.includes('OpsMantik_V4_'), 'legacy V4 action names removed');
  assert.ok(!src.includes('OpsMantik_V5_'), 'legacy V5 action names removed');
});

test('legacy per-site OCI script snapshots stay deleted post-cutover', () => {
  for (const legacyPath of LEGACY_PER_SITE_SCRIPTS) {
    assert.ok(!existsSync(legacyPath), `legacy per-site script must stay deleted: ${legacyPath}`);
  }
});
