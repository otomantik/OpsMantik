/**
 * GDPR Compliance Freeze — Regression protection.
 * These tests FAIL if compliance invariants are violated.
 * Scope: Backend + DB metadata. No UI. No features.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SYNC_ROUTE = join(ROOT, 'app', 'api', 'sync', 'route.ts');
const ERASE_RPC = join(ROOT, 'supabase', 'migrations', '20260226000002_erase_pii_rpc.sql');
const AUDIT_TRIGGERS = join(ROOT, 'supabase', 'migrations', '20260226000006_audit_triggers_low_volume.sql');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const ENQUEUE_SEAL = join(ROOT, 'lib', 'oci', 'enqueue-seal-conversion.ts');
const PIPELINE = join(ROOT, 'lib', 'services', 'pipeline-service.ts');

// ─────────────────────────────────────────────────────────────────────────────
// 1) Consent Gate Order Invariants
// ─────────────────────────────────────────────────────────────────────────────

test('COMPLIANCE: validateSiteFn executes BEFORE consent gate', () => {
  const src = readFileSync(SYNC_ROUTE, 'utf8');
  const validateSiteIdx = src.indexOf('validateSiteFn');
  const consentIdx = src.indexOf('consentScopes');
  assert.ok(validateSiteIdx !== -1, 'validateSiteFn must exist');
  assert.ok(consentIdx !== -1, 'consent gate must exist');
  assert.ok(validateSiteIdx < consentIdx, 'validateSiteFn MUST run before consent gate');
});

test('COMPLIANCE: consent gate executes BEFORE publish (idempotency runs in worker)', () => {
  const src = readFileSync(SYNC_ROUTE, 'utf8');
  const consent204Idx = src.indexOf("return new NextResponse(null, { status: 204");
  const publishCallIdx = src.indexOf('await doPublish(') !== -1 ? src.indexOf('await doPublish(') : src.indexOf('publishToQStash({');
  assert.ok(consent204Idx !== -1, 'consent gate (204 return) must exist');
  assert.ok(publishCallIdx !== -1, 'publish call must exist');
  assert.ok(consent204Idx < publishCallIdx, 'consent gate MUST run before publish');
});

test('COMPLIANCE: publish path unreachable when consent fails (204 return before publish)', () => {
  const src = readFileSync(SYNC_ROUTE, 'utf8');
  const consentReturn204 = src.indexOf("return new NextResponse(null, { status: 204");
  const publishIdx = src.indexOf('doPublish') !== -1 ? src.indexOf('doPublish') : src.indexOf('publishToQStash');
  assert.ok(consentReturn204 !== -1, '204 return on consent miss must exist');
  assert.ok(publishIdx !== -1, 'publish must exist');
  assert.ok(consentReturn204 < publishIdx, '204 return MUST occur before publish; no publish on consent fail');
});

test('COMPLIANCE: sync route contains compliance invariant comment', () => {
  const src = readFileSync(SYNC_ROUTE, 'utf8');
  assert.ok(
    src.includes('COMPLIANCE INVARIANT') && src.includes('validateSite') && src.includes('consent') && src.includes('idempotency'),
    'Sync route must contain explicit COMPLIANCE INVARIANT comment'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) OCI / offline_conversion_queue — marketing consent
// ─────────────────────────────────────────────────────────────────────────────

test('COMPLIANCE: offline_conversion_queue write guarded by marketing consent', () => {
  const enqueueSrc = readFileSync(ENQUEUE_SEAL, 'utf8');
  const pipelineSrc = readFileSync(PIPELINE, 'utf8');
  assert.ok(enqueueSrc.includes('hasMarketingConsentForCall'), 'enqueueSealConversion must check marketing consent');
  assert.ok(pipelineSrc.includes('hasMarketingConsentForCall'), 'PipelineService must check marketing consent');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) sessions/events/calls — no DELETE, no audit triggers
// ─────────────────────────────────────────────────────────────────────────────

test('COMPLIANCE: erase RPC uses UPDATE only — no DELETE on sessions/events/calls', () => {
  const src = readFileSync(ERASE_RPC, 'utf8');
  const sessionsSection = src.substring(src.indexOf('-- 1) Sessions'), src.indexOf('-- 2) Events'));
  const eventsSection = src.substring(src.indexOf('-- 2) Events'), src.indexOf('-- 3) Calls'));
  const callsSection = src.substring(src.indexOf('-- 3) Calls'), src.indexOf('-- 3b)'));
  assert.ok(!sessionsSection.includes('DELETE'), 'sessions: no DELETE');
  assert.ok(!eventsSection.includes('DELETE'), 'events: no DELETE');
  assert.ok(!callsSection.includes('DELETE'), 'calls: no DELETE');
});

test('COMPLIANCE: no audit triggers on high-write tables (sessions, events, calls)', () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const forbidden: string[] = [];
  for (const f of files) {
    const path = join(MIGRATIONS_DIR, f);
    const src = readFileSync(path, 'utf8');
    const lower = src.toLowerCase();
    if (
      (lower.includes('create trigger') && lower.includes('on public.sessions')) ||
      (lower.includes('create trigger') && lower.includes('on public.events')) ||
      (lower.includes('create trigger') && lower.includes('on public.calls'))
    ) {
      const isAudit = /create\s+trigger\s+audit_/i.test(src);
      const isPartitionOrUpdate =
        /sessions_set_created_month|events_set_session_month|calls_set_updated_at|calls_enforce_update|calls_notify_hunter/i.test(
          src
        );
      if (isAudit && !isPartitionOrUpdate) {
        forbidden.push(`${f}: audit trigger on high-write table`);
      }
    }
  }
  assert.ok(forbidden.length === 0, `Forbidden audit triggers on sessions/events/calls: ${forbidden.join(', ')}`);
});

test('COMPLIANCE: audit_triggers migration excludes sessions, events, calls', () => {
  const src = readFileSync(AUDIT_TRIGGERS, 'utf8');
  assert.ok(!src.includes('ON public.sessions'), 'No trigger on sessions');
  assert.ok(!src.includes('ON public.events'), 'No trigger on events');
  assert.ok(!src.includes('ON public.calls'), 'No trigger on calls');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4) Erase Invariants — PII nulled, billing preserved, no partition key change
// ─────────────────────────────────────────────────────────────────────────────

test('COMPLIANCE: erase RPC does NOT modify partition keys', () => {
  const src = readFileSync(ERASE_RPC, 'utf8');
  assert.ok(!src.includes('created_month'), 'erase must not modify created_month (sessions partition key)');
  assert.ok(!src.includes('session_month'), 'erase must not modify session_month (events partition key)');
});

test('COMPLIANCE: erase RPC preserves billing fields (value_cents, session_id, etc)', () => {
  const src = readFileSync(ERASE_RPC, 'utf8');
  assert.ok(!src.includes('value_cents ='), 'erase must not alter value_cents');
  // Only forbid SET-clause assignment of session_id (WHERE uses session_id::text = / session_id = ANY are allowed)
  const setSections = src.split(/\bSET\b/i);
  const hasSetSessionId = setSections.some((block, i) => i > 0 && /\bsession_id\s*=/.test(block.split(/\bWHERE\b/i)[0] || ''));
  assert.ok(!hasSetSessionId, 'erase must not SET session_id (referential)');
  assert.ok(!src.includes('billable ='), 'erase must not alter billable');
});

test('COMPLIANCE: erase RPC nulls PII columns in sessions', () => {
  const src = readFileSync(ERASE_RPC, 'utf8');
  assert.ok(src.includes('fingerprint = NULL'), 'sessions.fingerprint must be nulled');
  assert.ok(src.includes('ip_address = NULL'), 'sessions.ip_address must be nulled');
});

test('COMPLIANCE: erase RPC redacts calls PII', () => {
  const src = readFileSync(ERASE_RPC, 'utf8');
  assert.ok(
    src.includes("phone_number = '[REDACTED]'") || src.includes("phone_number = '[REDACTED]'"),
    'calls.phone_number must be redacted'
  );
  assert.ok(src.includes('matched_fingerprint = NULL'), 'calls.matched_fingerprint must be nulled');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5) Audit Log — no PII in payload
// ─────────────────────────────────────────────────────────────────────────────

test('COMPLIANCE: audit_log must NOT store identifier_value in payload', () => {
  const eraseRoute = readFileSync(join(ROOT, 'app', 'api', 'gdpr', 'erase', 'route.ts'), 'utf8');
  const exportRoute = readFileSync(join(ROOT, 'app', 'api', 'gdpr', 'export', 'route.ts'), 'utf8');
  const extractAuditPayload = (src: string): string => {
    const start = src.indexOf('audit_log');
    const insertStart = src.indexOf('payload: {', start);
    if (insertStart === -1) return '';
    return src.substring(insertStart, insertStart + 900);
  };
  const erasePayload = extractAuditPayload(eraseRoute);
  const exportPayload = extractAuditPayload(exportRoute);
  assert.ok(!erasePayload.includes('identifier_value'), 'audit_log payload must not contain identifier_value (erase)');
  assert.ok(!exportPayload.includes('identifier_value'), 'audit_log payload must not contain identifier_value (export)');
});

test('COMPLIANCE: audit_log payload must not contain raw fingerprint, gclid, phone_number', () => {
  const eraseRoute = readFileSync(join(ROOT, 'app', 'api', 'gdpr', 'erase', 'route.ts'), 'utf8');
  const exportRoute = readFileSync(join(ROOT, 'app', 'api', 'gdpr', 'export', 'route.ts'), 'utf8');
  const extractPayload = (src: string): string => {
    const start = src.indexOf('audit_log');
    const payloadStart = src.indexOf('payload: {', start);
    if (payloadStart === -1) return '';
    return src.substring(payloadStart, payloadStart + 900);
  };
  for (const [name, src] of [['erase', eraseRoute], ['export', exportRoute]] as const) {
    const payload = extractPayload(src);
    assert.ok(!/fingerprint\s*[,:]/.test(payload), `${name}: payload must not include fingerprint`);
    assert.ok(!/gclid\s*[,:]/.test(payload), `${name}: payload must not include gclid`);
    assert.ok(!/phone_number\s*[,:]/.test(payload), `${name}: payload must not include phone_number`);
  }
});
