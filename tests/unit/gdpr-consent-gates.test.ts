/**
 * GDPR Consent gates: fail-closed, no bypass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SYNC_ROUTE = join(process.cwd(), 'app', 'api', 'sync', 'route.ts');
const ENQUEUE_SEAL = join(process.cwd(), 'lib', 'oci', 'enqueue-seal-conversion.ts');
const PIPELINE = join(process.cwd(), 'lib', 'services', 'pipeline-service.ts');

test('validateSite before consentScopes, consentScopes before tryInsert', () => {
  const src = readFileSync(SYNC_ROUTE, 'utf8');
  const validateSiteIdx = src.indexOf('validateSiteFn');
  const consentIdx = src.indexOf('consentScopes');
  const tryInsertIdx = src.indexOf('tryInsert(siteIdUuid');
  assert.ok(validateSiteIdx !== -1, 'validateSite must exist');
  assert.ok(consentIdx !== -1, 'consent check must exist');
  assert.ok(tryInsertIdx !== -1, 'tryInsert must exist');
  assert.ok(validateSiteIdx < consentIdx, 'validateSite must run before consent');
  assert.ok(consentIdx < tryInsertIdx, 'consent must run before idempotency');
});

test('Site invalid returns 400, consent missing returns 204 only when site valid', () => {
  const src = readFileSync(SYNC_ROUTE, 'utf8');
  assert.ok(src.includes("'site_not_found'"), 'site invalid must return 400');
  assert.ok(src.includes("'x-opsmantik-consent-missing'"), 'consent-missing header must exist');
  const _siteInvalid400 = src.indexOf("site_not_found");
  void _siteInvalid400;
  const consent204 = src.indexOf("'x-opsmantik-consent-missing'");
  const validateSite = src.indexOf('validateSiteFn');
  assert.ok(validateSite < consent204, 'validateSite must run before consent 204 (204 only when site valid)');
});

test('OCI enqueue checks marketing consent', () => {
  const enqueueSrc = readFileSync(ENQUEUE_SEAL, 'utf8');
  const pipelineSrc = readFileSync(PIPELINE, 'utf8');
  assert.ok(enqueueSrc.includes('hasMarketingConsentForCall'), 'enqueueSealConversion must check marketing consent');
  assert.ok(pipelineSrc.includes('hasMarketingConsentForCall'), 'PipelineService must check marketing consent');
});

test('Erase RPC does not touch partition keys', () => {
  const src = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20260226000002_erase_pii_rpc.sql'), 'utf8');
  assert.ok(!src.includes('created_month'), 'erase must not modify created_month (partition key)');
  assert.ok(!src.includes('session_month'), 'erase must not modify session_month (partition key)');
});
