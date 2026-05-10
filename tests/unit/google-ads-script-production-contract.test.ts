import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function productionSrc(): string {
  return readFileSync(join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScriptProduction.js'), 'utf8');
}

test('PR-9H.7B: hashed-phone CSV sync is fail-closed without full server canary bundle', () => {
  const src = productionSrc();
  assert.match(src, /validateHashedPhoneCsvCanaryForSync/);
  assert.match(src, /HASHED_PHONE_CANARY_ABORTED_UNSAFE_SCOPE/);
  assert.match(src, /OPSMANTIK_HASHED_PHONE_CSV_CANARY_MODE/);
  assert.match(src, /OPSMANTIK_EXPORT_ALLOWLIST_IDS/);
  assert.match(src, /OPSMANTIK_CANARY_EXPECTED_QUEUE_ID/);
  assert.match(src, /OPSMANTIK_CANARY_APPROVAL/);
  assert.match(src, /RESOLVED_HP_CANARY_QUEUE_ID/);
  assert.match(src, /allowlist_ids=/);
  assert.match(src, /x-opsmantik-canary-approval/);
  assert.match(src, /I_APPROVE_PRODUCTION_CANARY/);
});

test('PR-9H.7B: CSV canary classification labels documented in script constants', () => {
  const src = productionSrc();
  assert.match(src, /HASHED_PHONE_CSV_CANARY_GREEN/);
  assert.match(src, /HASHED_PHONE_CSV_COLUMN_REJECTED/);
  assert.match(src, /HASHED_PHONE_EXPORT_MISSING/);
  assert.match(src, /HASHED_PHONE_UPLOAD_SUCCEEDED_ACK_PENDING/);
  assert.match(src, /HASHED_PHONE_CANARY_PROVIDER_ERROR/);
});

test('GoogleAdsScriptProduction.js: hashed phone courier + gated CSV upload contract (PR-9H.7A)', () => {
  const src = productionSrc();
  assert.match(src, /hashedPhoneNumber/);
  assert.match(src, /extractVerifiedHashedPhoneCourier/);
  assert.match(src, /hasHashedPhoneNumber:/);
  assert.match(src, /OPSMANTIK_INCLUDE_HASHED_PHONE_IN_UPLOAD/);
  assert.match(src, /HASHED_PHONE_COLUMN_NOT_CONFIGURED/);
  assert.match(src, /HASHED_PHONE_UPLOAD_COLUMN/);
  assert.doesNotMatch(src, /createHash\s*\(/);
  assert.doesNotMatch(src, /\bdigest\s*\(\s*['"]hex['"]\s*\)/);
  assert.doesNotMatch(src, /\bsha256\b.*\bcrypto\b/i);
});

test('INCLUDE_HASHED_PHONE_IN_UPLOAD parses from Script Properties (^true$/i)', () => {
  const src = productionSrc();
  assert.match(src, /INCLUDE_HASHED_PHONE_IN_UPLOAD:\s*\/\^true\$\/i\.test\(String\(includeHpRaw/);
});

test('GCLID-only CSV: legacy six-column template when hashed phone disabled (no extra column injection)', () => {
  const src = productionSrc();
  assert.match(src, /var baseHeaders\s*=\s*\[/);
  assert.match(src, /'Order ID'/);
  assert.match(src, /'Conversion currency'/);
  assert.match(src, /if\s*\(\s*includeHp\s*\)\s*\{/);
  assert.match(src, /headers\.push\(hpColName\)/);
});

test('GoogleAdsScriptProduction: documents gclid-first v1 and classifies non-gclid rows', () => {
  const src = productionSrc();
  assert.match(src, /gclid only/i);
  assert.match(src, /wbraid|gbraid/i);
  assert.doesNotMatch(src, /console\.log\([^)]*gclid/i);
});

test('PEEK courier: hashed phone telemetry is boolean-only (never logs hash literals)', () => {
  const src = productionSrc();
  assert.ok(!/\bTelemetry\.(?:info|warn)\([^)]*hashedPhoneNumber/i.test(src), 'avoid logging hashedPhoneNumber payloads');
});
