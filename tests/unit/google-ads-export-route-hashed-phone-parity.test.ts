/**
 * PR-9H.7C — Hosted path wiring: route → fetch → buildExportItems → buildQueueItems.
 * Static source checks (no live HTTP / no Supabase) to lock the same path production uses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildQueueItems } from '@/app/api/oci/google-ads-export/export-build-queue';

const ROOT = process.cwd();
const VALID_HP = '0123456789abcdef'.repeat(4);
const ctx = { site: { timezone: 'UTC', currency: 'TRY' } } as never;

function baseQueueRow(overrides: Record<string, unknown>) {
  return {
    id: 'q-parity',
    call_id: 'c-parity',
    occurred_at: '2026-05-05T10:00:00.000Z',
    conversion_time: '2026-05-05T10:00:00.000Z',
    created_at: '2026-05-05T10:00:00.000Z',
    value_cents: 100,
    optimization_value: 1,
    currency: 'TRY',
    provider_key: 'google_ads',
    sale_id: null,
    session_id: 's1',
    gclid: 'g1',
    wbraid: null,
    gbraid: null,
    external_id: 'ext',
    action: 'OpsMantik_Won',
    user_identifiers: null,
    ...overrides,
  };
}

test('route uses buildExportItems and preview passes hashed phone diagnostics (source contract)', () => {
  const routePath = join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const routeSrc = readFileSync(routePath, 'utf8');
  assert.match(routeSrc, /buildExportItems\(/, 'GET handler must call buildExportItems');
  assert.match(routeSrc, /hashed_phone_available_count/, 'preview_diagnostics must surface hashed phone counts');
  const qbPath = join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-build-queue.ts');
  const qbSrc = readFileSync(qbPath, 'utf8');
  assert.match(qbSrc, /hashedPhoneNumber/, 'final item builder must emit hashedPhoneNumber');
  assert.match(qbSrc, /userIdentifiers/, 'final item builder must emit userIdentifiers');
});

test('export-fetch: journal select and user_identifiers retry (PR-9H.7C)', () => {
  const fetchPath = join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts');
  const s = readFileSync(fetchPath, 'utf8');
  assert.match(s, /QUEUE_SELECT_WITH_USER_IDENTIFIERS/);
  assert.match(s, /QUEUE_SELECT_WITHOUT_USER_IDENTIFIERS/);
  assert.match(s, /isMissingColumnProjectionError/);
  assert.match(s, /offline_conversion_queue/);
});

test('export-build-items: call context + hash map feed buildQueueItems (source contract)', () => {
  const p = join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-build-items.ts');
  const s = readFileSync(p, 'utf8');
  assert.match(s, /fetchExportCallContextRows/);
  assert.match(s, /callerPhoneHashByCall/);
  assert.match(s, /buildQueueItems/);
});

test('call sendability fetch: export context merges dedicated caller_phone_hash_sha256 query (PR-9H.7C)', () => {
  const p = join(ROOT, 'lib', 'oci', 'call-sendability-fetch.ts');
  const s = readFileSync(p, 'utf8');
  assert.match(s, /fetchCallerPhoneHashesForCallIds/);
  assert.match(s, /fetchExportCallContextRows/);
  assert.match(s, /EXPORT_CALL_CONTEXT_PROJECTIONS/);
});

test('parity: queue without user_identifiers + call hash map yields hashedPhoneNumber and userIdentifiers', () => {
  const built = buildQueueItems(
    ctx,
    [baseQueueRow({ user_identifiers: null })] as never,
    {},
    {},
    { 'c-parity': VALID_HP }
  );
  assert.equal(built.conversions.length, 1);
  const item = built.conversions[0];
  assert.equal(item.hashedPhoneNumber, VALID_HP);
  assert.equal(item.hashed_phone_number, VALID_HP);
  assert.deepEqual(item.userIdentifiers, [{ type: 'hashed_phone', value: VALID_HP }]);
  const json = JSON.stringify(item);
  for (const banned of [
    'caller_phone_raw',
    'rawPhone',
    'e164Phone',
    'normalizedPhone',
    'callerPhone',
  ]) {
    assert.doesNotMatch(json, new RegExp(banned, 'i'));
  }
});
