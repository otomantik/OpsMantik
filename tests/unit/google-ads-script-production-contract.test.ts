import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function productionTemplateSrc(): string {
  return readFileSync(
    join(process.cwd(), 'tests', 'fixtures', 'google-ads-oci', 'PR9H7B_GOOGLE_ADS_SCRIPT_PRODUCTION_SNAPSHOT.js'),
    'utf8'
  );
}

function universalCanonicalSrc(): string {
  return readFileSync(join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScriptUniversal.js'), 'utf8');
}

test('PR-9H.7B (quarantined template): GoogleAdsScriptProduction.js retains hashed-phone CSV canary bundle strings', () => {
  const src = productionTemplateSrc();
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

test('PR-9H.7B (quarantined template): CSV canary classification labels in GoogleAdsScriptProduction.js', () => {
  const src = productionTemplateSrc();
  assert.match(src, /HASHED_PHONE_CSV_CANARY_GREEN/);
  assert.match(src, /HASHED_PHONE_CSV_COLUMN_REJECTED/);
  assert.match(src, /HASHED_PHONE_EXPORT_MISSING/);
  assert.match(src, /HASHED_PHONE_UPLOAD_SUCCEEDED_ACK_PENDING/);
  assert.match(src, /HASHED_PHONE_CANARY_PROVIDER_ERROR/);
});

test('GoogleAdsScriptProduction.js (quarantined): hashed phone courier-only — no client-side raw hash', () => {
  const src = productionTemplateSrc();
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

test('INCLUDE_HASHED_PHONE_IN_UPLOAD parses from Script Properties (^true$/i) in Production template', () => {
  const src = productionTemplateSrc();
  assert.match(src, /INCLUDE_HASHED_PHONE_IN_UPLOAD:\s*\/\^true\$\/i\.test\(String\(includeHpRaw/);
});

test('GCLID-only CSV: legacy six-column template when hashed phone disabled (Production template)', () => {
  const src = productionTemplateSrc();
  assert.match(src, /var baseHeaders\s*=\s*\[/);
  assert.match(src, /'Order ID'/);
  assert.match(src, /'Conversion currency'/);
  assert.match(src, /if\s*\(\s*includeHp\s*\)\s*\{/);
  assert.match(src, /headers\.push\(hpColName\)/);
});

test('GoogleAdsScriptProduction (quarantined): documents gclid-first v1 and classifies non-gclid rows', () => {
  const src = productionTemplateSrc();
  assert.match(src, /gclid only/i);
  assert.match(src, /wbraid|gbraid/i);
  assert.doesNotMatch(src, /console\.log\([^)]*gclid/i);
});

test('PEEK courier (Production template): hashed phone telemetry is boolean-only (never logs hash literals)', () => {
  const src = productionTemplateSrc();
  assert.ok(!/\bTelemetry\.(?:info|warn)\([^)]*hashedPhoneNumber/i.test(src), 'avoid logging hashedPhoneNumber payloads');
});

test('GoogleAdsScriptUniversal.js (canonical): courier-only hashed phone — never client-side digest of raw phone', () => {
  const src = universalCanonicalSrc();
  assert.match(src, /extractHashedPhone/);
  assert.match(src, /Never hash in script/i);
  assert.doesNotMatch(src, /Utilities\.computeDigest|DigestAlgorithm/i);
  assert.doesNotMatch(src, /createHash\s*\(/);
});

test('GoogleAdsScriptUniversal.js (canonical): click-id priority gclid > wbraid > gbraid and one-column CSV mapping', () => {
  const src = universalCanonicalSrc();
  assert.match(src, /gclid\s*>\s*wbraid\s*>\s*gbraid/i);
  assert.match(src, /resolveClickId/);
  assert.match(src, /csvRow\['Google Click ID'\]/);
  assert.match(src, /csvRow\['WBRAID'\]/);
  assert.match(src, /csvRow\['GBRAID'\]/);
});
