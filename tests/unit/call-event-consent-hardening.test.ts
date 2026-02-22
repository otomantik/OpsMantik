/**
 * Call-Event Consent Hardening — Invariant tests.
 * Fails if call-event path bypasses GDPR consent gates.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CALL_EVENT_V2 = join(ROOT, 'app', 'api', 'call-event', 'v2', 'route.ts');
const CALL_EVENT_V1 = join(ROOT, 'app', 'api', 'call-event', 'route.ts');
const ENQUEUE = join(ROOT, 'lib', 'oci', 'enqueue-seal-conversion.ts');
const PIPELINE = join(ROOT, 'lib', 'services', 'pipeline-service.ts');
const MATCH_SESSION = join(ROOT, 'lib', 'api', 'call-event', 'match-session-by-fingerprint.ts');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

test('A) Call-event with analytics missing returns 204, no insert path', () => {
  const v2 = readFileSync(CALL_EVENT_V2, 'utf8');
  assert.ok(v2.includes("'x-opsmantik-consent-missing'"), 'v2 must return 204 with consent header');
  assert.ok(v2.includes('return new NextResponse(null, { status: 204'), 'v2 must return 204 on consent fail');
  const insertIdx = v2.indexOf('adminClient.from(\'calls\').insert');
  const consent204Idx = v2.indexOf('status: 204');
  assert.ok(consent204Idx < insertIdx || v2.indexOf('hasAnalyticsConsent') < insertIdx, '204 must occur before call insert');
});

test('B) Marketing consent checked before OCI enqueue', () => {
  const enqueue = readFileSync(ENQUEUE, 'utf8');
  const pipeline = readFileSync(PIPELINE, 'utf8');
  assert.ok(enqueue.includes('hasMarketingConsentForCall'), 'enqueueSealConversion must check marketing consent');
  assert.ok(pipeline.includes('hasMarketingConsentForCall'), 'PipelineService must check marketing consent');
});

test('C) Call-event without session returns 204, no insert', () => {
  const v2 = readFileSync(CALL_EVENT_V2, 'utf8');
  assert.ok(v2.includes('!matchedSessionId'), 'v2 must check for no matched session');
  assert.ok(v2.includes('return new NextResponse(null, { status: 204'), 'v2 must return 204 when no session');
});

test('D) Call-event cannot modify consent — rejects payload with consent_scopes/consent_at', () => {
  const v2 = readFileSync(CALL_EVENT_V2, 'utf8');
  const v1 = readFileSync(CALL_EVENT_V1, 'utf8');
  assert.ok(v2.includes("'consent_scopes' in bodyJson"), 'v2 must reject consent_scopes in payload');
  assert.ok(v2.includes("'consent_at' in bodyJson"), 'v2 must reject consent_at in payload');
  assert.ok(v1.includes("'consent_scopes' in bodyJson"), 'v1 must reject consent_scopes in payload');
  assert.ok(v1.includes("'consent_at' in bodyJson"), 'v1 must reject consent_at in payload');
});

test('E) Replay protection present (ReplayCacheService)', () => {
  const v2 = readFileSync(CALL_EVENT_V2, 'utf8');
  assert.ok(v2.includes('ReplayCacheService'), 'v2 must use ReplayCacheService');
  assert.ok(v2.includes('checkAndStore'), 'v2 must check replay cache');
});

test('F) No DELETE operations on calls in migrations', () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
  for (const f of files) {
    const src = readFileSync(join(MIGRATIONS, f), 'utf8');
    const lower = src.toLowerCase();
    if (/delete\s+from\s+public\.calls|delete\s+from\s+calls\b/.test(lower)) {
      assert.fail(`Migration ${f} contains DELETE on calls`);
    }
  }
});

test('G) No audit trigger on calls', () => {
  const auditTriggers = readFileSync(join(MIGRATIONS, '20260226000006_audit_triggers_low_volume.sql'), 'utf8');
  assert.ok(!auditTriggers.includes('ON public.calls'), 'No audit trigger on calls');
});

test('H) COMPLIANCE INVARIANT comment exists in call-event route', () => {
  const v2 = readFileSync(CALL_EVENT_V2, 'utf8');
  assert.ok(v2.includes('COMPLIANCE INVARIANT'), 'Must have compliance invariant comment');
  assert.ok(v2.includes('analytics consent'), 'Comment must mention analytics consent');
  assert.ok(v2.includes('Marketing consent'), 'Comment must mention marketing consent');
});

test('J) Route order: HMAC before Replay before Rate limit before Session lookup before Consent', () => {
  const v2 = readFileSync(CALL_EVENT_V2, 'utf8');
  const hmacIdx = v2.indexOf('verify_call_event_signature_v1');
  const replayIdx = v2.indexOf('ReplayCacheService.checkAndStore');
  const rateLimitIdx = v2.indexOf('RateLimitService.checkWithMode');
  // Use lastIndexOf: findRecentSessionByFingerprint appears in import and in call; we need the call site.
  const sessionIdx = v2.lastIndexOf('findRecentSessionByFingerprint');
  const consentIdx = v2.indexOf('hasAnalyticsConsent');
  assert.ok(hmacIdx < replayIdx, 'HMAC must run before Replay');
  assert.ok(replayIdx < rateLimitIdx, 'Replay must run before Rate limit');
  assert.ok(rateLimitIdx < sessionIdx, 'Rate limit must run before Session lookup');
  assert.ok(sessionIdx < consentIdx, 'Session lookup must run before Consent gate');
});

test('I) match-session returns consent_scopes for analytics gate', () => {
  const match = readFileSync(MATCH_SESSION, 'utf8');
  assert.ok(match.includes('consent_scopes'), 'match-session must select consent_scopes');
  assert.ok(match.includes('consentScopes'), 'match-session must return consentScopes');
});
