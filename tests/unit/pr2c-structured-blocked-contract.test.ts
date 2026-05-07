import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('PR-2C: enqueueOciConversionRow inserts structured FAILED row on missing consent', () => {
  const src = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-oci-conversion-row.ts'), 'utf8');
  assert.ok(src.includes("rowStatus = 'FAILED'"), 'must map to FAILED');
  assert.ok(src.includes("providerErrorCategory = 'DETERMINISTIC_SKIP'"), 'must set DETERMINISTIC_SKIP category');
  assert.ok(src.includes("providerErrorCode = 'CONSENT_MISSING'"), 'must set CONSENT_MISSING code');
  assert.ok(src.includes('provider_error_category: providerErrorCategory'), 'must insert category');
  assert.ok(src.includes('provider_error_code: providerErrorCode'), 'must insert code');
});

test('PR-2C: enqueueSealConversion inserts structured FAILED row on missing consent', () => {
  const src = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  assert.ok(src.includes("rowStatus = 'FAILED'"), 'must map to FAILED');
  assert.ok(src.includes("providerErrorCategory = 'DETERMINISTIC_SKIP'"), 'must set DETERMINISTIC_SKIP category');
  assert.ok(src.includes("providerErrorCode = 'CONSENT_MISSING'"), 'must set CONSENT_MISSING code');
});

test('PR-2C: idempotency is maintained for structured blocked rows', () => {
  const ociSrc = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-oci-conversion-row.ts'), 'utf8');
  const sealSrc = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  
  // They compute external_id BEFORE branching on hasMarketing, ensuring idempotency
  const extIdIdxOci = ociSrc.indexOf('computeOfflineConversionExternalId');
  const insertIdxOci = ociSrc.indexOf(".insert(insertPayload)");
  const consentIdxOci = ociSrc.indexOf("rowStatus = 'FAILED'");
  
  assert.ok(extIdIdxOci < insertIdxOci, 'external_id must be computed before insert');
  
  // Both files still handle 23505 (unique violation)
  assert.ok(ociSrc.includes("code === '23505'"), 'oci enqueue handles duplicate');
  assert.ok(sealSrc.includes("error.code === '23505'"), 'seal enqueue handles duplicate');
});

test('PR-2C: export-fetch excludes FAILED + DETERMINISTIC_SKIP rows', () => {
  const fetchSrc = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts'), 'utf8');
  // It only selects QUEUED and RETRY, thereby excluding FAILED.
  assert.ok(fetchSrc.includes(".in('status', ['QUEUED', 'RETRY'])"), 'must only fetch exportable rows');
});

test('PR-2C: queue_health explicitly excludes DETERMINISTIC_SKIP from actionable_failed_rate', () => {
  const sqlSrc = readFileSync(join(ROOT, 'scripts', 'sql', 'queue_health.sql'), 'utf8');
  assert.ok(
    sqlSrc.includes("COALESCE(ft.total_failed_count, 0) - COALESCE(ft.deterministic_skip_count, 0)"),
    'queue health must exclude DETERMINISTIC_SKIP via arithmetic subtraction from actionable rate'
  );
  assert.ok(
    sqlSrc.includes("provider_error_category = 'DETERMINISTIC_SKIP'"),
    'queue health must aggregate deterministic skip count for visibility'
  );
});

test('PR-2C: four-stage coverage logic exists in the helpers', () => {
  const ociSrc = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-oci-conversion-row.ts'), 'utf8');
  const sealSrc = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  
  // enqueue-oci covers contacted, offered, junk
  assert.ok(ociSrc.includes('Exclude<PipelineStage, \'won\'>'), 'oci covers micro stages');
  assert.ok(ociSrc.includes('OPSMANTIK_CONVERSION_NAMES[stage]'), 'dynamic conversion name');
  
  // enqueue-seal covers won
  assert.ok(sealSrc.includes('OPSMANTIK_CONVERSION_NAMES.won'), 'seal covers won');
});
