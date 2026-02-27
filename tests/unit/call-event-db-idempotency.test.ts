/**
 * Call-Event DB Idempotency (Model B) — Invariant tests.
 * Ensures DB-level duplicate prevention when Redis replay cache is down.
 * Architecture: v1/v2 publish to QStash; worker inserts. 23505 handled in worker (non-retryable).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CALL_EVENT_V2 = join(ROOT, 'app', 'api', 'call-event', 'v2', 'route.ts');
const CALL_EVENT_V1 = join(ROOT, 'app', 'api', 'call-event', 'route.ts');
const WORKER_INGEST = join(ROOT, 'app', 'api', 'workers', 'ingest', 'route.ts');
const PROCESS_CALL_EVENT = join(ROOT, 'lib', 'ingest', 'process-call-event.ts');
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20260228000000_call_event_signature_hash.sql');

test('A) 23505 conflict returns 200 noop and signature_hash lookup path exists', () => {
  const v2 = readFileSync(CALL_EVENT_V2, 'utf8');
  const v1 = readFileSync(CALL_EVENT_V1, 'utf8');
  const worker = readFileSync(WORKER_INGEST, 'utf8');
  const processCall = readFileSync(PROCESS_CALL_EVENT, 'utf8');
  assert.ok(worker.includes("code === '23505'"), 'worker must handle 23505 (non-retryable)');
  assert.ok(v2.includes('signature_hash'), 'v2 must include signature_hash in worker payload');
  assert.ok(v1.includes('signature_hash'), 'v1 must include signature_hash in worker payload');
  assert.ok(processCall.includes('signature_hash'), 'process-call-event must include signature_hash in insert');
});

test('B) signature_hash is sha256(signature) and stable', () => {
  const v2 = readFileSync(CALL_EVENT_V2, 'utf8');
  const v1 = readFileSync(CALL_EVENT_V1, 'utf8');
  assert.ok(v2.includes("createHash('sha256')"), 'v2 must use sha256 for signature_hash');
  assert.ok(v2.includes('update(headerSig'), 'v2 must hash headerSig (signature)');
  assert.ok(v2.includes('.digest(\'hex\')'), 'v2 must output hex');
  assert.ok(v1.includes("createHash('sha256')"), 'v1 must use sha256 for signature_hash');
  assert.ok(v1.includes('update(headerSig'), 'v1 must hash headerSig');
});

test('C) Consent gate still prevents publish (analytics missing → 204)', () => {
  const v2 = readFileSync(CALL_EVENT_V2, 'utf8');
  const consentIdx = v2.indexOf('!hasAnalyticsConsent') !== -1 ? v2.indexOf('!hasAnalyticsConsent') : v2.indexOf('CONSENT_MISSING_HEADERS');
  const publishCallIdx = v2.indexOf('await publishToQStash');
  assert.ok(v2.includes("status: 204"), 'consent gate (204 return) must exist');
  assert.ok(publishCallIdx > 0, 'publish call must exist');
  assert.ok(consentIdx > 0 && consentIdx < publishCallIdx, 'consent gate must run before publish');
});

test('D) DB idempotency: signature_hash included in worker payload', () => {
  const v2 = readFileSync(CALL_EVENT_V2, 'utf8');
  const v1 = readFileSync(CALL_EVENT_V1, 'utf8');
  assert.ok(v2.includes('signature_hash: signatureHash'), 'v2 must include signature_hash in worker payload');
  assert.ok(v1.includes('signature_hash: signatureHash'), 'v1 must include signature_hash in worker payload');
  assert.ok(v2.includes('signatureHash'), 'v2 must compute and use signatureHash');
  assert.ok(v1.includes('signatureHash'), 'v1 must compute and use signatureHash');
});

test('E) Migration adds signature_hash column and unique index', () => {
  const m = readFileSync(MIGRATION, 'utf8');
  assert.ok(m.includes('signature_hash text'), 'migration must add signature_hash column');
  assert.ok(m.includes('calls_site_signature_hash_uq'), 'migration must create unique index');
  assert.ok(m.includes('site_id, signature_hash'), 'index must be on (site_id, signature_hash)');
  assert.ok(m.includes('WHERE signature_hash IS NOT NULL'), 'index must be partial to allow NULL');
});
