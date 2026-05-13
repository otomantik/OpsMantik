/**
 * PR-9H.7D — Hashed phone courier surfacing for GET /api/oci/google-ads-export.
 * No raw phone literals; fixture hashes use synthetic hex patterns only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildQueueItems } from '@/app/api/oci/google-ads-export/export-build-queue';
import { finalizeReturnedPhoneDiagnostics } from '@/app/api/oci/google-ads-export/export-build-items';
import { buildPreviewDiagnosticsExtension } from '@/app/api/oci/google-ads-export/export-preview-diagnostics';
import {
  appendHashedPhoneCourier,
  extractHashedPhoneFromExportSources,
  normalizeServerHashedPhone,
} from '@/lib/oci/hashed-phone-courier';
import type { GoogleAdsConversionItem, QueueRow } from '@/lib/oci/google-ads-export/types';

/** 64-char synthetic SHA-256 hex (deterministic test fixture; not a production secret). */
const FIX_HP_LOWER = '0123456789abcdef'.repeat(4);
const FIX_HP_UPPER = 'FEDCBA9876543210'.repeat(4);
const FIX_HP_UPPER_NORMALIZED = FIX_HP_UPPER.toLowerCase();

const ctx = { site: { timezone: 'UTC', currency: 'USD' } } as never;

function baseQueueRow(overrides: Record<string, unknown>): QueueRow {
  return {
    id: 'q-pr9h7d',
    call_id: 'c-pr9h7d',
    occurred_at: '2026-05-05T10:00:00.000Z',
    conversion_time: '2026-05-05T10:00:00.000Z',
    created_at: '2026-05-05T10:00:00.000Z',
    value_cents: 100,
    optimization_value: 1,
    currency: 'USD',
    provider_key: 'google_ads',
    sale_id: null,
    session_id: 's1',
    gclid: 'g-valid',
    wbraid: null,
    gbraid: null,
    external_id: 'ext-id',
    action: 'OpsMantik_Won',
    ...overrides,
  } as QueueRow;
}

test('normalizeServerHashedPhone: uppercase 64 hex → lowercase', () => {
  assert.equal(normalizeServerHashedPhone(FIX_HP_UPPER), FIX_HP_UPPER_NORMALIZED);
});

test('normalizeServerHashedPhone rejects invalid / raw-phone-shaped values', () => {
  assert.equal(normalizeServerHashedPhone('+905551234567'), null);
  assert.equal(normalizeServerHashedPhone('zzz'), null);
  assert.equal(normalizeServerHashedPhone('abcd'), null);
  assert.equal(normalizeServerHashedPhone(null), null);
});

test('extractHashedPhoneFromExportSources: courier array shape', () => {
  const row = baseQueueRow({
    user_identifiers: {
      userIdentifiers: [{ type: 'hashed_phone', value: FIX_HP_UPPER }],
    },
  });
  const r = extractHashedPhoneFromExportSources({ row, callerPhoneHashSha256: null });
  assert.equal(r.hashedPhoneNumber, FIX_HP_UPPER_NORMALIZED);
  assert.equal(r.source, 'queue_user_identifiers_array_entry');
});

test('buildQueueItems attaches hashedPhoneNumber and userIdentifiers (+ snake_case mirrors)', () => {
  const built = buildQueueItems(
    ctx,
    [baseQueueRow({ user_identifiers: { hashed_phone: FIX_HP_UPPER } })],
    {},
    {},
    {}
  );
  assert.equal(built.conversions.length, 1);
  const item = built.conversions[0];
  assert.equal(item.hashedPhoneNumber, FIX_HP_UPPER_NORMALIZED);
  assert.equal(item.hashed_phone_number, FIX_HP_UPPER_NORMALIZED);
  assert.ok(Array.isArray(item.userIdentifiers));
  assert.ok(Array.isArray(item.user_identifiers));
  assert.equal(item.userIdentifiers?.[0]?.type, 'hashed_phone');
  assert.equal(item.userIdentifiers?.[0]?.value, FIX_HP_UPPER_NORMALIZED);
});

