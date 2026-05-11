import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyUniversalDrainRow,
  PR9I_SELECTED_IDENTIFIER_POLICY,
} from '@/lib/oci/universal-script-drain-audit';
import type { QueueRow } from '@/lib/oci/google-ads-export/types';

const BASE_SITE = { currency: 'TRY', timezone: 'Europe/Istanbul' };

function row(partial: Partial<QueueRow> & { id: string }): QueueRow & { status?: string } {
  return {
    id: partial.id,
    status: partial.status ?? 'QUEUED',
    call_id: partial.call_id ?? 'call-1',
    gclid: partial.gclid ?? null,
    wbraid: partial.wbraid ?? null,
    gbraid: partial.gbraid ?? null,
    user_identifiers: partial.user_identifiers,
    conversion_time: partial.conversion_time ?? '2026-05-01T10:00:00.000Z',
    occurred_at: partial.occurred_at,
    value_cents: partial.value_cents ?? 10000,
    currency: partial.currency ?? 'TRY',
    action: partial.action ?? 'OpsMantik_Won',
    optimization_stage: partial.optimization_stage,
    provider_key: partial.provider_key ?? 'google_ads',
  };
}

test('PR-9I audit policy constant is stable', () => {
  assert.equal(PR9I_SELECTED_IDENTIFIER_POLICY, 'gclid>wbraid>gbraid');
});

test('exportable gclid only', () => {
  const r = row({
    id: 'a',
    gclid: 'abc',
  });
  const c = classifyUniversalDrainRow(r, BASE_SITE, {});
  assert.equal(c.bucket, 'EXPORTABLE_GCLID');
  assert.equal(c.selectedType, 'gclid');
  assert.equal(c.flags.multipleClickIds, false);
});

test('exportable wbraid only', () => {
  const c = classifyUniversalDrainRow(row({ id: 'b', gclid: '', wbraid: 'wb' }), BASE_SITE, {});
  assert.equal(c.bucket, 'EXPORTABLE_WBRAID');
  assert.equal(c.selectedType, 'wbraid');
});

test('exportable gbraid only', () => {
  const c = classifyUniversalDrainRow(row({ id: 'c', gbraid: 'gb' }), BASE_SITE, {});
  assert.equal(c.bucket, 'EXPORTABLE_GBRAID');
  assert.equal(c.selectedType, 'gbraid');
});

test('gclid+wbraid selects gclid', () => {
  const c = classifyUniversalDrainRow(row({ id: 'd', gclid: 'g', wbraid: 'w' }), BASE_SITE, {});
  assert.equal(c.selectedType, 'gclid');
  assert.equal(c.flags.multipleClickIds, true);
  assert.equal(c.bucket, 'EXPORTABLE_GCLID');
});

test('wbraid+gbraid selects wbraid', () => {
  const c = classifyUniversalDrainRow(row({ id: 'e', wbraid: 'w', gbraid: 'gb' }), BASE_SITE, {});
  assert.equal(c.selectedType, 'wbraid');
  assert.equal(c.bucket, 'EXPORTABLE_WBRAID');
});

test('all three selects gclid', () => {
  const c = classifyUniversalDrainRow(row({ id: 'f', gclid: 'g', wbraid: 'w', gbraid: 'gb' }), BASE_SITE, {});
  assert.equal(c.selectedType, 'gclid');
});

test('hashed phone only rejects', () => {
  const uid = { hashed_phone: 'a'.repeat(64) };
  const c = classifyUniversalDrainRow(row({ id: 'g', user_identifiers: uid, gclid: '', wbraid: '', gbraid: '' }), BASE_SITE, {});
  assert.equal(c.bucket, 'NOT_EXPORTABLE_HASHED_PHONE_ONLY');
});

test('missing click id rejects', () => {
  const c = classifyUniversalDrainRow(row({ id: 'h', gclid: '', wbraid: '', gbraid: '' }), BASE_SITE, {});
  assert.equal(c.bucket, 'NOT_EXPORTABLE_NO_IDENTIFIER');
});

test('invalid value rejects', () => {
  const c = classifyUniversalDrainRow(row({ id: 'i', gclid: 'x', value_cents: 0 }), BASE_SITE, {});
  assert.equal(c.bucket, 'NOT_EXPORTABLE_INVALID_VALUE');
});

test('gclid + hashed phone export bucket', () => {
  const uid = { hashed_phone: 'b'.repeat(64) };
  const c = classifyUniversalDrainRow(row({ id: 'j', gclid: 'x', user_identifiers: uid }), BASE_SITE, {});
  assert.equal(c.bucket, 'EXPORTABLE_GCLID_WITH_HASHED_PHONE');
});
