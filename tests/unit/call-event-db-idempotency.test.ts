/**
 * Call-Event DB Idempotency (Model B) — Invariant tests.
 * Ensures DB-level duplicate prevention when Redis replay cache is down.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CALL_EVENT_V2 = join(ROOT, 'app', 'api', 'call-event', 'v2', 'route.ts');
const CALL_EVENT_V1 = join(ROOT, 'app', 'api', 'call-event', 'route.ts');
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20260228000000_call_event_signature_hash.sql');

test('A) 23505 conflict returns 200 noop and signature_hash lookup path exists', () => {
  const v2 = readFileSync(CALL_EVENT_V2, 'utf8');
  const v1 = readFileSync(CALL_EVENT_V1, 'utf8');
  assert.ok(v2.includes("insertError.code === '23505'"), 'v2 must handle unique violation 23505');
  assert.ok(v1.includes("insertError.code === '23505'"), 'v1 must handle unique violation 23505');
  assert.ok(v2.includes("'signature_hash'"), 'v2 must look up by signature_hash on conflict');
  assert.ok(v1.includes("'signature_hash'"), 'v1 must look up by signature_hash on conflict');
  assert.ok(v2.includes("'idempotent_conflict'"), 'v2 must return reason idempotent_conflict on signature_hash conflict');
  assert.ok(v1.includes("'idempotent_conflict'"), 'v1 must return reason idempotent_conflict on signature_hash conflict');
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

test('C) Consent gate still prevents DB insert (analytics missing → 204)', () => {
  const v2 = readFileSync(CALL_EVENT_V2, 'utf8');
  const insertIdx = v2.indexOf('adminClient.from(\'calls\').insert');
  const consent204Idx = v2.indexOf("status: 204");
  assert.ok(consent204Idx > 0 && insertIdx > 0, 'both consent and insert must exist');
  assert.ok(
    v2.indexOf('!hasAnalyticsConsent') < insertIdx || v2.indexOf('CONSENT_MISSING_HEADERS') < insertIdx,
    'consent gate must run before insert'
  );
});

test('D) DB idempotency: signature_hash included in insert payload', () => {
  const v2 = readFileSync(CALL_EVENT_V2, 'utf8');
  const v1 = readFileSync(CALL_EVENT_V1, 'utf8');
  assert.ok(v2.includes('signature_hash: signatureHash'), 'v2 must include signature_hash in insert');
  assert.ok(v1.includes('signature_hash: signatureHash'), 'v1 must include signature_hash in insert');
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