test('buildQueueItems omits hashed phone courier fields when no valid hash', () => {
  const built = buildQueueItems(
    ctx,
    [baseQueueRow({ user_identifiers: { hashed_phone: 'not-a-hash' } })],
    {},
    {},
    {}
  );
  const item = built.conversions[0];
  assert.equal(item.hashedPhoneNumber, undefined);
  assert.equal(item.userIdentifiers, undefined);
});

test('finalizeReturnedPhoneDiagnostics: exported/missing/source_counts without hash literals', () => {
  const combined: GoogleAdsConversionItem[] = [
    {
      id: 'seal_q1',
      orderId: 'o1',
      gclid: 'g',
      wbraid: '',
      gbraid: '',
      conversionName: 'OpsMantik_Won',
      conversionTime: '2026-01-01 00:00:00+00:00',
      conversionValue: 1,
      conversionCurrency: 'USD',
      hashedPhoneNumber: FIX_HP_LOWER,
    },
    {
      id: 'seal_q2',
      orderId: 'o2',
      gclid: 'g',
      wbraid: '',
      gbraid: '',
      conversionName: 'OpsMantik_Won',
      conversionTime: '2026-01-01 00:00:01+00:00',
      conversionValue: 1,
      conversionCurrency: 'USD',
    },
  ];
  const base = {
    hashed_phone_available_count: 2,
    hashed_phone_invalid_count: 0,
    enhanced_signal_available_count: 2,
    hashed_phone_candidate_count: 2,
    hashed_phone_exported_count: 0,
    hashed_phone_missing_count: 0,
    hashed_phone_source_counts: {},
  };
  const diag = finalizeReturnedPhoneDiagnostics(
    combined,
    [{ queueId: 'q1', source: 'caller_phone_hash_sha256' }],
    base
  );
  assert.equal(diag.hashed_phone_exported_count, 1);
  assert.equal(diag.hashed_phone_missing_count, 1);
  assert.deepEqual(diag.hashed_phone_source_counts, { caller_phone_hash_sha256: 1 });

  const prev = buildPreviewDiagnosticsExtension(
    [],
    {
      suppressedQueueIds: [],
      blockedQueueTimeIds: [],
      blockedValueZeroIds: [],
      blockedExpiredIds: [],
      blockedExportGateIds: [],
      blockedExportGateReasonByQueueId: {},
      blockedMissingConversionActionIds: [],
      combined,
    },
    {
      fetch_row_count: 0,
      build_queue_conversions_count: 2,
      after_call_sendability_filter_count: 2,
      after_highest_gear_returned_count: 2,
    },
    [],
    diag,
    { currency_missing_count: 0, currency_unexpected_count: 0, currency_defaulted_count: 0 }
  );
  const json = JSON.stringify(prev);
  assert.equal(json.includes(FIX_HP_LOWER), false);
});

test('GoogleAdsScriptUniversal.js: no raw-phone hashing primitives (courier-only contract)', () => {
  const scriptPath = join(process.cwd(), 'scripts', 'google-ads-oci', 'GoogleAdsScriptUniversal.js');
  const src = readFileSync(scriptPath, 'utf8');
  assert.doesNotMatch(src, /\bsha256\b/i);
  assert.doesNotMatch(src, /Utilities\.digest|digestHex/i);
});

test('appendHashedPhoneCourier is idempotent for duplicate hashed_phone entries', () => {
  const base: GoogleAdsConversionItem = {
    id: 'seal_x',
    orderId: 'o',
    gclid: '',
    wbraid: '',
    gbraid: '',
    conversionName: 'OpsMantik_Won',
    conversionTime: '2026-01-01 00:00:00+00:00',
    conversionValue: 1,
    conversionCurrency: 'USD',
    userIdentifiers: [{ type: 'hashed_phone', value: FIX_HP_LOWER }],
  };
  const twice = appendHashedPhoneCourier(appendHashedPhoneCourier(base, FIX_HP_UPPER), FIX_HP_UPPER);
  assert.equal(twice.userIdentifiers?.filter((u) => u.type === 'hashed_phone').length, 1);
});
