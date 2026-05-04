/**
 * GDPR Consent gates: fail-closed, no bypass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SYNC_ROUTE = join(process.cwd(), 'app', 'api', 'sync', 'route.ts');
const ENQUEUE_SEAL = join(process.cwd(), 'lib', 'oci', 'enqueue-seal-conversion.ts');
const STAGE_ROUTE = join(process.cwd(), 'app', 'api', 'calls', '[id]', 'stage', 'route.ts');
const GDPR_CONSENT_ROUTE = join(process.cwd(), 'app', 'api', 'gdpr', 'consent', 'route.ts');

test('validateSite before consent gate, consent gate before publish', () => {
  const src = readFileSync(SYNC_ROUTE, 'utf8');
  const validateSiteIdx = src.indexOf('validateSiteFn');
  const consentIdx = src.indexOf('singleConsentScopes') !== -1 ? src.indexOf('singleConsentScopes') : src.indexOf("'x-opsmantik-consent-missing'");
  const publishIdx = src.indexOf('doPublish') !== -1 ? src.indexOf('doPublish') : src.indexOf('publishToQStash');
  assert.ok(validateSiteIdx !== -1, 'validateSite must exist');
  assert.ok(consentIdx !== -1, 'consent check must exist');
  assert.ok(publishIdx !== -1, 'publish (doPublish or publishToQStash) must exist');
  assert.ok(validateSiteIdx < consentIdx, 'validateSite must run before consent');
  assert.ok(consentIdx < publishIdx, 'consent must run before publish');
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
  assert.ok(enqueueSrc.includes('hasMarketingConsentForCall'), 'enqueueSealConversion must check marketing consent');
});

test('legacy stage route is retired to prevent shadow OCI writes', () => {
  if (!existsSync(STAGE_ROUTE)) {
    assert.ok(true, 'calls/[id]/stage removed — cannot shadow OCI writes');
    return;
  }
  const src = readFileSync(STAGE_ROUTE, 'utf8');
  assert.ok(src.includes('PIPELINE_STAGE_ROUTE_RETIRED'), 'stage route must fail closed with a deterministic retirement code');
});

const ERASE_PII_MIGRATION = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260419180000_drop_ingest_fallback_buffer.sql'
);

test('Erase RPC does not touch partition keys', () => {
  const full = readFileSync(ERASE_PII_MIGRATION, 'utf8');
  const start = full.indexOf('CREATE OR REPLACE FUNCTION public.erase_pii_for_identifier');
  const end = full.indexOf('CREATE OR REPLACE FUNCTION public.reset_business_data_before_cutoff_v1', start);
  assert.ok(start !== -1 && end !== -1, 'erase_pii_for_identifier must exist in baseline migration');
  const src = full.slice(start, end);
  assert.ok(!src.includes('created_month'), 'erase must not modify created_month (partition key)');
  assert.ok(!src.includes('session_month'), 'erase must not modify session_month (partition key)');
});

test('GDPR consent route uses isolated signing toggle, not call-event rollback switch', () => {
  const src = readFileSync(GDPR_CONSENT_ROUTE, 'utf8');
  assert.ok(src.includes('GDPR_CONSENT_SIGNING_DISABLED'), 'consent route must use its own signing toggle');
  assert.ok(!src.includes('CALL_EVENT_SIGNING_DISABLED'), 'consent route must not depend on call-event signing rollback switch');
});
